export {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { DisconnectReason, LocalVideoTrack, RoomEvent, Track } from "livekit-client";
import type { Track as LiveKitTrack } from "livekit-client";

export { DisconnectReason, RoomEvent, Track };
export type { Participant } from "livekit-client";
export { registerGlobals } from "@livekit/react-native";

export function isLocalVideoTrack(track: LiveKitTrack | undefined): track is LocalVideoTrack {
  return track instanceof LocalVideoTrack;
}