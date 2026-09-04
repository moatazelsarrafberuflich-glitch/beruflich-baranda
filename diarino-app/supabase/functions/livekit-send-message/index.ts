// @ts-nocheck
// supabase/functions/livekit-send-message/index.ts
//
// The ONLY way a live comment or like reaches a LiveKit room now — see
// livekit-token/index.ts's canPublishData: false. A client can no longer
// publish onto the room's data channel directly at all, so this function
// isn't an alternate, bypassable path alongside a client-side throttle;
// it's the sole path, and the rate limit enforced here (via
// bump_live_message_rate(), 20260826000000_live_message_rate_limit.sql)
// applies no matter what the calling client does or doesn't do.
//
// SECURITY: same JWT-verification pattern as every other livekit-*
// function. The caller's identity for both the rate-limit bucket AND the
// relayed message's sender fields comes from their own verified
// auth.uid() — never from the request body.
//
// Deploy: supabase functions deploy livekit-send-message
// Env vars (supabase secrets set ...): LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
// LIVEKIT_URL (same as the other livekit-* functions). SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are auto-provided by
// the Supabase Edge Functions runtime for every function — nothing to
// set manually for those three, but note this function is the one that
// actually needs the service-role key used (the others only ever use the
// caller's-own-JWT client): bump_live_message_rate() isn't grantable to
// the `authenticated` role on purpose, so reaching it requires the
// service-role client specifically.
//
// Request body: { roomName: string, type: "comment" | "like", text?: string }
// `text` is required (and capped) for type "comment", ignored for "like".

import { createClient } from "jsr:@supabase/supabase-js@2";
import { RoomServiceClient, DataPacket_Kind } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";

const roomService = new RoomServiceClient(
  Deno.env.get("LIVEKIT_URL")!,
  Deno.env.get("LIVEKIT_API_KEY")!,
  Deno.env.get("LIVEKIT_API_SECRET")!
);

// ↔ same numbers as the client-side throttle in
// lib/hooks/useLiveKitRoom.ts (COMMENTS_PER_SECOND / LIKES_PER_SECOND) —
// kept in sync deliberately so a well-behaved client is never surprised
// by the server dropping something its own UI just let it send.
const LIMITS: Record<"comment" | "like", number> = { comment: 3, like: 5 };
const MAX_COMMENT_LENGTH = 200; // ↔ matches the input cap in components/live/LiveCommentsOverlay.tsx

const encoder = new TextEncoder();

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 });
  }

  // Scoped to the caller's own JWT purely to verify who they are — every
  // *write* below (the rate bucket, the relayed message) uses the
  // service-role client instead, since bump_live_message_rate() isn't
  // reachable by the `authenticated` role at all (see the migration).
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  }
  const user = userData.user;
  const displayName = (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || user.email || "مستخدم";

  let body: { roomName?: string; type?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  const { roomName, type } = body;
  if (!roomName || (type !== "comment" && type !== "like")) {
    return new Response(JSON.stringify({ error: "roomName and a valid type ('comment' | 'like') are required" }), { status: 400 });
  }
  const text = type === "comment" ? String(body.text ?? "").trim().slice(0, MAX_COMMENT_LENGTH) : undefined;
  if (type === "comment" && !text) {
    return new Response(JSON.stringify({ error: "text is required for comments" }), { status: 400 });
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // The room must actually exist and still be live — otherwise there's
  // nothing to relay to (and this stops someone from using this endpoint
  // to send data into an arbitrary/made-up LiveKit room name).
  const { data: live, error: liveError } = await serviceClient
    .from("lives")
    .select("status")
    .eq("room_name", roomName)
    .maybeSingle();
  if (liveError) return new Response(JSON.stringify({ error: "Failed to look up room" }), { status: 500 });
  if (!live || live.status !== "live") {
    return new Response(JSON.stringify({ error: "This live isn't active" }), { status: 404 });
  }

  // ↔ the actual enforcement — atomic in Postgres, see the migration.
  // Over the cap → tell the caller it was dropped (200, not an error;
  // this is expected/routine behavior for a chatty client, not a fault)
  // and stop here without touching LiveKit at all.
  const { data: allowed, error: rateError } = await serviceClient.rpc("bump_live_message_rate", {
    p_user_id: user.id, p_room_name: roomName, p_message_type: type, p_limit: LIMITS[type],
  });
  if (rateError) return new Response(JSON.stringify({ error: "Rate check failed" }), { status: 500 });
  if (!allowed) {
    return new Response(JSON.stringify({ relayed: false, reason: "rate_limited" }), { headers: { "Content-Type": "application/json" } });
  }

  // ↔ sent from the server, so every receiving client's
  // RoomEvent.DataReceived fires with an empty/undefined `participant`
  // (a known LiveKit behavior for RoomServiceClient.sendData — see
  // livekit/node-sdks#586) — sender identity has to travel inside the
  // payload itself instead. lib/hooks/useLiveKitRoom.ts reads
  // senderName/senderId from here rather than from the event's
  // participant argument.
  const payload = type === "comment"
    ? { text, senderId: user.id, senderName: displayName }
    : { senderId: user.id, senderName: displayName };

  try {
    await roomService.sendData(roomName, encoder.encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, { topic: type });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to relay message: ${err}` }), { status: 500 });
  }

  return new Response(JSON.stringify({ relayed: true }), { headers: { "Content-Type": "application/json" } });
});
