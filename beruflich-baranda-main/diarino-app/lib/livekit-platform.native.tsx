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
import { registerGlobals as webrtcRegisterGlobals } from "@livekit/react-native";
import type {
  Track as LiveKitTrack,
  LocalVideoTrack,
  RoomEvent as LiveKitRoomEvent,
  DisconnectReason as LiveKitDisconnectReason,
} from "livekit-client";

// ↔ عطل موثَّق ومؤكَّد فى @livekit/react-native-webrtc@144.x (LiveKit
// GitHub issue #397): registerGlobals() الأصلية بتسجّل كل الـ globals
// المطلوبة لـ WebRTC (RTCPeerConnection, MediaStream, RTCIceCandidate...)
// إلا "RTCDataChannel" — منسية تمامًا، وكمان مش مُصدَّرة أصلًا من نقطة
// الدخول العامة للمكتبة. النتيجة: أول ما livekit-client يحاول يستخدم
// RTCDataChannel أثناء التفاوض (negotiation) بتاع الغرفة، بيلاقيه
// undefined فيرمي بالظبط: "TypeError: Cannot read property 'prototype'
// of undefined" — وهي نفس الرسالة اللي بتظهر فى شاشة "اطلع لايف" عندنا،
// وبتوقف التفاوض بالكامل (الـ engine فاضل "connecting" للأبد وميوصلش
// "connected"، فأي عملية بعد كده — تبديل كاميرا، فك كتم الميكروفون،
// إرسال تعليق — بتفشل بـ timeout لأن الـ SFU مش متصل أصلًا).
//
// الإصلاح ده كان موجود قبل كده بس كان هش من ٣ جوانب:
//   ١) استدعاء webrtcRegisterGlobals() و"ترقيع" RTCDataChannel كانا فى
//      نفس try/catch ضمنيًا (من خلال الملف اللي بيستدعي الدالة دي) —
//      لو webrtcRegisterGlobals() نفسها رمت استثناء (زي اللي شفناه فعليًا
//      فى الـ logcat: "Requiring unknown module 'undefined'")، كود
//      الترقيع تحته ميتنفذش خالص، ومفيش أي إشارة إن الترقيع فشل.
//   ٢) مسار الاستيراد الداخلي كان واحد بس وثابت (lib/commonjs/...) —
//      لو اختلف شكل التصدير بين الإصدارات (default export مقابل
//      named export مقابل module.exports مباشرة) بيرجع require().default
//      = undefined من غير ما يرمي استثناء، فـ global.RTCDataChannel
//      يتسجّل بقيمة undefined من غير أي تحذير — يعني وهم إصلاح.
//   ٣) مفيش أي تحقق إن القيمة النهائية فعلاً constructor صالح
//      (عنده .prototype) قبل ما نسجّلها كـ global.
//
// الحل هنا: كل خطوة معزولة فى try/catch مستقل (فشل خطوة مايوقفش اللي
// بعدها)، بنجرّب أكتر من مسار/شكل تصدير محتمل، وبنتحقق إن القيمة
// شكلها constructor فعلي قبل التسجيل، ولو الكل فشل بنطلع تحذير واضح
// (مش نبلعه) عشان يبان فى الـ logs بدل ما يتحول لكراش غامض بعد كده.
let didRegisterGlobals = false;
type RTCDataChannelConstructor = typeof globalThis.RTCDataChannel;
type RTCDataChannelModule = {
  default?: unknown;
  RTCDataChannel?: unknown;
};

function tryLoadRealRTCDataChannel(): RTCDataChannelConstructor | null {
  try {
    // المسار literal مقصود: Metro يستطيع تضمينه في Android/iOS، بخلاف
    // require(path) الديناميكي الذي يرفضه أثناء تحليل bundle.
    const module = require("@livekit/react-native-webrtc/lib/commonjs/RTCDataChannel") as RTCDataChannelModule;
    const candidate = module.default ?? module.RTCDataChannel;
    if (typeof candidate === "function" && candidate.prototype) {
      return candidate as RTCDataChannelConstructor;
    }
  } catch {
    // سيظهر التحذير في registerGlobals إذا لم توفر النسخة المثبتة البناء المتوقع.
  }
  return null;
}

