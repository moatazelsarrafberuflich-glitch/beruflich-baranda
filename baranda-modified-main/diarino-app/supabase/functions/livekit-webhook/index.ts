// supabase/functions/livekit-webhook/index.ts
//
// LiveKit calls this URL directly (server-to-server) whenever a room's
// state changes. Handles two things:
//  1. `room_finished` — fires once a room's been empty past its empty-
//     timeout, covering the crash/force-quit case that "إنهاء"
//     (endLiveRoom) doesn't: if a broadcaster's app dies without calling
//     endLiveRoom, this is what actually closes the `lives` row instead of
//     it staying status='live' forever.
//  2. `egress_ended` — fires once a recording has finished encoding and
//     uploading. Builds the recording's public Storage URL from the bucket
//     + the filepath we set at start time (not from Egress's own `location`
//     field, whose format varies by storage provider) and marks the row
//     'ready' (or 'failed').
//
// IMPORTANT: this endpoint is NOT called with a Supabase user session — it's
// LiveKit calling us directly, authenticated by its own signed-webhook
// scheme (WebhookReceiver below), not a Supabase JWT. So:
//   1. Deploy with JWT verification OFF for this function:
//        supabase functions deploy livekit-webhook --no-verify-jwt
//   2. It uses the SERVICE ROLE key (bypasses RLS) since there's no user
//      to scope the update to — this is the one place in the app that's
//      intentionally allowed to write host_id-agnostic updates, and it's
//      safe because access is gated by the LiveKit signature check, not RLS.
//
// Env vars to set (supabase secrets set ...):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET (same as livekit-token)
//   SUPABASE_SERVICE_ROLE_KEY (NOT the anon key — service role only)
//   RECORDING_S3_BUCKET (same bucket used in livekit-recording)
//
// LiveKit Cloud dashboard → Settings → Webhooks → add:
//   https://<your-project-ref>.supabase.co/functions/v1/livekit-webhook

import { createClient } from "jsr:@supabase/supabase-js@2";
import { WebhookReceiver } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";

const receiver = new WebhookReceiver(
  Deno.env.get("LIVEKIT_API_KEY")!,
  Deno.env.get("LIVEKIT_API_SECRET")!
);

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const authHeader = req.headers.get("Authorization") ?? "";

  let event;
  try {
    // Verifies LiveKit's signature on the payload — this is what proves
    // the request actually came from LiveKit and wasn't forged by a
    // random caller trying to mark someone else's live as ended.
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid webhook signature" }), { status: 401 });
  }

  if (event.event === "room_finished" && event.room?.name) {
    const { error } = await supabaseAdmin
      .from("lives")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("room_name", event.room.name)
      .eq("status", "live"); // no-op if it was already ended via endLiveRoom()

    if (error) {
      console.error("Failed to close lives row on room_finished:", error);
      return new Response(JSON.stringify({ error: "DB update failed" }), { status: 500 });
    }
  }

  if (event.event === "egress_ended" && event.egressInfo?.egressId) {
    const info = event.egressInfo;
    const succeeded = info.status === "EGRESS_COMPLETE";

    // Public URL is built from the bucket + the filepath WE set at start
    // time (recording_filepath), not parsed from Egress's `location` field
    // — that field's format varies by storage provider and isn't worth
    // depending on when we already know exactly where the file landed.
    const bucket = Deno.env.get("RECORDING_S3_BUCKET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const { data: live } = await supabaseAdmin
      .from("lives")
      .select("id, recording_filepath")
      .eq("egress_id", info.egressId)
      .maybeSingle();

    if (live) {
      const recordingUrl = succeeded && live.recording_filepath
        ? `${supabaseUrl}/storage/v1/object/public/${bucket}/${live.recording_filepath}`
        : null;

      await supabaseAdmin
        .from("lives")
        .update({
          recording_status: succeeded ? "ready" : "failed",
          recording_url: recordingUrl,
        })
        .eq("id", live.id);
    }
  }

  // room_started / participant_joined / egress_started / egress_updated /
  // etc. are ignored for now — nothing in the app currently needs them.

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
