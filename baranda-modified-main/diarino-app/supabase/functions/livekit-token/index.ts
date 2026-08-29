// supabase/functions/livekit-token/index.ts
//
// Mints a short-lived LiveKit access token for a caller who is already
// authenticated with Supabase.
//
// SECURITY: publish rights are NEVER taken from the request body. The
// function looks up `lives.host_id` for the given room_name and grants
// canPublish only if it equals the caller's own (JWT-verified) user id.
// Anyone else gets a subscriber (viewer)-only grant, no matter what they
// ask for. This closes the earlier TODO — role can no longer be spoofed.
//
// Deploy: supabase functions deploy livekit-token
// Env vars (supabase secrets set ...): LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
//
// Request body: { roomName: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 });
  }

  // Scoped to the caller's own JWT — every query below runs under THEIR
  // identity and RLS policies, so this function can't be tricked into
  // reading/writing rows it shouldn't.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  }
  const user = userData.user;

  let body: { roomName?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  const roomName = body.roomName;
  if (!roomName) {
    return new Response(JSON.stringify({ error: "roomName is required" }), { status: 400 });
  }

  // The room must already exist — a broadcaster creates this row (insert,
  // RLS-guarded to host_id = auth.uid()) BEFORE requesting their own token.
  // A viewer can never create one, so a room that isn't in this table yet
  // simply can't be joined by anyone.
  const { data: live, error: liveError } = await supabase
    .from("lives")
    .select("host_id, status")
    .eq("room_name", roomName)
    .maybeSingle();

  if (liveError) {
    return new Response(JSON.stringify({ error: "Failed to look up room" }), { status: 500 });
  }
  if (!live) {
    return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
  }
  if (live.status === "ended") {
    return new Response(JSON.stringify({ error: "This live has ended" }), { status: 410 });
  }

  const isHost = live.host_id === user.id;
  const displayName = (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || user.email || "مستخدم";

  const at = new AccessToken(Deno.env.get("LIVEKIT_API_KEY")!, Deno.env.get("LIVEKIT_API_SECRET")!, {
    identity: user.id,
    name: displayName,
    ttl: "10m", // reconnect flow should re-fetch a fresh token, not reuse a stale one
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: isHost,          // ↔ server-derived, not client-supplied
    // ↔ AUDIT FIX (server-side rate limiting task): this used to be `true`
    // for everyone, letting a client publish arbitrary data straight
    // into the room over the raw WebRTC data channel — which meant the
    // client-side comment/like throttle in lib/hooks/useLiveKitRoom.ts
    // was the ONLY thing stopping a modified client from flooding the
    // room, and a modified client can just skip that code. Comments and
    // likes are no longer sent this way at all: the client now calls the
    // livekit-send-message Edge Function, which enforces the same limits
    // (3 comments/sec, 5 likes/sec) atomically in Postgres BEFORE
    // relaying the message via RoomServiceClient.sendData() (see that
    // function for the mechanics). With canPublishData staying false, a
    // client literally cannot reach the data channel through another path —
    // the Edge Function is not just an alternate route, it's the only one.
    canPublishData: false,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return new Response(
    JSON.stringify({ token, url: Deno.env.get("LIVEKIT_URL"), isHost }),
    { headers: { "Content-Type": "application/json" } }
  );
});