export function registerGlobals(): void {
  // idempotent فعليًا بدل ما نعتمد على استثناء المكتبة الأصلية (اللي مش
  // مضمون سببه دايمًا "already initialized" زي ما كنا مفترضين).
  if (didRegisterGlobals) return;

  try {
    webrtcRegisterGlobals();
  } catch (e) {
    // بنسجّل الخطأ الحقيقي كامل هنا بدل ما نفترضه "already initialized" —
    // لو فيه مشكلة ربط native module حقيقية (زي اللي ظهرت فى الـ APK:
    // "Requiring unknown module 'undefined'")، لازم تبان واضحة فى الـ logs.
    console.warn(
      "[LiveKit] webrtcRegisterGlobals() threw — WebRTC globals may be incomplete on this build:",
      e
    );
  }

  const runtimeGlobal = globalThis as typeof globalThis & { RTCDataChannel?: RTCDataChannelConstructor };
  if (typeof runtimeGlobal.RTCDataChannel !== "function" || !runtimeGlobal.RTCDataChannel.prototype) {
    const RealRTCDataChannel = tryLoadRealRTCDataChannel();
    if (RealRTCDataChannel) {
      runtimeGlobal.RTCDataChannel = RealRTCDataChannel;
    } else {
      console.warn(
        "[LiveKit] Could not polyfill global.RTCDataChannel from any known path — " +
          "room connections will fail with \"Cannot read property 'prototype' of undefined\". " +
          "Check the installed @livekit/react-native-webrtc version's internal file layout."
      );
    }
  }

  didRegisterGlobals = true;
}

export type { Participant } from "livekit-client";
// ↔ type-only export (بيتشال بالكامل وقت البناء، صفر خطر توقيت) — للاستخدام
// كـ type annotation بس (زي `reason?: DisconnectReason`)، مش كـ قيمة.
// القيمة الفعلية (DisconnectReason.PARTICIPANT_REMOVED) بتيجي من
// getDisconnectReason() تحت.
export type { DisconnectReason } from "livekit-client";

// ↔ السبب الجذري المؤكَّد لكراش "اطلع لايف" (من adb logcat):
//   TypeError: Super expression must either be null or a function
//   TypeError: Cannot read property 'ErrorBoundary' of undefined
//   ... in LiveLayout ...
//
// استيراد Track/RoomEvent/DisconnectReason/LocalVideoTrack من livekit-client
// كـ import عادي فى أعلى الملف كان معناه إن Metro لازم يقيّم الشجرة الداخلية
// الكاملة لـ livekit-client (فيها استيراد دائري بين Track ↔ LocalTrack ↔
// LocalVideoTrack) فى **نفس لحظة تحميل هذا الملف بالضبط**. المشكلة إن
// Expo Router بيحمّل app/live/broadcast.tsx و app/live/[id].tsx بشكل كسول
// (lazy، جوه Suspense) أول مرة المستخدم يدخل شاشة اللايف — وده توقيت
// تحميل مختلف عن أي استيراد عادي وقت إقلاع التطبيق. فى التوقيت ده تحديدًا،
// بعض كلاسات livekit-client (زي اللي بيعمل extends لكلاس تاني لسه ما
// خلصش تحميله بسبب الدائرية) بترجع undefined لحظيًا، فـ "class X extends
// undefined" بيرمي الخطأ فورًا أثناء *تحميل* الملف نفسه — يعني قبل أي
// كود بتاعنا يتنفذ خالص. النتيجة: Expo Router بيوصله module فاضي
// (undefined) للشاشة كلها، فبيحاول يقرأ .ErrorBoundary منها ويطلع
// بالخطأ التاني، والمستخدم يحس إن التطبيق "قفل فجأة".
//
// الحل: مش هنستورد الكلاسات/الـ enums دي بشكل eager (وقت تحميل الملف)،
// هنأجّل استيرادها بـ require() جوه دالة، تتنفذ بس أول مرة حد فعليًا
// يستخدمها — وقتها يكون التطبيق خلص إقلاع بالكامل وكل موديولات
// livekit-client كانت خلصت تحميل مرة واحدة من غير أي مشكلة ترتيب.
let cachedLiveKitClient: typeof import("livekit-client") | null = null;
function loadLiveKitClient(): typeof import("livekit-client") {
  if (!cachedLiveKitClient) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedLiveKitClient = require("livekit-client") as typeof import("livekit-client");
  }
  return cachedLiveKitClient;
}

export function getTrackEnum(): typeof LiveKitTrack {
  return loadLiveKitClient().Track;
}
export function getRoomEvent(): typeof LiveKitRoomEvent {
  return loadLiveKitClient().RoomEvent;
}
export function getDisconnectReason(): typeof LiveKitDisconnectReason {
  return loadLiveKitClient().DisconnectReason;
}

export function isLocalVideoTrack(track: LiveKitTrack | undefined): track is LocalVideoTrack {
  return track instanceof loadLiveKitClient().LocalVideoTrack;
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