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

// ↔ إصلاح تدوير الكاميرا على الموبايل (Android/iOS/APK): `restartTrack`
// (اللي بيستخدمها إصدار الويب) بتقفل الكاميرا بالكامل وتفتحها تاني بقيود
// جديدة (facingMode) — ده بيعمل تفاوض WebRTC كامل من الصفر، وعلى بعض
// أجهزة الأندرويد بيتعارض مع جلسة الكاميرا القديمة اللي لسه مقفلتش
// (crash/تجمد فعلي وقت التبديل). الطريقة المعتمدة رسميًا من
// react-native-webrtc/LiveKit للموبايل هي `_switchCamera()` على
// الـ MediaStreamTrack نفسه: بتبدّل بين الكاميرا الأمامية والخلفية
// فورًا من غير قفل/فتح الجلسة من الأول، وهي الأسرع والأضمن على الأجهزة.
type NativeSwitchableTrack = { _switchCamera?: () => void };

// ↔ `nextFacingMode` مش محتاج فعليًا هنا (`_switchCamera()` بتبدّل من
// غير ما تحدد اتجاه)، لكن باقي في التوقيع عشان يتطابق تمامًا مع نظيره
// فى livekit-platform.web.tsx — التوقيعان لازم يكونا متطابقين حرفيًا،
// لأن TypeScript وقت الفحص الساكن (tsc) مش بيفرّق بين .native.tsx
// و.web.tsx زي ما Metro بيعمل وقت التشغيل الفعلي.
export async function switchCamera(
  track: LocalVideoTrack,
  _nextFacingMode: "user" | "environment"
): Promise<void> {
  const mediaStreamTrack = track.mediaStreamTrack as unknown as NativeSwitchableTrack;
  if (typeof mediaStreamTrack._switchCamera !== "function") {
    throw new Error("Camera switching is not supported on this device.");
  }
  mediaStreamTrack._switchCamera();
}