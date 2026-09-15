// @ts-nocheck
// supabase/functions/livekit-moderate/index.ts
//
// Removes a participant from a live LiveKit room ("kick"). Host-only.
//
// SECURITY: same ownership-check pattern as livekit-token/livekit-recording —
// only the room's host_id (looked up from the `lives` table, checked against
// the caller's own Supabase-verified JWT) can moderate that room. The caller
// never gets to assert their own role; it's derived server-side every time.
// A host also can't remove themselves this way (see the self-kick guard
// below) — ending their own broadcast is a separate, existing flow
// (endLiveRoom + room.disconnect() in app/live/broadcast.tsx).
//
// Deploy: supabase functions deploy livekit-moderate
// Env vars (supabase secrets set ...): LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
//   (same as livekit-token / livekit-recording)
//
// Request body: { roomName: string, participantIdentity: string }
// `participantIdentity` is the LiveKit participant identity, which is always
// the target user's Supabase auth.uid() — see the `identity: user.id` grant
// in livekit-token/index.ts. Not an arbitrary client-chosen string.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { RoomServiceClient } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";

const roomService = new RoomServiceClient(
  Deno.env.get("LIVEKIT_URL")!,
  Deno.env.get("LIVEKIT_API_KEY")!,
  Deno.env.get("LIVEKIT_API_SECRET")!
);

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 });
  }

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

  let body: { roomName?: string; participantIdentity?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  const { roomName, participantIdentity } = body;
  if (!roomName || !participantIdentity) {
    return new Response(JSON.stringify({ error: "roomName and participantIdentity are required" }), { status: 400 });
  }

  // Same ownership check as livekit-token/livekit-recording — only the
  // host can moderate their own room.
  const { data: live, error: liveError } = await supabase
    .from("lives")
    .select("id, host_id, status")
    .eq("room_name", roomName)
    .maybeSingle();

  if (liveError) return new Response(JSON.stringify({ error: "Failed to look up room" }), { status: 500 });
  if (!live) return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
  if (live.host_id !== user.id) return new Response(JSON.stringify({ error: "Not the host of this room" }), { status: 403 });

  // A host removing themselves would just be a confusing way to end their
  // own broadcast (and would leave `lives.status` never set to "ended") —
  // that flow already exists (endLiveRoom + room.disconnect()), so this
  // endpoint refuses to be used as a substitute for it.
  if (participantIdentity === user.id) {
    return new Response(JSON.stringify({ error: "Cannot remove yourself — use \"end stream\" instead" }), { status: 400 });
  }

  try {
    await roomService.removeParticipant(roomName, participantIdentity);
    return new Response(JSON.stringify({ removed: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    // removeParticipant throws if the identity is no longer in the room
    // (e.g. they'd already left) — treat that as a harmless no-op rather
    // than a hard failure, since the end state the caller wanted (that
    // participant not being in the room) is already true.
    const message = String(err);
    if (message.includes("not found") || message.includes("404")) {
      return new Response(JSON.stringify({ removed: true, alreadyGone: true }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: `Failed to remove participant: ${err}` }), { status: 500 });
  }
});
