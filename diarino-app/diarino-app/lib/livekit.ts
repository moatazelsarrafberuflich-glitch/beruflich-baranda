import { supabase } from "./supabase";

export type LiveKitConnectionInfo = {
  token: string;
  url: string;
  isHost: boolean; // echoed back so the UI knows which controls to show
};

// Calls the `livekit-token` Edge Function with the caller's current
// Supabase session attached automatically by supabase-js.
// Added automatic retry logic to ensure room exists in DB before failing.
export async function fetchLiveKitToken(
  roomName: string,
  retries = 3,
  delay = 600
): Promise<LiveKitConnectionInfo> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke<LiveKitConnectionInfo>(
        "livekit-token",
        {
          body: { roomName },
        }
      );

      if (!error && data?.token && data?.url) {
        return data;
      }

      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      } else if (error) {
        throw error;
      }
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
    }
  }

  throw new Error("livekit-token function returned an incomplete response");
}

// ↔ inserted by the broadcaster BEFORE requesting their own token — RLS
// (`host_id = auth.uid()`) means only the caller can ever create a room
// where they are the host, which is what the token function checks against.
export async function createLiveRoom(roomName: string, title: string): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not signed in");

  // تعديل جوهري: تغيير القيمة من "pending" إلى "none" لتفادي خرق قيد التحقق (Check Constraint) في Supabase
  const { error } = await supabase.from("lives").insert({
    room_name: roomName,
    host_id: userData.user.id,
    title,
    status: "live",
    recording_status: "none",
  });
  
  if (error) {
    console.error("Error creating live room in Supabase:", error);
    throw error;
  }
}

// ↔ called on "إنهاء" (end live) — marks the room ended and updates recording status
export async function endLiveRoom(roomName: string): Promise<void> {
  await supabase
    .from("lives")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
    })
    .eq("room_name", roomName);
}

// ↔ start Egress recording & SAVE egress_id + recording_status in Supabase
export async function startRecording(roomName: string): Promise<{ egressId: string }> {
  try {
    const { data, error } = await supabase.functions.invoke<{ egressId: string }>(
      "livekit-recording",
      {
        body: { action: "start", roomName },
      }
    );

    if (error) throw error;
    if (!data?.egressId) throw new Error("livekit-recording did not return an egressId");

    // تحديث قاعدة البيانات بـ egress_id وحالة التسجيل "processing"
    await supabase
      .from("lives")
      .update({
        egress_id: data.egressId,
        recording_status: "processing",
      })
      .eq("room_name", roomName);

    return data;
  } catch (err) {
    // في حال فشل بدء التسجيل، يتم تسجيل الحالة كـ failed
    await supabase
      .from("lives")
      .update({ recording_status: "failed" })
      .eq("room_name", roomName);
    throw err;
  }
}

// ↔ stops the Egress job & handles status safely
export async function stopRecording(
  roomName: string,
  egressId?: string,
  durationSec?: number
): Promise<void> {
  try {
    // إذا لم يتم التمرير الصريح للـ egressId، نقوم بجلب قيمته المجهزة في قاعدة البيانات
    let targetEgressId = egressId;
    if (!targetEgressId) {
      const { data } = await supabase
        .from("lives")
        .select("egress_id")
        .eq("room_name", roomName)
        .maybeSingle();

      targetEgressId = data?.egress_id ?? undefined;
    }

    if (!targetEgressId) {
      console.warn("No egressId found for stopping recording on room:", roomName);
      return;
    }

    const { error } = await supabase.functions.invoke("livekit-recording", {
      body: { action: "stop", roomName, egressId: targetEgressId, durationSec },
    });

    if (error) throw error;
  } catch (err) {
    console.error("Error stopping livekit recording:", err);
    // لا نرمي خطأ يوقف إغلاق الشاشة بالنسبة للمستخدم، بل يسجل في الخلفية
  }
}

// ↔ send chat or like messages to the live room
export async function sendLiveMessage(
  roomName: string,
  type: "comment" | "like",
  text?: string
): Promise<void> {
  const { error } = await supabase.functions.invoke("livekit-send-message", {
    body: { roomName, type, text },
  });
  if (error) throw error;
}

// ↔ kick participant (moderation)
export async function kickParticipant(
  roomName: string,
  participantIdentity: string
): Promise<void> {
  const { error } = await supabase.functions.invoke("livekit-moderate", {
    body: { roomName, participantIdentity },
  });
  if (error) throw error;
}