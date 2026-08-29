import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RoomEvent } from "../livekit-platform";
import { fetchLiveKitToken, LiveKitConnectionInfo, sendLiveMessage } from "../livekit";
import { LiveComment } from "../../components/live/LiveCommentsOverlay";
import { useRoomContext } from "../livekit-platform";
import { useCurrentUser } from "./useCurrentUser";
import { supabase } from "../supabase";

// Fetch the token/url pair BEFORE mounting <LiveKitRoom> — the component
// needs both up front as props, unlike the web version where getUserMedia
// + the socket connect happened imperatively inside one long function.
// No `role` param here on purpose — the server decides publish rights by
// checking `lives.host_id` against the caller, not by trusting a client flag.
export function useLiveKitToken(roomName: string) {
  const [info, setInfo] = useState<LiveKitConnectionInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!roomName) return;
    let cancelled = false;
    fetchLiveKitToken(roomName)
      .then((res) => { if (!cancelled) setInfo(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err : new Error(String(err))); });
    return () => { cancelled = true; };
  }, [roomName]);

  return { info, error, ready: !!info };
}

const decoder = new TextDecoder();

// ↔ liveComments[id] + sendLiveComment()/tickLiveSim() in app-viewer.html,
// now backed by LiveKit's reliable data channel instead of a local mock array.
// Must be called from a component rendered *inside* <LiveKitRoom>.
//
// Client-side rate limit: max COMMENTS_PER_SECOND sends per rolling 1s
// window, per local sender. Over the limit → silently dropped before even
// reaching the network. This is now a UX nicety, not the real guard —
// the actual enforcement is server-side (see livekit-send-message and
// 20260826000000_live_message_rate_limit.sql), reached because
// canPublishData is false for everyone (livekit-token/index.ts), so this
// client-side cap just saves a round trip for the common case of someone
// mashing "send" rather than being the thing standing between the room
// and a flood.
const COMMENTS_PER_SECOND = 3;

export function useLiveComments(displayName: string) {
  const { user } = useCurrentUser();
  const room = useRoomContext();
  const [comments, setComments] = useState<LiveComment[]>([]);
  const sendTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== "comment") return;
      try {
        const msg = JSON.parse(decoder.decode(payload)) as { text: string; senderId?: string; senderName?: string };
        // Every message is now relayed server-side via
        // RoomServiceClient.sendData() with no destinationIdentities
        // filter, which broadcasts to the whole room — *including* the
        // sender themselves. Skip our own; sendComment() below already
        // echoed it locally the instant it was sent, so this would
        // otherwise show up twice.
        if (msg.senderId && msg.senderId === user?.id) return;
        setComments((prev) => [
          ...prev,
          { id: `${Date.now()}-${Math.random()}`, name: msg.senderName || "زائر", text: msg.text },
        ]);
      } catch {
        // ignore malformed payloads
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, user?.id]);

  const sendComment = useCallback(
    (text: string) => {
      if (!room) return;
      const now = Date.now();
      sendTimestampsRef.current = sendTimestampsRef.current.filter((t) => now - t < 1000);
      if (sendTimestampsRef.current.length >= COMMENTS_PER_SECOND) return; // over the cap — drop silently, don't even ask the server
      sendTimestampsRef.current.push(now);

      // Echo locally immediately so the sender isn't waiting on the
      // Edge Function round trip + the relay coming back through LiveKit.
      // The server-relayed copy of this same message is filtered out
      // above once it arrives (matched by senderId).
      setComments((prev) => [...prev, { id: `${Date.now()}-local`, name: displayName, text }]);
      sendLiveMessage(room.name, "comment", text).catch((err) => console.warn("Failed to send live comment:", err));
    },
    [room, displayName]
  );

  return { comments, sendComment };
}

// ↔ the viewer/broadcaster "❤️" tap — modeled as an ephemeral floating-heart
// burst (same as Instagram/TikTok Live), not a persisted per-user toggle
// like the reel like button (lib/hooks/useLikes.ts). A live broadcast has
// no stable "like count" to restore on refresh the way a reel does, so
// there's nothing to persist — just broadcast the tap to everyone in the
// room over the same server-relayed channel now used for comments (see
// useLiveComments above and livekit-send-message).
//
// Same client-side rate-limit shape as useLiveComments — LIKES_PER_SECOND
// per rolling 1s window, excess taps dropped before even reaching the
// network. Real enforcement is server-side (same Edge Function, same
// bump_live_message_rate() check with a higher limit for 'like').
const LIKES_PER_SECOND = 5;

export function useLiveLikes() {
  const { user } = useCurrentUser();
  const room = useRoomContext();
  const [burstId, setBurstId] = useState(0);
  const sendTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== "like") return;
      try {
        const msg = JSON.parse(decoder.decode(payload)) as { senderId?: string };
        // Same self-echo dedup as useLiveComments — the relay reaches the
        // sender too, and sendLike() below already showed it locally.
        if (msg.senderId && msg.senderId === user?.id) return;
      } catch {
        // malformed payload — still worth showing a heart burst, so fall through
      }
      setBurstId((n) => n + 1);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, user?.id]);

  const sendLike = useCallback(() => {
    if (!room) return;
    const now = Date.now();
    sendTimestampsRef.current = sendTimestampsRef.current.filter((t) => now - t < 1000);
    if (sendTimestampsRef.current.length >= LIKES_PER_SECOND) return; // over the cap — drop silently, don't even ask the server
    sendTimestampsRef.current.push(now);

    setBurstId((n) => n + 1); // show it locally right away too
    sendLiveMessage(room.name, "like").catch((err) => console.warn("Failed to send live like:", err));
  }, [room]);

  return { burstId, sendLike };
}

// ↔ replaces app/live/[id].tsx's old "no lives table yet, trust the
// caller's query params for title/sellerName" approach — that meant the
// follow button there had no real seller id to act on at all. Looked up
// by room_name since that's what's passed through the route as `id`.
type LiveByRoomName = { id: string; hostId: string; title: string | null; hostName: string | null };

export function useLiveByRoomName(roomName: string) {
  return useQuery({
    queryKey: ["liveByRoomName", roomName],
    queryFn: async (): Promise<LiveByRoomName> => {
      const { data, error } = await supabase
        .from("lives")
        // ↔ profiles_public, not profiles — any viewer who opens this
        // room (not just the host, not just people the host has chatted
        // with) needs the host's display name. See
        // 20260825000000_profile_privacy_rls.sql.
        .select("id, host_id, title, profiles_public!host_id(full_name)")
        .eq("room_name", roomName)
        .single();
      if (error) throw error;
      const row = data as unknown as { id: string; host_id: string; title: string | null; profiles_public: { full_name: string | null } | null };
      return { id: row.id, hostId: row.host_id, title: row.title, hostName: row.profiles_public?.full_name ?? null };
    },
    enabled: !!roomName,
    staleTime: 10_000,
  });
}

