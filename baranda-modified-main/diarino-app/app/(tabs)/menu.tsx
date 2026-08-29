import { useState } from "react";
import { router, Href } from "expo-router";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { Image } from "expo-image";
import { PageTopBar } from "../../components/shared/PageTopBar";
import { NotificationsDropdown } from "../../components/notifications/NotificationsDropdown";
import { useNotifications } from "../../lib/hooks/useNotifications";
import { useActiveLives } from "../../lib/hooks/useActiveLives";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { waLink } from "../../lib/whatsapp";
import { openExternalUrl } from "../../lib/linking";
import { useActiveAdBanners } from "../../lib/hooks/useAdBanners";
import { AdBannerCarousel } from "../../components/menu/AdBannerCarousel";
import { useActiveMenuItems, MenuItem } from "../../lib/hooks/useMenuItems";
import { MenuCardIcon, menuCardImageSource } from "../../lib/menuIconRegistry";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ page-menu / openExternalService() in app-viewer.html. Every card below
// (color, title, icon, size, order, action) comes from public.menu_items
// via useActiveMenuItems() — full admin control from the "أيقونات القائمة"
// dashboard tab, instead of hardcoded JSX.
//
// Layout: items come back ordered by sort_order and are grouped into rows:
//  - 'full'  → its own full-width row (optionally with a CTA pill, e.g.
//              "لوازم السباكة والكهرباء" → "اطلب الآن")
//  - 'tall'  → paired with the next two 'half' items: a tall hero card on
//              one side, two half cards stacked on the other (the
//              "ابحث عن عقار" + "انشر عقارك"/"اطلب عقارك" group)
//  - 'round' → paired with the next 'half' item: a small square button
//              beside a wide card (the "اطلع اللايف" + "وكيلك القانوني" group)
//  - 'half'  → pairs two consecutive half items side by side, same as before

type Row =
  | { type: "full"; item: MenuItem }
  | { type: "pair"; items: [MenuItem, MenuItem] }
  | { type: "tallPair"; tall: MenuItem; stack: [MenuItem, MenuItem] }
  | { type: "roundPair"; round: MenuItem; wide: MenuItem };

function buildRows(menuItems: MenuItem[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < menuItems.length; i++) {
    const item = menuItems[i];
    if (item.size === "tall") {
      const a = menuItems[i + 1];
      const b = menuItems[i + 2];
      if (a?.size === "half" && b?.size === "half") {
        rows.push({ type: "tallPair", tall: item, stack: [a, b] });
        i += 2;
        continue;
      }
      rows.push({ type: "full", item });
      continue;
    }
    if (item.size === "round") {
      const a = menuItems[i + 1];
      if (a?.size === "half") {
        rows.push({ type: "roundPair", round: item, wide: a });
        i += 1;
        continue;
      }
      rows.push({ type: "full", item });
      continue;
    }
    if (item.size === "full") {
      rows.push({ type: "full", item });
      continue;
    }
    // half
    const next = menuItems[i + 1];
    if (next && next.size === "half") {
      rows.push({ type: "pair", items: [item, next] });
      i++;
    } else {
      rows.push({ type: "full", item });
    }
  }
  return rows;
}

// Simple relative-luminance check so light card colors (cream/orange) get
// dark text and dark card colors (teal/purple/red) get white text.
function textColorFor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length < 6) return "white";
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}

