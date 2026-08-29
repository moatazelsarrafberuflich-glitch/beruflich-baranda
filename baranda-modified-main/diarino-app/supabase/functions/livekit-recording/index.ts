// supabase/functions/livekit-recording/index.ts
//
// Starts/stops a LiveKit Egress room-composite recording. Output goes to
// Supabase Storage through its S3-compatible API — Supabase Storage has
// supported S3-compatible access for a while now (Project Settings →
// Storage → S3 Connection gives you the endpoint/keys), so Egress can
// write directly into a normal Storage bucket without a separate cloud
// storage account.
//
// SECURITY: same pattern as livekit-token — only the room's host_id (from
// the `lives` table, checked against the caller's own JWT) can start or
// stop a recording for that room.
//
// Deploy: supabase functions deploy livekit-recording
// Env vars (supabase secrets set ...):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL (same as livekit-token)
//   RECORDING_S3_ACCESS_KEY, RECORDING_S3_SECRET, RECORDING_S3_ENDPOINT,
//   RECORDING_S3_BUCKET, RECORDING_S3_REGION
//     (from your Supabase project's Storage → S3 Connection panel;
//      create a "live-recordings" bucket there first)
//
// Request body:
//   { action: "start", roomName: string }
//   { action: "stop", roomName: string, egressId: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";

const egressClient = new EgressClient(
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

  let body: { action?: "start" | "stop"; roomName?: string; egressId?: string; durationSec?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  const { action, roomName } = body;
  if (!action || !roomName) {
    return new Response(JSON.stringify({ error: "action and roomName are required" }), { status: 400 });
  }

  // Same ownership check as livekit-token — only the host can control
  // recording for their own room.
  const { data: live, error: liveError } = await supabase
    .from("lives")
    .select("id, host_id, status")
    .eq("room_name", roomName)
    .maybeSingle();

  if (liveError) return new Response(JSON.stringify({ error: "Failed to look up room" }), { status: 500 });
  if (!live) return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
  if (live.host_id !== user.id) return new Response(JSON.stringify({ error: "Not the host of this room" }), { status: 403 });

  if (action === "start") {
    const filepath = `recordings/${roomName}-${Date.now()}.mp4`;
    try {
      // ↔ current livekit-server-sdk v2 shape — output must be built from
      // the EncodedFileOutput/S3Upload classes (not plain object literals),
      // passed as { file: fileOutput } to startRoomCompositeEgress.
      const fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: "s3",
          value: new S3Upload({
            accessKey: Deno.env.get("RECORDING_S3_ACCESS_KEY")!,
            secret: Deno.env.get("RECORDING_S3_SECRET")!,
            bucket: Deno.env.get("RECORDING_S3_BUCKET")!,
            region: Deno.env.get("RECORDING_S3_REGION") || "us-east-1",
            endpoint: Deno.env.get("RECORDING_S3_ENDPOINT")!,
            forcePathStyle: true, // Supabase's S3-compatible endpoint needs path-style requests
          }),
        },
      });

      const info = await egressClient.startRoomCompositeEgress(roomName, { file: fileOutput }, { layout: "grid" });

      await supabase
        .from("lives")
        .update({ egress_id: info.egressId, recording_filepath: filepath, recording_status: "recording" })
        .eq("id", live.id);

      return new Response(JSON.stringify({ egressId: info.egressId, filepath }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Failed to start recording: ${err}` }), { status: 500 });
    }
  }

  if (action === "stop") {
    if (!body.egressId) {
      return new Response(JSON.stringify({ error: "egressId is required to stop" }), { status: 400 });
    }
    try {
      await egressClient.stopEgress(body.egressId);
      // Final recording_url arrives via the livekit-webhook's egress_ended
      // handler once encoding + upload actually finish — this just marks
      // the in-between state so the UI can show "جارٍ المعالجة".
      // durationSec is measured client-side (broadcast start→end) rather
      // than trusted from Egress's own webhook payload, which has had
      // reported bugs with negative/missing durations on some sessions.
      const durationSec = typeof body.durationSec === "number" ? body.durationSec : null;
      await supabase
        .from("lives")
        .update({ recording_status: "processing", ...(durationSec != null ? { duration_sec: durationSec } : {}) })
        .eq("id", live.id);
      return new Response(JSON.stringify({ stopped: true }), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Failed to stop recording: ${err}` }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
});
