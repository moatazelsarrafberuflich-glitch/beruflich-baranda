import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useAdminDB, setLiveStatus, deleteLive } from "../../lib/hooks/useAdminDB";
import { StatusChip } from "./StatusChip";
import { ConfirmModal } from "../shared/ConfirmModal";
import { showToast } from "../shared/Toast";
import { LiveStatus } from "../../data/mock-admin";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

const FILTERS: { key: "all" | LiveStatus; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "approved", label: "منشورة" }, { key: "pending", label: "قيد المراجعة" },
];

export function AdminLives() {
  const db = useAdminDB();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [filter, setFilter] = useState<"all" | LiveStatus>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const rows = useMemo(() => db.lives.filter((l) => filter === "all" || l.status === filter), [db.lives, filter]);

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={filter === f.key ? styles.chipActive : styles.chip} onPress={() => setFilter(f.key)}>
            <Text style={filter === f.key ? styles.chipActiveText : styles.chipText}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>لا يوجد بث</Text>
      ) : (
        rows.map((l) => (
          <View key={l.id} style={styles.row}>
            <View style={[styles.thumb, { backgroundColor: l.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{l.title}</Text>
              <Text style={styles.sub}>{l.host} · {l.duration} · 👁 {l.views.toLocaleString("ar-EG")}</Text>
              <StatusChip status={l.status} />
            </View>
            <View style={styles.actions}>
              {l.status !== "approved" && (
                <ActionBtn label="قبول" bg="#dcfce7" fg="#166534" onPress={() => { setLiveStatus(l.id, "approved"); showToast("✓ تم التحديث"); }} />
              )}
              <ActionBtn label="إخفاء" bg="#fee2e2" fg="#991b1b" onPress={() => { setLiveStatus(l.id, "pending"); showToast("✓ تم التحديث"); }} />
              <ActionBtn label="حذف" bg={themeColors.isDark ? "#334155" : "#0f172a"} fg="white" onPress={() => setConfirmDeleteId(l.id)} />
            </View>
          </View>
        ))
      )}

      <ConfirmModal
        visible={!!confirmDeleteId}
        title="حذف البث"
        text="حذف هذا البث نهائياً؟"
        confirmLabel="حذف"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => { if (confirmDeleteId) { deleteLive(confirmDeleteId); showToast("🗑️ تم الحذف"); } setConfirmDeleteId(null); }}
      />
    </View>
  );
}

function ActionBtn({ label, bg, fg, onPress }: { label: string; bg: string; fg: string; onPress: () => void }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <Pressable style={[styles.actionBtn, { backgroundColor: bg }]} onPress={onPress}>
      <Text style={[styles.actionBtnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
    chipText: { fontSize: 12, fontWeight: "700", color: themeColors.textMuted },
    chipActive: { backgroundColor: themeColors.isDark ? "#334155" : "#0f172a", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
    chipActiveText: { fontSize: 12, fontWeight: "700", color: "white" },
    empty: { textAlign: "center", color: themeColors.textSubtle, fontSize: 13, padding: 30 },
    row: { flexDirection: "row", gap: 10, backgroundColor: themeColors.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: themeColors.border },
    thumb: { width: 56, height: 56, borderRadius: 10 },
    title: { fontSize: 12.5, fontWeight: "900", color: themeColors.text, marginBottom: 3 },
    sub: { fontSize: 11, color: themeColors.textSubtle, marginBottom: 6 },
    actions: { justifyContent: "center", gap: 6 },
    actionBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
    actionBtnText: { fontSize: 10.5, fontWeight: "800" },
  });
}
