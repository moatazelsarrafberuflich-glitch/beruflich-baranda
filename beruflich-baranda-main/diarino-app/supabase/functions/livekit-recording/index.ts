// @ts-nocheck
// supabase/functions/livekit-recording/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";
serveWithCors(async (req)=>{
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  // التحقق من وجود متغيرات البيئة الخاصة بـ LiveKit داخل الدالة لتجنب الانهيار المفاجئ
  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    console.error("Missing LiveKit environment variables");
    return new Response(JSON.stringify({
      error: "Server configuration error: Missing LiveKit credentials"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({
      error: "Missing Authorization header"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({
      error: "Invalid session"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const user = userData.user;
  let body;
  try {
    body = await req.json();
  } catch  {
    return new Response(JSON.stringify({
      error: "Invalid JSON body"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const { action, roomName } = body;
  if (!action || !roomName) {
    return new Response(JSON.stringify({
      error: "action and roomName are required"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const { data: live, error: liveError } = await supabase.from("lives").select("id, host_id, status").eq("room_name", roomName).maybeSingle();
  if (liveError) {
    return new Response(JSON.stringify({
      error: "Failed to look up room"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (!live) {
    return new Response(JSON.stringify({
      error: "Room not found"
    }), {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (live.host_id !== user.id) {
    return new Response(JSON.stringify({
      error: "Not the host of this room"
    }), {
      status: 403,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (action === "start") {
    const filepath = `recordings/${roomName}-${Date.now()}.mp4`;
    try {
      const fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: "s3",
          value: new S3Upload({
            accessKey: Deno.env.get("RECORDING_S3_ACCESS_KEY"),
            secret: Deno.env.get("RECORDING_S3_SECRET"),
            bucket: Deno.env.get("RECORDING_S3_BUCKET"),
            region: Deno.env.get("RECORDING_S3_REGION") || "us-east-1",
            endpoint: Deno.env.get("RECORDING_S3_ENDPOINT"),
            forcePathStyle: true
          })
        }
      });
      const info = await egressClient.startRoomCompositeEgress(roomName, {
        file: fileOutput
      }, {
        layout: "grid"
      });
      await supabase.from("lives").update({
        egress_id: info.egressId,
        recording_filepath: filepath,
        recording_status: "recording"
      }).eq("id", live.id);
      return new Response(JSON.stringify({
        egressId: info.egressId,
        filepath
      }), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      console.error("Start recording error:", err);
      return new Response(JSON.stringify({
        error: `Failed to start recording: ${err?.message || err}`
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  }
  if (action === "stop") {
    if (!body.egressId) {
      return new Response(JSON.stringify({
        error: "egressId is required to stop"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    try {
      await egressClient.stopEgress(body.egressId);
      const durationSec = typeof body.durationSec === "number" ? body.durationSec : null;
      await supabase.from("lives").update({
        recording_status: "processing",
        ...durationSec != null ? {
          duration_sec: durationSec
        } : {}
      }).eq("id", live.id);
      return new Response(JSON.stringify({
        stopped: true
      }), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      console.error("Stop recording error:", err);
      return new Response(JSON.stringify({
        error: `Failed to stop recording: ${err?.message || err}`
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  }
  return new Response(JSON.stringify({
    error: "Unknown action"
  }), {
    status: 400,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
