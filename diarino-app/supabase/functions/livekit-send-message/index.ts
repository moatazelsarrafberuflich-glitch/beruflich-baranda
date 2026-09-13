// @ts-nocheck
// supabase/functions/livekit-send-message/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { RoomServiceClient, DataPacket_Kind } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";
const LIMITS = {
  comment: 3,
  like: 5
};
const MAX_COMMENT_LENGTH = 200;
const encoder = new TextEncoder();
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
  // التأكد من المتغيرات وتأخير التهيئة لداخل الدالة لحمايتها من الانهيار
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
  const roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret);
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
  const callerClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
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
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "مستخدم";
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
  const { roomName, type } = body;
  if (!roomName || type !== "comment" && type !== "like") {
    return new Response(JSON.stringify({
      error: "roomName and a valid type ('comment' | 'like') are required"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const text = type === "comment" ? String(body.text ?? "").trim().slice(0, MAX_COMMENT_LENGTH) : undefined;
  if (type === "comment" && !text) {
    return new Response(JSON.stringify({
      error: "text is required for comments"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: live, error: liveError } = await serviceClient.from("lives").select("status").eq("room_name", roomName).maybeSingle();
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
  if (!live || live.status !== "live") {
    return new Response(JSON.stringify({
      error: "This live isn't active"
    }), {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const { data: allowed, error: rateError } = await serviceClient.rpc("bump_live_message_rate", {
    p_user_id: user.id,
    p_room_name: roomName,
    p_message_type: type,
    p_limit: LIMITS[type]
  });
  if (rateError) {
    console.error("Rate check error:", rateError);
    return new Response(JSON.stringify({
      error: "Rate check failed"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (!allowed) {
    return new Response(JSON.stringify({
      relayed: false,
      reason: "rate_limited"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const payload = type === "comment" ? {
    text,
    senderId: user.id,
    senderName: displayName
  } : {
    senderId: user.id,
    senderName: displayName
  };
  try {
    await roomService.sendData(roomName, encoder.encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, {
      topic: type
    });
  } catch (err) {
    console.error("Send data error:", err);
    return new Response(JSON.stringify({
      error: `Failed to relay message: ${err?.message || err}`
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  return new Response(JSON.stringify({
    relayed: true
  }), {
    headers: {
      "Content-Type": "application/json"
    }
  });
});
