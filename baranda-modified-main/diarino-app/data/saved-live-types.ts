import { Seller } from "../lib/types";

// ↔ the object pushed into savedLives[] in app-viewer.html (endBroadcast()
// / savedEntry), extended with recording tracking. The actual video comes
// from LiveKit Egress (room-composite recording to Supabase Storage) — see
// supabase/functions/livekit-recording and livekit-webhook's egress_ended
// handler. recordingStatus starts 'recording', becomes 'processing' when
// the broadcaster ends the stream, and 'ready' (with recordingUrl set)
// once encoding + upload finish — that last transition happens server-side
// via webhook, so the client polls lib/hooks/useLiveRecordingStatus.ts to
// pick it up.
export type SavedLive = {
  id: string;
  roomName: string; // ↔ correlates this local entry with its `lives` Supabase row
  title: string;
  seller: Seller;
  createdAt: number;
  durationSec: number;
  posterUrl: string | null;
  publishedPublic: boolean;
  commentsHidden: boolean;
  pinned?: boolean;
  pinnedAt?: number;
  viewerPeak: number;
  egressId?: string;
  recordingStatus: "none" | "recording" | "processing" | "ready" | "failed";
  recordingUrl: string | null;
};
