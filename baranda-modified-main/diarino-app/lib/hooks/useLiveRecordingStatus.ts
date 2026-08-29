import { useEffect } from "react";
import { supabase } from "../supabase";
import { useMyContent } from "./useMyContent";

const POLL_MS = 5000;

// Bridges "broadcaster tapped إنهاء" (recording_status → 'processing'
// immediately, client-side) and "Egress actually finished uploading"
// (recording_status → 'ready'/'failed', set server-side by the
// livekit-webhook's egress_ended handler, asynchronously). Realtime would
// be the cleaner way to catch this, but that needs the `lives` table added
// to a Supabase realtime publication as a separate setup step — polling is
// simpler here and doesn't depend on that being configured.
//
// Called once (e.g. at the top of the account screen), not per-item —
// iterates whatever's currently 'processing' on every tick, so it's safe
// regardless of how many recordings are in flight or how that number
// changes between renders.
export function useSyncProcessingRecordings() {
  const { savedLives, updateSavedLive } = useMyContent();

  useEffect(() => {
    const processing = savedLives.filter((l) => l.recordingStatus === "processing");
    if (processing.length === 0) return;

    const interval = setInterval(async () => {
      for (const live of processing) {
        const { data } = await supabase
          .from("lives")
          .select("recording_status, recording_url")
          .eq("room_name", live.roomName)
          .maybeSingle();

        if (data && (data.recording_status === "ready" || data.recording_status === "failed")) {
          updateSavedLive(live.id, {
            recordingStatus: data.recording_status,
            recordingUrl: data.recording_url ?? null,
          });
        }
      }
    }, POLL_MS);

    return () => clearInterval(interval);
    // Re-run whenever the set of processing ids changes (new one started,
    // or one just resolved and should stop being polled).
  }, [savedLives.filter((l) => l.recordingStatus === "processing").map((l) => l.id).join(",")]);
}
