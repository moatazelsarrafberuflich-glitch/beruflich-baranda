// supabase/functions/livekit-token/index.ts
// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk";

// ترويسات CORS الموحدة الشاملة للويب وجميع المنصات
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  // 1. التعامل الفوري مع طلبات الاستكشاف المسبق (Preflight OPTIONS) للويب
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userData.user;

  let body: { roomName?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const roomName = body.roomName;
  if (!roomName) {
    return new Response(JSON.stringify({ error: "roomName is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: live, error: liveError } = await supabase
    .from("lives")
    .select("host_id, status")
    .eq("room_name", roomName)
    .maybeSingle();

  if (liveError) {
    return new Response(JSON.stringify({ error: "Failed to look up room" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!live) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (live.status === "ended") {
    return new Response(JSON.stringify({ error: "This live has ended" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isHost = live.host_id === user.id;
  const displayName =
    (user.user_metadata?.full_name as string) ||
    (user.user_metadata?.name as string) ||
    user.email ||
    "مستخدم";

  const at = new AccessToken(
    Deno.env.get("LIVEKIT_API_KEY")!,
    Deno.env.get("LIVEKIT_API_SECRET")!,
    {
      identity: user.id,
      name: displayName,
      ttl: "2h",
    }
  );

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: isHost,
    canPublishData: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  // إرجاع النتيجة مع تضمين ترويسات CORS
  return new Response(
    JSON.stringify({ token, url: Deno.env.get("LIVEKIT_URL"), isHost }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});