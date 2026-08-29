import { Platform, View, StyleProp, ViewStyle } from "react-native";
import type { ReactNode } from "react";
// ↔ #3: `import type` بيتشال بالكامل وقت الـ build (مفيش أي أثر وقت
// التشغيل)، فمفيش أي خطر إنه يسحب كود اللايف كيت جوه bundle الويب —
// المشكلة الموصوفة تحت (بتاعة livekit-client) كانت خاصة بـ *value*
// imports (require/import عادي) مش type-only imports زي ده. بيدّينا ده
// نوع دقيق لـ livekitModule بدل any.
import type * as LiveKitReactNativeNS from "@livekit/react-native";

let livekitModule: typeof LiveKitReactNativeNS | null = null;

if (Platform.OS !== "web") {
  livekitModule = require("@livekit/react-native");
}

export function registerGlobals() {
  if (!livekitModule?.registerGlobals) return;
  livekitModule.registerGlobals();
}

export const LiveKitRoom = Platform.OS === "web"
  ? ({ children }: { children: ReactNode }) => <>{children}</>
  : livekitModule?.LiveKitRoom;

export const useTracks = Platform.OS === "web"
  ? () => []
  : livekitModule?.useTracks;

export const useParticipants = Platform.OS === "web"
  ? () => []
  : livekitModule?.useParticipants;

export const useRoomContext = Platform.OS === "web"
  ? () => null
  : livekitModule?.useRoomContext;

export const useIsMuted = Platform.OS === "web"
  ? () => false
  : livekitModule?.useIsMuted;

export const VideoTrack = Platform.OS === "web"
  ? ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={style} />
  : livekitModule?.VideoTrack;

export const isTrackReference = Platform.OS === "web"
  ? () => false
  : livekitModule?.isTrackReference;

export const AudioSession = Platform.OS === "web"
  ? {
      startAudioSession: () => undefined,
      stopAudioSession: () => undefined,
    }
  : livekitModule?.AudioSession;

// ---------------------------------------------------------------------
// Track / RoomEvent / DisconnectReason / Participant
// ---------------------------------------------------------------------
// ↔ IMPORTANT: these used to be imported directly from "livekit-client"
// inside app/live/[id].tsx, app/live/broadcast.tsx, and
// lib/hooks/useLiveKitRoom.ts — all *shared* files with no .native/.web
// split. livekit-client is web-only, so that import pulled browser-only
// code into the native bundle: exactly the same failure mode that
// react-native-maps caused earlier (a web/native-only package reachable
// from a shared file's module graph), and the reason the "القائمة" tab
// (which used to pull in useLiveKitRoom.ts via useActiveLives) was exiting
// the app on native. Re-exporting them here — behind the same Platform.OS
// branch as everything else in this file — means every shared screen can
// import Track/RoomEvent/DisconnectReason from this module instead.
//
// @livekit/react-native implements the same LiveKit wire protocol as
// livekit-client (it's the same core engine with react-native-webrtc
// swapped in for the transport), and re-exports these same enums, so
// this pulls the *real* values from whichever SDK matches the current
// platform rather than hand-rolling a guess at them.
type LiveKitEnumModule = Record<string, unknown>;

const liveKitEnumSource: LiveKitEnumModule =
  (Platform.OS === "web" ? require("livekit-client") : livekitModule) ?? {};

export const Track = liveKitEnumSource.Track as { Source: { Camera: string; Microphone: string } };
export const RoomEvent = liveKitEnumSource.RoomEvent as { Disconnected: string; DataReceived: string };
export const DisconnectReason = liveKitEnumSource.DisconnectReason as { PARTICIPANT_REMOVED: number };
// `DisconnectReason` is used both as a value (DisconnectReason.PARTICIPANT_REMOVED
// above) and as a type annotation (`reason?: DisconnectReason` in
// app/live/[id].tsx) — a `type` and `const` of the same name can coexist
// since they live in separate namespaces, so this covers the type-only use
// without needing a real `enum` (which can't be conditionally required per
// platform the way this file's other exports are).
export type DisconnectReason = number;

// Pure structural type (not tied to either SDK's concrete class), since
// every place this app uses `Participant` only ever reads `.identity`,
// `.isLocal`, and `.name` off of it. The `name` field is optional as some
// participants may not have a display name set.
export type Participant = { identity: string; isLocal: boolean; name?: string };
