import { useState } from "react";
import { router } from "expo-router";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useIsAdmin, AdminSection } from "../../lib/hooks/useIsAdmin";
import { AdminOverview } from "../../components/admin/AdminOverview";
import { AdminReels } from "../../components/admin/AdminReels";
import { AdminLives } from "../../components/admin/AdminLives";
import { AdminSupport } from "../../components/admin/AdminSupport";
import { AdminAnalytics } from "../../components/admin/AdminAnalytics";
import { AdminUsers } from "../../components/admin/AdminUsers";
import { AdminFeatures } from "../../components/admin/AdminFeatures";
import { AdminManagement } from "../../components/admin/AdminManagement";
import { AdminAdBanners } from "../../components/admin/AdminAdBanners";
import { AdminSponsoredReels } from "../../components/admin/AdminSponsoredReels";
import { AdminAuditLog } from "../../components/admin/AdminAuditLog";
import { AdminUserActivityLog } from "../../components/admin/AdminUserActivityLog";
import { AdminMenuItems } from "../../components/admin/AdminMenuItems";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

type AdminPage = "overview" | "reels" | "lives" | "reports" | "analytics" | "users" | "features" | "admins" | "ads" | "sponsoredReels" | "auditLog" | "userActivity" | "menuItems";

// ↔ pageTitles + the #nav sidebar in admin-viewer.html. A desktop sidebar
// doesn't fit a phone screen, so this became a horizontal scrollable chip
// nav instead — same sections, same instant-switch/no-navigation-stack
// behavior (this is one screen with local state, not separate routes).
// `section` is undefined for pages every admin can always reach
// (overview/analytics are read-only summaries — nothing to restrict) or
// that are super-admin-only (admins).
const PAGES: { key: AdminPage; icon: string; label: string; title: string; subtitle: string; section?: AdminSection; superAdminOnly?: boolean }[] = [
  { key: "overview", icon: "📊", label: "نظرة عامة", title: "نظرة عامة", subtitle: "ملخص أداء المنصة اليوم" },
  { key: "reels", icon: "🎬", label: "الريلز", title: "إدارة الريلز", subtitle: "الموافقة، الرفض، والحذف", section: "reels" },
  { key: "lives", icon: "📡", label: "البث المسجل", title: "البث المباشر المسجل", subtitle: "مراجعة وإدارة البث المنشور", section: "lives" },
  { key: "reports", icon: "🎧", label: "الدعم", title: "الدعم", subtitle: "البلاغات، المساحة الإعلانية، المقترحات، والتواصل معنا", section: "reports" },
  { key: "analytics", icon: "📈", label: "التحليلات", title: "التحليلات", subtitle: "مشاهدات، إعلانات، وتحويلات واتساب" },
  { key: "users", icon: "👥", label: "المستخدمون", title: "المستخدمون", subtitle: "التحكم في صلاحيات كل مستخدم", section: "users" },
  { key: "features", icon: "⚙️", label: "الميزات العامة", title: "الميزات العامة", subtitle: "تفعيل أو تعطيل ميزات المنصة", section: "features" },
  { key: "ads", icon: "🖼️", label: "المساحة الإعلانية", title: "المساحة الإعلانية", subtitle: "إدارة بانرات الإعلانات المتناوبة", section: "ads" },
  { key: "menuItems", icon: "🧩", label: "أيقونات القائمة", title: "أيقونات صفحة القائمة", subtitle: "التحكم الكامل في أيقونات صفحة القائمة", section: "menuItems" },
  { key: "sponsoredReels", icon: "⭐", label: "الريلز المميزة", title: "الريلز المميزة", subtitle: "ترويج الريلز وإدارة الوصول والاستهداف", section: "sponsoredReels" },
  { key: "auditLog", icon: "🧾", label: "سجل التدقيق", title: "سجل تدقيق الأدمن", subtitle: "كل عملية أدمن على الريلز والبث والإعلانات", section: "auditLog" },
  { key: "userActivity", icon: "🕒", label: "نشاط المستخدمين", title: "سجل نشاط المستخدمين", subtitle: "تسجيلات الدخول وتغييرات الأدوار", section: "userActivity" },
  { key: "admins", icon: "👑", label: "المشرفون", title: "إدارة المشرفين", subtitle: "منح أو إزالة صلاحيات المشرفين", superAdminOnly: true },
];

