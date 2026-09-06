import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, FlatList, Alert, Switch, ScrollView } from "react-native";
import { useAllMenuItems, useMenuItemMutations } from "../../lib/hooks/useMenuItems";
import { MenuIcon, ICON_KEYS, MenuIconKey } from "../../lib/menuIconRegistry";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

const COLOR_PRESETS = ["#1e293b", "#22A652", "#0ea5e9", "#722F37", "#ef4444", "#334155", "#7c2d12", "#F59E0B", "#6366f1", "#ec4899"];

// ↔ full management of the menu page's icon cards — color, title/
// subtitle, size, icon, position (reorder via up/down — drag-and-drop
// isn't reliable enough on mobile to trust for something that reorders a
// live page), and add/delete. Every card on app/(tabs)/menu.tsx (other
// than the live-now banner and ad carousel, which are dynamic widgets,
// not static icons) is a row here.
export function AdminMenuItems() {
  const { data: items = [] } = useAllMenuItems();
  const { create, update, remove, reorder } = useMenuItemMutations();
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [iconKey, setIconKey] = useState<MenuIconKey>("star");
  const [size, setSize] = useState<"full" | "half" | "tall" | "round">("half");
  const [actionType, setActionType] = useState<"whatsapp" | "route" | "url">("whatsapp");
  const [actionValue, setActionValue] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  function resetForm() {
    setEditingId(null); setTitle(""); setSubtitle(""); setColor(COLOR_PRESETS[0]);
    setIconKey("star"); setSize("half"); setActionType("whatsapp"); setActionValue(""); setCtaLabel("");
  }

  function startEdit(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setEditingId(id); setTitle(item.title); setSubtitle(item.subtitle ?? "");
    setColor(item.color); setIconKey(item.iconKey as MenuIconKey); setSize(item.size);
    setActionType(item.actionType); setActionValue(item.actionValue); setCtaLabel(item.ctaLabel ?? "");
  }

  function submitForm() {
    if (!title.trim() || !actionValue.trim()) return;
    const payload = {
      title: title.trim(), subtitle: subtitle.trim() || null, color, iconKey, size,
      actionType, actionValue: actionValue.trim(), ctaLabel: ctaLabel.trim() || null,
    };
    if (editingId) {
      update.mutate({ id: editingId, patch: payload });
    } else {
      create.mutate({ ...payload, sortOrder: items.length });
    }
    resetForm();
  }

  function moveItem(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    reorder.mutate({
      a: { id: items[index].id, sortOrder: items[index].sortOrder },
      b: { id: items[target].id, sortOrder: items[target].sortOrder },
    });
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{editingId ? "تعديل أيقونة" : "إضافة أيقونة جديدة"}</Text>

        <TextInput style={styles.input} placeholder="العنوان" placeholderTextColor={themeColors.textSubtle} value={title} onChangeText={setTitle} />
        <TextInput style={styles.input} placeholder="الوصف الفرعي (اختياري)" placeholderTextColor={themeColors.textSubtle} value={subtitle} onChangeText={setSubtitle} />

        <Text style={styles.label}>اللون</Text>
        <View style={styles.colorRow}>
          {COLOR_PRESETS.map((c) => (
            <Pressable key={c} style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]} onPress={() => setColor(c)} />
          ))}
        </View>

        <Text style={styles.label}>الأيقونة</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {ICON_KEYS.map((k) => (
            <Pressable key={k} style={[styles.iconSwatch, iconKey === k && styles.iconSwatchActive]} onPress={() => setIconKey(k)}>
              <MenuIcon iconKey={k} size={22} color={iconKey === k ? "#22A652" : themeColors.textSubtle} />
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.label}>الحجم</Text>
        <View style={styles.placementRow}>
          <Pressable style={[styles.placementBtn, size === "full" && styles.placementBtnActive]} onPress={() => setSize("full")}>
            <Text style={[styles.placementBtnText, size === "full" && styles.placementBtnTextActive]}>عرض كامل</Text>
          </Pressable>
          <Pressable style={[styles.placementBtn, size === "half" && styles.placementBtnActive]} onPress={() => setSize("half")}>
            <Text style={[styles.placementBtnText, size === "half" && styles.placementBtnTextActive]}>نصف</Text>
          </Pressable>
        </View>
        <View style={styles.placementRow}>
          <Pressable style={[styles.placementBtn, size === "tall" && styles.placementBtnActive]} onPress={() => setSize("tall")}>
            <Text style={[styles.placementBtnText, size === "tall" && styles.placementBtnTextActive]}>طويلة (+ نصفين بجانبها)</Text>
          </Pressable>
          <Pressable style={[styles.placementBtn, size === "round" && styles.placementBtnActive]} onPress={() => setSize("round")}>
            <Text style={[styles.placementBtnText, size === "round" && styles.placementBtnTextActive]}>دائرية صغيرة (+ نصف بجانبها)</Text>
          </Pressable>
        </View>
        {size === "tall" && (
          <Text style={styles.hint}>لازم تتبعها بطاقتين "نصف" في الترتيب عشان يظهروا مكدّسين بجانبها.</Text>
        )}
        {size === "round" && (
          <Text style={styles.hint}>لازم تتبعها بطاقة "نصف" واحدة في الترتيب عشان تظهر بجانبها.</Text>
        )}

        <Text style={styles.label}>نص الزر الجانبي (اختياري، للبطاقات الكاملة فقط — مثال: اطلب الآن)</Text>
        <TextInput style={styles.input} placeholder="اطلب الآن" placeholderTextColor={themeColors.textSubtle} value={ctaLabel} onChangeText={setCtaLabel} />

        <Text style={styles.label}>عند الضغط</Text>
        <View style={styles.placementRow}>
          <Pressable style={[styles.placementBtn, actionType === "whatsapp" && styles.placementBtnActive]} onPress={() => setActionType("whatsapp")}>
            <Text style={[styles.placementBtnText, actionType === "whatsapp" && styles.placementBtnTextActive]}>واتساب</Text>
          </Pressable>
          <Pressable style={[styles.placementBtn, actionType === "route" && styles.placementBtnActive]} onPress={() => setActionType("route")}>
            <Text style={[styles.placementBtnText, actionType === "route" && styles.placementBtnTextActive]}>صفحة داخل التطبيق</Text>
          </Pressable>
          <Pressable style={[styles.placementBtn, actionType === "url" && styles.placementBtnActive]} onPress={() => setActionType("url")}>
            <Text style={[styles.placementBtnText, actionType === "url" && styles.placementBtnTextActive]}>رابط خارجي</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          placeholder={actionType === "whatsapp" ? "نص رسالة واتساب" : actionType === "route" ? "مسار الصفحة، مثال: /(tabs)/search" : "https://..."}
          placeholderTextColor={themeColors.textSubtle}
          value={actionValue}
          onChangeText={setActionValue}
        />

        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          {editingId && (
            <Pressable style={[styles.addBtn, { flex: 1, backgroundColor: themeColors.surface }]} onPress={resetForm}>
              <Text style={[styles.addBtnText, { color: themeColors.textMuted }]}>إلغاء</Text>
            </Pressable>
          )}
          <Pressable style={[styles.addBtn, { flex: 1 }]} onPress={submitForm}>
            <Text style={styles.addBtnText}>{editingId ? "حفظ التعديل" : "إضافة الأيقونة"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>أيقونات صفحة القائمة ({items.length})</Text>
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          scrollEnabled={false}
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              <View style={[styles.iconPreview, { backgroundColor: item.color }]}>
                <MenuIcon iconKey={item.iconKey} size={18} color="white" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowMeta}>
                  {item.size === "full" ? "عرض كامل" : item.size === "tall" ? "طويلة" : item.size === "round" ? "دائرية" : "نصف"} · {item.actionType}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <Pressable style={styles.moveBtn} onPress={() => moveItem(index, -1)} disabled={index === 0}>
                  <Text style={styles.moveBtnText}>↑</Text>
                </Pressable>
                <Pressable style={styles.moveBtn} onPress={() => moveItem(index, 1)} disabled={index === items.length - 1}>
                  <Text style={styles.moveBtnText}>↓</Text>
                </Pressable>
              </View>
              <Switch value={item.active} onValueChange={(v) => update.mutate({ id: item.id, patch: { active: v } })} />
              <Pressable style={styles.editBtn} onPress={() => startEdit(item.id)}>
                <Text style={styles.editBtnText}>تعديل</Text>
              </Pressable>
              <Pressable
                style={styles.deleteBtn}
                onPress={() => Alert.alert("حذف الأيقونة؟", item.title, [
                  { text: "إلغاء", style: "cancel" },
                  { text: "حذف", style: "destructive", onPress: () => remove.mutate(item.id) },
                ])}
              >
                <Text style={styles.deleteBtnText}>حذف</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
    </View>
  );
}

