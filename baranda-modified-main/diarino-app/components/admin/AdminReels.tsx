import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Modal, Linking } from "react-native";
import { Image } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { useAdminDB, setReelStatus, deleteReel } from "../../lib/hooks/useAdminDB";
import { cldOptimized, cldThumbnail } from "../../lib/cloudinary";
import { StatusChip } from "./StatusChip";
import { ConfirmModal } from "../shared/ConfirmModal";
import { showToast } from "../shared/Toast";
import { AdminReel, ReelStatus } from "../../data/mock-admin";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

const FILTERS: { key: "all" | ReelStatus; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "pending", label: "قيد المراجعة" },
  { key: "approved", label: "منشورة" }, { key: "rejected", label: "مرفوضة" },
];

// ↔ "وسّع انتشار إعلانك" في شاشة النشر — نفس الأربع منصات، معروضة هنا
// كشارات على كل ريلز طلب صاحبه إعادة نشره على قناة/صفحة/حساب Diarino.
const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", instagram: "Instagram",
};

export function AdminReels() {
  const db = useAdminDB();
  const [filter, setFilter] = useState<"all" | ReelStatus>("all");
  const [query, setQuery] = useState("");
  const [previewReel, setPreviewReel] = useState<AdminReel | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  const rows = useMemo(() => {
    return db.reels.filter((r) => (filter === "all" || r.status === filter))
      .filter((r) => !query || r.title.includes(query) || r.owner.includes(query));
  }, [db.reels, filter, query]);

  // ↔ "قم بعمل احصائية للخاصية الجديدة" — how many listings (open right
  // now, regardless of the status/search filters above) asked for each
  // platform, so an admin can gauge demand before manually reposting.
  const platformStats = useMemo(() => {
    const counts: Record<string, number> = { youtube: 0, facebook: 0, tiktok: 0, instagram: 0 };
    let withAny = 0;
    for (const r of db.reels) {
      if (r.sharePlatforms.length) withAny += 1;
      for (const p of r.sharePlatforms) counts[p] = (counts[p] ?? 0) + 1;
    }
    return { counts, withAny };
  }, [db.reels]);

  function approve(id: string) { setReelStatus(id, "approved"); showToast("✓ تم قبول الريلز"); }
  function reject(id: string) { setReelStatus(id, "rejected"); showToast("✕ تم رفض الريلز"); }
  function confirmDelete() {
    if (!confirmDeleteId) return;
    deleteReel(confirmDeleteId);
    showToast("🗑️ تم الحذف");
    setConfirmDeleteId(null);
    setPreviewReel(null);
  }
  function downloadVideo(url: string | null) {
    if (!url) { showToast("لا يوجد فيديو لهذا الريلز"); return; }
    Linking.openURL(url).catch(() => showToast("تعذر فتح الفيديو"));
  }

  return (
    <View style={{ gap: 12 }}>
      {platformStats.withAny > 0 && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>طلبات النشر على منصات Diarino</Text>
          <View style={styles.statsRow}>
            {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
              <View key={key} style={styles.statChip}>
                <Text style={styles.statChipValue}>{platformStats.counts[key] ?? 0}</Text>
                <Text style={styles.statChipLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={filter === f.key ? styles.chipActive : styles.chip} onPress={() => setFilter(f.key)}>
            <Text style={filter === f.key ? styles.chipActiveText : styles.chipText}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="🔍 ابحث بالعنوان أو المالك..." placeholderTextColor={themeColors.textSubtle} />

      {rows.length === 0 ? (
        <Text style={styles.empty}>لا يوجد ريلز مطابق</Text>
      ) : (
        rows.map((r) => (
          <Pressable key={r.id} style={styles.row} onPress={() => setPreviewReel(r)}>
            {r.coverUrl ? (
              <Image source={{ uri: cldThumbnail(r.coverUrl) }} style={styles.thumb} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: r.color }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
              <Text style={styles.sub}>{r.owner} · {r.price} · 👁 {r.views.toLocaleString("ar-EG")}</Text>
              <View style={styles.rowFooter}>
                <StatusChip status={r.status} />
                {r.sharePlatforms.map((p) => (
                  <View key={p} style={styles.platformBadge}><Text style={styles.platformBadgeText}>{PLATFORM_LABELS[p] ?? p}</Text></View>
                ))}
              </View>
            </View>
            <View style={styles.actions}>
              {r.status !== "approved" && <ActionBtn label="قبول" bg="#dcfce7" fg="#166534" onPress={() => approve(r.id)} />}
              {r.status !== "rejected" && <ActionBtn label="رفض" bg="#fee2e2" fg="#991b1b" onPress={() => reject(r.id)} />}
              <ActionBtn label="حذف" bg={themeColors.isDark ? "#334155" : "#0f172a"} fg="white" onPress={() => setConfirmDeleteId(r.id)} />
            </View>
          </Pressable>
        ))
      )}

      <Modal visible={!!previewReel} transparent animationType="fade" onRequestClose={() => setPreviewReel(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPreviewReel(null)} />
        {previewReel && (
          <View style={styles.modalCard}>
            {/* ↔ the admin used to see just a colored placeholder box here — this
                plays the actual submitted reel so a pending ad can genuinely be
                reviewed, not only judged by its title/price. */}
            {previewReel.videoUrl ? (
              <Video
                source={{ uri: previewReel.videoUrl }}
                style={styles.previewBox}
                useNativeControls
                resizeMode={ResizeMode.COVER}
                posterSource={previewReel.coverUrl ? { uri: previewReel.coverUrl } : undefined}
                usePoster={!!previewReel.coverUrl}
              />
            ) : previewReel.coverUrl ? (
              <Image source={{ uri: cldOptimized(previewReel.coverUrl) }} style={styles.previewBox} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.previewBox, { backgroundColor: previewReel.color, alignItems: "center", justifyContent: "center" }]}>
                <Text style={{ fontSize: 40 }}>🏠</Text>
              </View>
            )}
            <KV k="العنوان" v={previewReel.title} />
            <KV k="المالك" v={previewReel.owner} />
            <KV k="السعر" v={previewReel.price} />
            <KV k="المشاهدات" v={previewReel.views.toLocaleString("ar-EG")} />
            <KV k="الإعجابات" v={previewReel.likes.toLocaleString("ar-EG")} />
            <KV k="تحويلات واتساب" v={String(previewReel.wa)} />
            {previewReel.sharePlatforms.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.kvKey}>طلب النشر على</Text>
                <View style={[styles.rowFooter, { marginTop: 6 }]}>
                  {previewReel.sharePlatforms.map((p) => (
                    <View key={p} style={styles.platformBadge}><Text style={styles.platformBadgeText}>{PLATFORM_LABELS[p] ?? p}</Text></View>
                  ))}
                </View>
              </View>
            )}
            <View style={styles.modalActions}>
              {previewReel.sharePlatforms.length > 0 && (
                <ActionBtn label="تحميل الفيديو" bg="#eef2ff" fg="#4338ca" onPress={() => downloadVideo(previewReel.videoUrl)} />
              )}
              <ActionBtn label="قبول" bg="#dcfce7" fg="#166534" onPress={() => { approve(previewReel.id); setPreviewReel(null); }} />
              <ActionBtn label="رفض" bg="#fee2e2" fg="#991b1b" onPress={() => { reject(previewReel.id); setPreviewReel(null); }} />
              <ActionBtn label="حذف" bg={themeColors.isDark ? "#334155" : "#0f172a"} fg="white" onPress={() => setConfirmDeleteId(previewReel.id)} />
            </View>
          </View>
        )}
      </Modal>

      <ConfirmModal
        visible={!!confirmDeleteId}
        title="حذف الريلز"
        text="حذف هذا الريلز نهائياً؟"
        confirmLabel="حذف"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={confirmDelete}
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
function KV({ k, v }: { k: string; v: string }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal}>{v}</Text>
    </View>
  );
}

// ↔ قاعدة تثيم الوسائط: previewBox (معاينة فيديو/صورة الإعلان قبل
// التحميل) لونها الاحتياطي بييجي من previewReel.color (بيانات، مش
// ثيم) — تفضل زي ما هي عمدًا.
function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
    chipText: { fontSize: 12, fontWeight: "700", color: themeColors.textMuted },
    chipActive: { backgroundColor: themeColors.isDark ? "#334155" : "#0f172a", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
    chipActiveText: { fontSize: 12, fontWeight: "700", color: "white" },
    search: { backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.border, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, fontSize: 13, color: themeColors.text },
    empty: { textAlign: "center", color: themeColors.textSubtle, fontSize: 13, padding: 30 },
    row: { flexDirection: "row", gap: 10, backgroundColor: themeColors.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: themeColors.border },
    thumb: { width: 44, height: 56, borderRadius: 8 },
    title: { fontSize: 12.5, fontWeight: "900", color: themeColors.text, marginBottom: 3 },
    sub: { fontSize: 11, color: themeColors.textSubtle, marginBottom: 6 },
    actions: { justifyContent: "center", gap: 6 },
    actionBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
    actionBtnText: { fontSize: 10.5, fontWeight: "800" },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.6)" },
    modalCard: { position: "absolute", left: 20, right: 20, top: "18%", backgroundColor: themeColors.card, borderRadius: 20, padding: 20, maxHeight: "70%" },
    previewBox: { width: "100%", aspectRatio: 1.4, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
    kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    kvKey: { fontSize: 12, color: themeColors.textSubtle },
    kvVal: { fontSize: 12, fontWeight: "900", color: themeColors.text },
    modalActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" },
    statsCard: { backgroundColor: themeColors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColors.border },
    statsTitle: { fontSize: 12.5, fontWeight: "900", color: themeColors.text, marginBottom: 10 },
    statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    statChip: { backgroundColor: themeColors.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center", minWidth: 74 },
    statChipValue: { fontSize: 16, fontWeight: "900", color: "#4338ca" },
    statChipLabel: { fontSize: 10.5, color: themeColors.textSubtle, marginTop: 2, fontWeight: "700" },
    rowFooter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 2 },
    platformBadge: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
    platformBadgeText: { fontSize: 9.5, fontWeight: "900", color: "#4338ca" },
  });
}
