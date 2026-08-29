import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { usePiPPreference } from "../../lib/hooks/usePiPPreference";

export type ReelVideoPlayerHandle = { seekToPct: (pct: number) => void };

type Props = {
  uri: string;
  isActive: boolean;
  paused: boolean;
  speed: 1 | 2;
  autoAdvance: boolean;
  muted: boolean;
  onPosition: (currentSec: number, durationSec: number) => void;
  onFinished: () => void;
};

// ↔ ترقية expo-av → expo-video (طلب المستخدم — الميزة 2: PiP). العنصر ده
// بيحل محل <Video> بتاعت expo-av فى ReelCard.tsx بالظبط بنفس السلوك
// (كتم/تمرير تلقائي/سرعة 2x/تتبع الموضع/اكتشاف الانتهاء)، زائد PiP حقيقي
// عبر allowsPictureInPicture — أول مرة الخاصية دي بقت شغالة فعليًا فى
// التطبيق (كانت قبل كده مجرد تفضيل متخزّن بدون تشغيل فعلي، شوف
// usePiPPreference.ts).
//
// ↔ ليه فى كومبوننت منفصل: useVideoPlayer() هوك، ومينفعش يتنده شرطيًا
// جوه ReelCard (اللي بس بيعمل mount لعنصر الفيديو الحقيقي لما
// isNearActive تكون true). عزل الهوك هنا جوه كومبوننت بيتعمله mount/
// unmount بالكامل حسب isNearActive بيحل المشكلة من غير ما يخالف قواعد
// الـ Hooks.
export const ReelVideoPlayer = forwardRef<ReelVideoPlayerHandle, Props>(function ReelVideoPlayer(
  { uri, isActive, paused, speed, autoAdvance, muted, onPosition, onFinished },
  ref
) {
  const { preference: pipPreference } = usePiPPreference();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = !autoAdvance;
    // ↔ مهم: timeUpdateEventInterval بيبقى 0 افتراضيًا فى expo-video (يعني
    // event الـ "timeUpdate" مش بيتبعت خالص من غير ما نحدده صراحةً) —
    // بدونها شريط الـ seek كان هيفضل واقف على 0:00 طول الوقت، من غير أي
    // خطأ ظاهر فى الكونسول يوضح السبب.
    p.timeUpdateEventInterval = 0.25;
  });

  // ↔ نفس الـ workaround اللي كان موجود مع expo-av: لما الفيديو يوصل
  // لآخره من غير loop (autoAdvance مفعّل)، الـ player بيفضل واقف عند آخر
  // فريم ومبيرجعش لأول تلقائيًا — فلو المستخدم رجع لنفس الريل ده تانى،
  // finishedRef بيسجّل إننا محتاجين نرجّع currentTime لصفر قبل ما نشغّله.
  const finishedRef = useRef(false);

  useEffect(() => { player.loop = !autoAdvance; }, [player, autoAdvance]);
  useEffect(() => { player.muted = muted; }, [player, muted]);
  useEffect(() => { player.playbackRate = speed; }, [player, speed]);

  useEffect(() => {
    const shouldPlay = isActive && !paused;
    if (shouldPlay) {
      if (finishedRef.current) {
        finishedRef.current = false;
        player.currentTime = 0;
      }
      player.play();
    } else {
      player.pause();
    }
  }, [player, isActive, paused]);

  useEventListener(player, "playToEnd", () => {
    if (autoAdvance) finishedRef.current = true;
    onFinished();
  });

  useEventListener(player, "timeUpdate", (payload) => {
    onPosition(payload.currentTime, player.duration || 0);
  });

  useImperativeHandle(ref, () => ({
    seekToPct(pct: number) {
      if (!player.duration) return;
      player.currentTime = pct * player.duration;
    },
  }), [player]);

  return (
    <VideoView
      player={player as unknown as ComponentProps<typeof VideoView>["player"]}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
      // ↔ الميزة 2 (PiP): مفعّلة بس لو المستخدم وافق صراحةً من مودال
      // "عرض التطبيق فوق التطبيقات الأخرى" (شوف PictureInPictureModal.tsx)
      // — مش مفعّلة بشكل افتراضي لكل الفيديوهات.
      allowsPictureInPicture={pipPreference === "enabled"}
      startsPictureInPictureAutomatically={pipPreference === "enabled" && isActive}
    />
  );
});