// ↔ COLOR_PRESETS فوق دي مش ألوان واجهة themeable — دي بيانات (لوحة
// ألوان الأدمن بيختار منها لون كارت فى صفحة القائمة نفسها، شوف
// lib/menuIconRegistry.tsx) فبتفضل ثابتة عمدًا.
function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColors.border },
    cardTitle: { fontSize: 13, fontWeight: "900", color: themeColors.text, marginBottom: 10 },
    input: { borderWidth: 1, borderColor: themeColors.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, fontSize: 12.5, marginBottom: 8, color: themeColors.text },
    label: { fontSize: 11.5, fontWeight: "800", color: themeColors.textSubtle, marginBottom: 6, marginTop: 2 },
    hint: { fontSize: 10.5, color: themeColors.textSubtle, marginBottom: 8, marginTop: -4 },
    colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
    colorSwatchActive: { borderColor: themeColors.text },
    iconSwatch: { width: 40, height: 40, borderRadius: 10, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center", marginBottom: 10 },
    iconSwatchActive: { backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.18)" : "#ecfdf5", borderWidth: 1.5, borderColor: "#22A652" },
    placementRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
    placementBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 8, backgroundColor: themeColors.surface },
    placementBtnActive: { backgroundColor: "#6366f1" },
    placementBtnText: { fontSize: 11, fontWeight: "800", color: themeColors.textSubtle },
    placementBtnTextActive: { color: "white" },
    addBtn: { backgroundColor: "#6366f1", borderRadius: 999, paddingVertical: 11, alignItems: "center" },
    addBtnText: { color: "white", fontWeight: "900", fontSize: 12.5 },
    row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.border },
    iconPreview: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    rowTitle: { fontSize: 12, fontWeight: "800", color: themeColors.text },
    rowMeta: { fontSize: 10, color: themeColors.textSubtle, marginTop: 1 },
    moveBtn: { width: 24, height: 24, borderRadius: 6, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    moveBtnText: { fontSize: 12, fontWeight: "900", color: themeColors.textMuted },
    editBtn: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
    editBtnText: { color: "#6366f1", fontWeight: "900", fontSize: 10.5 },
    deleteBtn: { backgroundColor: themeColors.isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
    deleteBtnText: { color: "#991B1B", fontWeight: "900", fontSize: 10.5 },
  });
}