export default function MenuScreen() {
  const { t } = useLanguage();
  const [notifMenuVisible, setNotifMenuVisible] = useState(false);
  const notifications = useNotifications();
  const { user } = useCurrentUser();
  const { data: activeLives } = useActiveLives();
  const { data: adBanners } = useActiveAdBanners();
  const { data: menuItems = [] } = useActiveMenuItems();
  // ↔ #1 (إعدادات القائمة — العرض): خلفية الصفحة نفسها بس بتتغيّر مع
  // الثيم — كروت القائمة الملوّنة (كل واحدة بلونها اللي الأدمن حدده من
  // لوحة التحكم) بتفضل زي ما هي فى الوضعين، لأنها مصممة أصلاً تشتغل
  // بصريًا على أي خلفية.
  const themeColors = useThemeColors();

  // ↔ Diarino security review, live-broadcast task — going live is a real
  // legal/moderation liability (someone streaming video of themselves),
  // so it's the one menu action gated on being a *real*, traceable
  // account rather than a Supabase anonymous "guest" session. This is
  // UX only (a clear message instead of the button silently failing) —
  // the actual enforcement is server-side (see the `lives` INSERT policy
  // in 20260825000000_profile_privacy_rls.sql), so this check can't be
  // relied on for security by itself, only for a good error message.
  function runAction(item: MenuItem) {
    if (item.actionType === "route" && item.actionValue === "/live/broadcast" && user?.is_anonymous) {
      Alert.alert(t("يجب تسجيل الدخول بحساب Google لبدء بث مباشر"), t("المتابعة كضيف لا تتيح بدء بث مباشر."));
      return;
    }
    if (item.actionType === "route") router.push(item.actionValue as Href);
    else if (item.actionType === "whatsapp") openExternalUrl(waLink(item.actionValue));
    else if (item.actionType === "url") openExternalUrl(item.actionValue);
  }

  const rows = buildRows(menuItems);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageTopBar
        title="القائمة"
        notifBadgeCount={notifications.totalUnread}
        onOpenNotifications={() => setNotifMenuVisible(true)}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {adBanners && adBanners.length > 0 ? (
          <AdBannerCarousel banners={adBanners} />
        ) : (
          <Card
            color="#F59E0B" small
            title="مساحة اعلانية — اعرض هنا"
            onPress={() => openExternalUrl(waLink("مرحباً، أرغب في حجز مساحة إعلانية داخل تطبيق ديارينو"))}
          />
        )}

        {rows.map((row, i) => {
          if (row.type === "full") {
            return (
              <Card
                key={row.item.id}
                color={row.item.color}
                title={row.item.title}
                subtitle={row.item.subtitle ?? undefined}
                ctaLabel={row.item.ctaLabel ?? undefined}
                icon={<MenuCardIcon iconKey={row.item.iconKey} height={46} color={textColorFor(row.item.color)} />}
                onPress={() => runAction(row.item)}
              />
            );
          }
          if (row.type === "pair") {
            return (
              <View key={row.items.map((r) => r.id).join("-")} style={styles.row}>
                {row.items.map((item) => (
                  <Card
                    key={item.id}
                    flex
                    color={item.color}
                    title={item.title}
                    subtitle={item.subtitle ?? undefined}
                    icon={<MenuCardIcon iconKey={item.iconKey} height={56} color={textColorFor(item.color)} />}
                    onPress={() => runAction(item)}
                  />
                ))}
              </View>
            );
          }
          if (row.type === "tallPair") {
            const tallTextColor = textColorFor(row.tall.color);
            const tallSubColor = tallTextColor === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(31,41,55,0.75)";
            const tallImage = menuCardImageSource(row.tall.iconKey);
            return (
              <View key={row.tall.id + "-tall"} style={styles.row}>
                <Pressable
                  style={[styles.card, styles.tallCard, { backgroundColor: row.tall.color }]}
                  onPress={() => runAction(row.tall)}
                >
                  <Text style={[styles.cardTitle, { color: tallTextColor }]}>{t(row.tall.title)}</Text>
                  {!!row.tall.subtitle && (
                    <Text style={[styles.cardSubtitle, { color: tallSubColor }]}>{t(row.tall.subtitle)}</Text>
                  )}
                  {!!tallImage && <Image source={tallImage} style={styles.tallCardImage} contentFit="cover" transition={150} />}
                </Pressable>
                <View style={styles.stackCol}>
                  {row.stack.map((item) => (
                    <Card
                      key={item.id}
                      flex
                      color={item.color}
                      title={item.title}
                      subtitle={item.subtitle ?? undefined}
                      icon={<MenuCardIcon iconKey={item.iconKey} height={44} color={textColorFor(item.color)} />}
                      onPress={() => runAction(item)}
                    />
                  ))}
                </View>
              </View>
            );
          }
          // roundPair
          const roundImage = menuCardImageSource(row.round.iconKey);
          return (
            <View key={row.round.id + "-round"} style={styles.row}>
              <Pressable
                style={[styles.roundCard, { backgroundColor: row.round.color }]}
                onPress={() => runAction(row.round)}
              >
                {roundImage ? (
                  // The reference sticker already bakes its own label into the
                  // image, so it fills the whole circle with no extra text on top.
                  <Image source={roundImage} style={styles.roundCardImage} contentFit="cover" transition={150} />
                ) : (
                  <>
                    <MenuCardIcon iconKey={row.round.iconKey} height={26} color={textColorFor(row.round.color)} />
                    <Text style={[styles.roundCardTitle, { color: textColorFor(row.round.color) }]} numberOfLines={1}>
                      {t(row.round.title)}
                    </Text>
                  </>
                )}
              </Pressable>
              <Card
                flex
                color={row.wide.color}
                title={row.wide.title}
                subtitle={row.wide.subtitle ?? undefined}
                icon={<MenuCardIcon iconKey={row.wide.iconKey} height={52} color={textColorFor(row.wide.color)} />}
                onPress={() => runAction(row.wide)}
              />
            </View>
          );
        })}

        {!!activeLives?.length && (
          <Pressable
            style={styles.liveNowBanner}
            onPress={() => router.push(`/live/${activeLives[0].roomName}`)}
          >
            <View style={styles.liveNowDot} />
            <Text style={styles.liveNowText} numberOfLines={1}>
              {activeLives[0].hostName || t("أحد المعلنين")} {t("يبث مباشرة الآن")}
              {activeLives.length > 1 ? ` +${activeLives.length - 1}` : ""}
            </Text>
            <Text style={styles.liveNowJoin}>{t("مشاهدة")}</Text>
          </Pressable>
        )}
      </ScrollView>

      <NotificationsDropdown
        visible={notifMenuVisible}
        onClose={() => setNotifMenuVisible(false)}
        activeCat={notifications.activeCat}
        onSwitchCat={notifications.setActiveCat}
        filter={notifications.filter}
        onSetFilter={notifications.setFilter}
        badges={notifications.badges}
        items={notifications.visibleItems}
        onMarkAllRead={notifications.markAllRead}
        onItemPress={(index) => {
          const item = notifications.visibleItems[index];
          notifications.markItemRead(notifications.activeCat, index);
          setNotifMenuVisible(false);
          if (!item?.action) return;
          const a = item.action;
          if (a.type === "seller") router.push(`/seller/${a.id}`);
          else if (a.type === "property") router.push(`/property/${a.id}`);
          else if (a.type === "reel") router.push(`/property/${a.propertyId}`);
          else if (a.type === "chat") router.push(`/chat/${a.id}`);
        }}
      />
    </View>
  );
}

