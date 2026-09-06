import { useRef, useState } from "react";
import { I18nManager, View, Text, Pressable, StyleSheet, PanResponder, GestureResponderEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useReelControlsBottomOffset } from "../../lib/uiConstants";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ .reel-seek-bar / .reel-seek-track — شريط تقدّم الوقت (زي أي مشغّل
// فيديو) بيفضل بنفس الترتيب البصري دايمًا (تشغيل → الوقت الحالي → الشريط
// → المدة الكاملة، من اليسار لليمين) فى اللغتين، بدل ما ينعكس مع RTL —
// نفس المنطق المستخدم فى شريط المهام العائم (_floating-tab-bar.tsx):
// flexDirection صريح بيلغي أثر الـ auto-mirroring بدل ما يعتمد عليه.
const FIXED_ROW_DIRECTION = I18nManager.isRTL ? "row-reverse" : "row";

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  currentSec: number;
  durationSec: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (pct: number) => void; // 0..1
};

export function ReelSeekBar({ currentSec, durationSec, isPlaying, onTogglePlay, onSeek }: Props) {
  const trackWidth = useRef(0);
  const pct = durationSec > 0 ? Math.min(1, currentSec / durationSec) : 0;
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  // ↔ #2/#3: الكارت بقى fullscreen كامل دلوقتي (useReelHeight)، فشريط الـ
  // seek لازم ياخد bottom offset صريح عشان يوقف فوق شريط المهام العائم
  // بدل ما يتغطّى بيه — بدل ما كان معتمد على bottom:0 من كارت مُنقّص الطول.
  const bottomOffset = useReelControlsBottomOffset();

  // ↔ إصلاح باغ #3: أثناء السحب، الـ pct والوقت المعروضين بياخدوا من هنا
  // (قيمة UI محلية بس، من غير أي seek فعلي للفيديو مع كل حركة إصبع) —
  // مش من `currentSec`/`pct` الحقيقيين (اللي بيتحدّثوا بس من التشغيل
  // الفعلي). ده اللي بيدّي سحب سلس وفوري + يعرض توقيت اللحظة المختارة
  // لحظيًا، وبيمنع عمل setPositionAsync (عملية native مكلفة) مع كل بكسل
  // تتحرك — بدل كده بتتنده مرة واحدة بس (onSeek) لما المستخدم يفلت
  // إصبعه، فالفيديو بينتقل فورًا للنقطة المختارة زي المطلوب بالظبط.
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const displayPct = dragging ? dragPct : pct;
  const displaySec = dragging ? dragPct * durationSec : currentSec;

  function pctFromEvent(e: GestureResponderEvent): number {
    if (!trackWidth.current) return 0;
    const x = e.nativeEvent.locationX;
    return Math.max(0, Math.min(1, x / trackWidth.current));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        setDragging(true);
        setDragPct(pctFromEvent(e));
      },
      onPanResponderMove: (e) => {
        setDragPct(pctFromEvent(e));
      },
      onPanResponderRelease: (e) => {
        const finalPct = pctFromEvent(e);
        setDragging(false);
        onSeek(finalPct);
      },
      onPanResponderTerminate: () => setDragging(false),
    })
  ).current;

  return (
    <View style={[styles.bar, { bottom: bottomOffset, flexDirection: FIXED_ROW_DIRECTION }]} onStartShouldSetResponder={() => true}>
      <Pressable style={styles.playBtn} onPress={onTogglePlay} hitSlop={6}>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill={themeColors.text}>
          {isPlaying ? <Path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <Path d="M8 5v14l11-7z" />}
        </Svg>
      </Pressable>
      <Text style={styles.time}>{formatTime(displaySec)}</Text>
      {/* ↔ إصلاح باغ #3: منطقة اللمس الفعلية بقت أطول رأسيًا (44pt عن
          طريق minHeight + التوسيط) من الشريط المرئي الرفيع (5px) نفسه —
          بدل ما تكون منطقة السحب بس بارتفاع الشريط الرفيع، اللي كانت
          أصغر بكتير من 44×44 المطلوبة لسهولة السحب بالإصبع. */}
      <View
        style={styles.trackTouchArea}
        onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      >
        {dragging && (
          <View style={[styles.dragTooltip, { left: `${displayPct * 100}%` }]} pointerEvents="none">
            <Text style={styles.dragTooltipText}>{formatTime(displaySec)}</Text>
          </View>
        )}
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${displayPct * 100}%` }]} />
          <View style={[styles.thumb, dragging && styles.thumbDragging, { left: `${displayPct * 100}%` }]} />
        </View>
      </View>
      <Text style={styles.time}>{formatTime(durationSec)}</Text>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  const barBg = themeColors.isDark ? "rgba(20,20,20,0.85)" : "rgba(255,255,255,0.9)";
  return StyleSheet.create({
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      zIndex: 45,
      alignItems: "center",
      gap: 8,
      backgroundColor: barBg,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    playBtn: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: themeColors.isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.08)",
      alignItems: "center", justifyContent: "center",
    },
    time: {
      color: themeColors.text, fontSize: 10, fontWeight: "900", minWidth: 34, textAlign: "center",
    },
    trackTouchArea: {
      flex: 1, minHeight: 44, justifyContent: "center", position: "relative",
    },
    track: {
      height: 5, backgroundColor: themeColors.isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)", borderRadius: 3, position: "relative",
    },
    fill: {
      height: "100%", backgroundColor: "#22A652", borderRadius: 3, position: "absolute", left: 0, top: 0,
    },
    thumb: {
      position: "absolute", top: "50%", marginTop: -7, marginLeft: -7,
      width: 14, height: 14, borderRadius: 7, backgroundColor: themeColors.text,
    },
    thumbDragging: {
      width: 18, height: 18, borderRadius: 9, marginTop: -9, marginLeft: -9,
      borderWidth: 2, borderColor: "#22A652",
    },
    dragTooltip: {
      position: "absolute", bottom: 30, marginLeft: -18,
      backgroundColor: themeColors.isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)",
      borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
      shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
    },
    dragTooltipText: { color: themeColors.text, fontSize: 11, fontWeight: "900" },
  });
}
