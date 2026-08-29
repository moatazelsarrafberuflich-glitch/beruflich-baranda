import type { CSSProperties, ComponentType } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  isTrackReference,
  LiveKitRoom as ComponentsLiveKitRoom,
  useIsMuted,
  useParticipants,
  useRoomContext,
  useTracks,
  VideoTrack as ComponentsVideoTrack,
} from "@livekit/components-react";
import type { TrackReference } from "@livekit/components-core";
import { DisconnectReason, LocalVideoTrack, RoomEvent, Track } from "livekit-client";
import type { Track as LiveKitTrack } from "livekit-client";
import type { Participant } from "livekit-client";

export { DisconnectReason, RoomEvent, Track, isTrackReference, useIsMuted, useParticipants, useRoomContext, useTracks };
export type { Participant };

export function isLocalVideoTrack(track: LiveKitTrack | undefined): track is LocalVideoTrack {
  return track instanceof LocalVideoTrack;
}

export function registerGlobals(): void {
  // Web LiveKit does not need native global registration.
}

export const LiveKitRoom = ComponentsLiveKitRoom;

type VideoTrackProps = {
  trackRef: TrackReference | undefined;
  style?: StyleProp<ViewStyle>;
};

export const VideoTrack: ComponentType<VideoTrackProps> = ({ trackRef, style }) => {
  if (!trackRef) return <View style={style} />;
  return <ComponentsVideoTrack trackRef={trackRef} style={style as CSSProperties} />;
};

export const AudioSession = {
  startAudioSession: (): void => undefined,
  stopAudioSession: (): void => undefined,
};