function Card({
  color, title, subtitle, icon, onPress, flex, small, ctaLabel,
}: {
  color: string; title: string; subtitle?: string; icon?: React.ReactNode; onPress: () => void;
  flex?: boolean; small?: boolean; ctaLabel?: string;
}) {
  const { t } = useLanguage();
  const textColor = textColorFor(color);
  const subtitleColor = textColor === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(31,41,55,0.75)";

  if (ctaLabel) {
    // Full-width card with a CTA pill on the side, e.g. "لوازم السباكة والكهرباء" → "اطلب الآن"
    return (
      <Pressable style={[styles.card, styles.ctaCard, { backgroundColor: color }]} onPress={onPress}>
        {icon}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.cardTitle, { color: textColor }]}>{t(title)}</Text>
          {!!subtitle && <Text style={[styles.cardSubtitle, { color: subtitleColor }]}>{t(subtitle)}</Text>}
        </View>
        <View style={styles.ctaPill}>
          <Text style={styles.ctaPillText}>{t(ctaLabel)}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: color },
        flex && { flex: 1 },
        small && styles.cardSmall,
      ]}
      onPress={onPress}
    >
      {icon}
      <View style={icon ? { marginTop: 8 } : undefined}>
        <Text style={[styles.cardTitle, { color: textColor }, small && styles.cardTitleSmall]}>{t(title)}</Text>
        {!!subtitle && <Text style={[styles.cardSubtitle, { color: subtitleColor }]}>{t(subtitle)}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#D6E3CF" },
  scroll: { padding: 14, gap: 10, paddingBottom: 110 },
  row: { flexDirection: "row", gap: 10 },
  card: { borderRadius: 16, padding: 16, minHeight: 100, justifyContent: "center" },
  cardSmall: { minHeight: 64, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontWeight: "900", fontSize: 15 },
  cardTitleSmall: { fontSize: 13, textAlign: "center" },
  cardSubtitle: { fontSize: 11.5, marginTop: 3 },
  ctaCard: { flexDirection: "row", alignItems: "center", minHeight: 88 },
  ctaPill: { backgroundColor: "#F2B23D", borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  ctaPillText: { color: "#1f2937", fontWeight: "900", fontSize: 12.5 },
  tallCard: { flex: 1, minHeight: 214, justifyContent: "flex-start", paddingTop: 18, paddingBottom: 12, overflow: "hidden" },
  tallCardImage: { flex: 1, width: "100%", borderRadius: 12, marginTop: 10 },
  stackCol: { flex: 1, gap: 10 },
  roundCard: {
    width: 108, height: 108, borderRadius: 54, alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden",
  },
  roundCardImage: { width: "100%", height: "100%" },
  roundCardTitle: { fontSize: 11.5, fontWeight: "900" },
  liveNowBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#111827", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 4,
  },
  liveNowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  liveNowText: { flex: 1, color: "white", fontSize: 12, fontWeight: "800" },
  liveNowJoin: { color: "#22A652", fontSize: 12, fontWeight: "900" },
});
