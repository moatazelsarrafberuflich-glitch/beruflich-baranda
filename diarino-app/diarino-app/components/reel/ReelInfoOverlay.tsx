import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";
import { Property, fmtPrice } from "../../lib/types";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useReelControlsBottomOffset } from "../../lib/uiConstants";

// ↔ onLongPress here (not on the full-screen video Pressable in
// ReelCard, which already owns long-press for the 2x-speed hold) opens
// the quick "الإبلاغ عن هذا الريل" sheet — reporting a reel by holding
// down on its title/price card, without touching the playback gesture.
export function ReelInfoOverlay({
  property, onOpenDetails, onReport,
}: {
  property: Property; onOpenDetails: () => void; onReport?: () => void;
}) {
  const p = property;
  const { t, language } = useLanguage();
  const isAr = language !== "en";
  // ↔ #2/#3: نفس السبب زي ReelSeekBar/ReelActionRail — الكارت بقى
  // fullscreen كامل، فكارت الوصف لازم ياخد padding سفلي إضافي عشان يفضل
  // واقف فوق شريط المهام العائم وشريط الـ seek بدل ما يتغطّى بيهم.
  const bottomOffset = useReelControlsBottomOffset();
  return (
    // ↔ .gradient-overlay: linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.4) 40%, transparent 70%)
    <LinearGradient
      colors={["transparent", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.85)"]}
      locations={[0, 0.6, 1]}
      style={[styles.overlay, { paddingBottom: 70 + bottomOffset }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={[
          styles.infoBlock,
          { alignSelf: isAr ? "flex-end" : "flex-start", alignItems: isAr ? "flex-end" : "flex-start" },
        ]}
        onPress={onOpenDetails}
        onLongPress={onReport}
        delayLongPress={500}
      >
        <View style={styles.row}>
          <View style={[styles.purposeTag, { backgroundColor: p.purpose === "sale" ? "#22A652" : "#F4673F" }]}>
            <Text style={styles.purposeTagText}>{p.purpose === "sale" ? t("للبيع") : t("للإيجار")}</Text>
          </View>
          <Pressable style={styles.descBtn} onPress={onOpenDetails} hitSlop={6}>
            <Svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
              <Circle cx={12} cy={12} r={10} />
              <Path d="M12 16v-4M12 8h.01" />
            </Svg>
            <Text style={styles.descBtnText}>{t("التفاصيل")}</Text>
          </Pressable>
        </View>

        <Text style={[styles.title, { textAlign: isAr ? "right" : "left" }]} numberOfLines={1}>{p.shortTitle || p.title}</Text>
        <Text style={[styles.location, { textAlign: isAr ? "right" : "left" }]}>📍 {p.location}</Text>
        <Text style={[styles.price, { textAlign: isAr ? "right" : "left" }]}>
          {fmtPrice(p.price)} {t("ج.م")} {p.purpose === "rent" ? t("/ شهر") : ""}
        </Text>
        <View style={[styles.specsRow, { justifyContent: isAr ? "flex-end" : "flex-start" }]}>
          {!!p.rooms && <Text style={styles.specText}>🛏 {p.rooms} {t("غرف")}</Text>}
          {!!p.baths && <Text style={styles.specText}>🛁 {p.baths} {t("حمام")}</Text>}
          <Text style={styles.specText}>📐 {p.area} {t("م²")}</Text>
          {!!p.music && <Text style={styles.specText}>🎵 {p.music}</Text>}
        </View>
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
  },
  infoBlock: { maxWidth: "70%" },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  purposeTag: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  purposeTagText: { color: "white", fontSize: 9, fontWeight: "900" },
  descBtn: {
    backgroundColor: "#F97316",
    borderWidth: 1,
    borderColor: "#FB923C",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  descBtnText: { color: "white", fontSize: 9, fontWeight: "900" },
  // ↔ قاعدة تثيم الوسائط (نسخة نهائية معتمدة — docs/deferred-tasks.md):
  // "أي نص مرسوم فوق تدرّج شفاف على الفيديو = ثابت أبيض + ظل" — كل نصوص
  // البلوك ده (مش العنوان بس) دلوقتي بنفس معالجة الظل الموحّدة، فى
  // الوضعين الاثنين من غير أي استثناء ومن غير أي اعتماد على useThemeColors.
  title: {
    color: "white", fontSize: 15, fontWeight: "900", marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  location: {
    color: "white", fontSize: 11, opacity: 0.9, marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  price: {
    color: "white", fontSize: 17, fontWeight: "900", marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  specsRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  specText: {
    color: "white", fontSize: 10.5, fontWeight: "800", opacity: 0.95,
    textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
});
