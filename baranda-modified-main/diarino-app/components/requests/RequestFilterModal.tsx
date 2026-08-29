import { useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, Animated, PanResponder,
  NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { PROVINCES } from "../../data/locations";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ modal-req-filter / state.reqFilters in app-viewer.html.
export type RequestFilters = { province: string; location: string; type: string; purpose: "all" | "sale" | "rent" };
export const DEFAULT_REQUEST_FILTERS: RequestFilters = { province: "", location: "", type: "all", purpose: "all" };

const TYPES = ["all", "شقة", "فيلا", "بنتهاوس", "تاون هاوس", "تجاري", "إداري", "طبي", "أرض"];

type Props = { visible: boolean; value: RequestFilters; onApply: (f: RequestFilters) => void; onClose: () => void };

export function RequestFilterModal({ visible, value, onApply, onClose }: Props) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<RequestFilters>(value);
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(1)).current;
  // ↔ #8 (سحب المحتوى للإغلاق): بيتفعّل بس لما الـ ScrollView يكون فى
  // الأعلى تمامًا (scrollY <= 0)، عشان السحب لأسفل جوه المحتوى وأنت
  // بتسكرول عادي ميتعارضش مع إغلاق الشيت — نفس النمط فى SearchFilterModal.
  const scrollYRef = useRef(0);
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => scrollYRef.current <= 0 && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy < 0) return;
        translateY.setValue(g.dy);
        backdropOpacity.setValue(Math.max(0, 1 - g.dy / 500));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 110) {
          Animated.timing(translateY, { toValue: 700, duration: 220, useNativeDriver: true }).start(() => {
            translateY.setValue(0); backdropOpacity.setValue(1); onClose();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
          Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  function reset() {
    setDraft(DEFAULT_REQUEST_FILTERS);
    onApply(DEFAULT_REQUEST_FILTERS);
    onClose();
  }
  function apply() {
    onApply(draft);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
        <ScrollView showsVerticalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
          <Text style={styles.section}>{t("الغرض")}</Text>
          <View style={styles.chipsRow}>
            {(["all", "sale", "rent"] as const).map((p) => (
              <Pressable key={p} style={draft.purpose === p ? styles.chipActive : styles.chip} onPress={() => setDraft((d) => ({ ...d, purpose: p }))}>
                <Text style={draft.purpose === p ? styles.chipActiveText : styles.chipText}>{p === "all" ? t("الكل") : p === "sale" ? t("بيع") : t("إيجار")}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("نوع العقار")}</Text>
          <View style={styles.chipsRow}>
            {TYPES.map((ty) => (
              <Pressable key={ty} style={draft.type === ty ? styles.chipActive : styles.chip} onPress={() => setDraft((d) => ({ ...d, type: ty }))}>
                <Text style={draft.type === ty ? styles.chipActiveText : styles.chipText}>{ty === "all" ? t("الكل") : t(ty)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("المحافظة")}</Text>
          <View style={styles.chipsRow}>
            <Pressable style={draft.province === "" ? styles.chipActive : styles.chip} onPress={() => setDraft((d) => ({ ...d, province: "" }))}>
              <Text style={draft.province === "" ? styles.chipActiveText : styles.chipText}>{t("الكل")}</Text>
            </Pressable>
            {PROVINCES.map((pv) => (
              <Pressable key={pv} style={draft.province === pv ? styles.chipActive : styles.chip} onPress={() => setDraft((d) => ({ ...d, province: pv }))}>
                <Text style={draft.province === pv ? styles.chipActiveText : styles.chipText}>{t(pv)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("المنطقة")}</Text>
          <TextInput
            style={styles.input}
            value={draft.location}
            onChangeText={(v) => setDraft((d) => ({ ...d, location: v }))}
            placeholder={t("اكتب اسم المنطقة...")}
            placeholderTextColor={themeColors.textSubtle}
          />
        </ScrollView>

        <View style={styles.actionsRow}>
          <Pressable style={styles.resetBtn} onPress={reset}><Text style={styles.resetBtnText}>{t("إعادة تعيين")}</Text></Pressable>
          <Pressable style={styles.applyBtn} onPress={apply}><Text style={styles.applyBtnText}>{t("تطبيق")}</Text></Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: themeColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 24, maxHeight: "85%" },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: themeColors.border, alignSelf: "center", marginBottom: 10 },
    section: { fontSize: 12, fontWeight: "900", color: themeColors.textMuted, marginTop: 14, marginBottom: 8 },
    input: { backgroundColor: themeColors.surface, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 13, color: themeColors.text },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontSize: 11.5, fontWeight: "800", color: themeColors.textMuted },
    chipActive: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipActiveText: { fontSize: 11.5, fontWeight: "800", color: "white" },
    actionsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
    resetBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    resetBtnText: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    applyBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: "center", backgroundColor: "#22A652" },
    applyBtnText: { fontSize: 13, fontWeight: "900", color: "white" },
  });
}