export default function AdminScreen() {
  const { isAdmin, isSuperAdmin, canAccess, checking } = useIsAdmin();
  const [page, setPage] = useState<AdminPage>("overview");
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>غير مصرح لك بالدخول</Text>
        <Text style={styles.deniedText}>هذه الصفحة مخصصة لمسؤولي المنصة فقط.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.backBtnText}>رجوع</Text>
        </Pressable>
      </View>
    );
  }

  // ↔ hides tabs the current admin isn't granted, and also re-checks on
  // every render (not just at nav-click time) so a permission revoked
  // while this screen is open can't leave a restricted page showing.
  const visiblePages = PAGES.filter((p) => {
    if (p.superAdminOnly) return isSuperAdmin;
    if (p.section) return canAccess(p.section);
    return true;
  });
  const current = visiblePages.find((p) => p.key === page) ?? visiblePages[0];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.closeBtn} onPress={() => router.replace("/(tabs)")} hitSlop={8}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}><Path d="M18 6L6 18M6 6l12 12" /></Svg>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{current.title}</Text>
          <Text style={styles.headerSubtitle}>{current.subtitle}</Text>
        </View>
        <Pressable style={styles.exitBtn} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.exitBtnText}>الخروج للتطبيق</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nav} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {visiblePages.map((p) => (
          <Pressable key={p.key} style={[styles.navChip, current.key === p.key && styles.navChipActive]} onPress={() => setPage(p.key)}>
            <Text style={styles.navIcon}>{p.icon}</Text>
            <Text style={[styles.navLabel, current.key === p.key && styles.navLabelActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {current.key === "overview" && <AdminOverview />}
        {current.key === "reels" && <AdminReels />}
        {current.key === "lives" && <AdminLives />}
        {current.key === "reports" && <AdminSupport />}
        {current.key === "analytics" && <AdminAnalytics />}
        {current.key === "users" && <AdminUsers />}
        {current.key === "features" && <AdminFeatures />}
        {current.key === "ads" && <AdminAdBanners />}
        {current.key === "menuItems" && <AdminMenuItems />}
        {current.key === "sponsoredReels" && <AdminSponsoredReels />}
        {current.key === "auditLog" && <AdminAuditLog />}
        {current.key === "userActivity" && <AdminUserActivityLog />}
        {current.key === "admins" && <AdminManagement />}
      </ScrollView>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    center: { flex: 1, backgroundColor: themeColors.background, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    deniedTitle: { fontSize: 16, fontWeight: "900", color: themeColors.text },
    deniedText: { fontSize: 12.5, color: themeColors.textSubtle, textAlign: "center" },
    backBtn: { marginTop: 8, backgroundColor: themeColors.isDark ? "#334155" : "#0f172a", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24 },
    backBtnText: { color: "white", fontWeight: "900" },
    header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 50, paddingBottom: 14, paddingHorizontal: 16, backgroundColor: themeColors.card, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 16, fontWeight: "900", color: themeColors.text },
    headerSubtitle: { fontSize: 11.5, color: themeColors.textSubtle, marginTop: 1 },
    exitBtn: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
    exitBtnText: { fontSize: 11, fontWeight: "900", color: themeColors.textMuted },
    nav: { flexGrow: 0, paddingVertical: 12, backgroundColor: themeColors.card, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    navChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
    navChipActive: { backgroundColor: themeColors.isDark ? "#334155" : "#0f172a" },
    navIcon: { fontSize: 13 },
    navLabel: { fontSize: 12, fontWeight: "800", color: themeColors.textMuted },
    navLabelActive: { color: "white" },
    content: { padding: 16, gap: 14, paddingBottom: 40 },
  });
}
