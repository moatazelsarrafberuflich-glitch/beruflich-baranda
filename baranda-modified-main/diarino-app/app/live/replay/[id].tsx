import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Video, ResizeMode } from "expo-av";
import Svg, { Path } from "react-native-svg";
import { useLiveReplayById } from "../../../lib/hooks/useMyContent";
import { useLanguage } from "../../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../../lib/hooks/useThemeColors";
import { ReportModal } from "../../../components/shared/ReportModal";

// ↔ playSavedLive() in app-viewer.html — the difference here is there's a
// real file behind it (LiveKit Egress → Supabase Storage), not a mock.
export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: live } = useLiveReplayById(id);
  const { t } = useLanguage();
  const [reportVisible, setReportVisible] = useState(false);
  const themeColors = useThemeColors();

  if (!live || !live.recordingUrl) {
    // ↔ يتبع الثيم — مفيش فيديو ظاهر لحظتها (التسجيل مش متاح).
    const errStyles = createStyles(themeColors);
    return (
      <View style={errStyles.center}>
        <Text style={errStyles.errorText}>{t("التسجيل غير متاح")}</Text>
        <Pressable style={errStyles.backBtn} onPress={() => router.back()}>
          <Text style={errStyles.backBtnText}>{t("رجوع")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        source={{ uri: live.recordingUrl }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls
        shouldPlay
        isLooping={false}
      />
      <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={8}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      </Pressable>
      <Pressable style={styles.reportBtn} onPress={() => setReportVisible(true)} hitSlop={8}>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
          <Path d="M4 22V4" /><Path d="M4 4h13l-2 4 2 4H4" />
        </Svg>
      </Pressable>
      <View style={styles.titleBar}>
        <Text style={styles.titleText} numberOfLines={1}>{t(live.title)}</Text>
      </View>

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        targetType="live"
        targetId={live.id}
        targetTitle={live.title || "بث مباشر"}
      />
    </View>
  );
}

// ↔ ثابت دائمًا — سطح فيديو الإعادة نفسه وتراكباته المباشرة (زرار
// الإغلاق/الإبلاغ وشريط العنوان كلهم فوق الفيديو مباشرة).
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  closeBtn: { position: "absolute", top: 50, left: 14, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  reportBtn: { position: "absolute", top: 50, right: 14, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  titleBar: { position: "absolute", top: 50, left: 54, right: 54 },
  titleText: { color: "white", fontSize: 13, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});

// ↔ يتبع الثيم — حالة "التسجيل غير متاح"، مفيش فيديو ظاهر أصلاً.
function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, backgroundColor: themeColors.background, alignItems: "center", justifyContent: "center", gap: 16 },
    errorText: { color: themeColors.text, fontSize: 14, fontWeight: "800" },
    backBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24 },
    backBtnText: { color: "white", fontWeight: "900" },
  });
}
