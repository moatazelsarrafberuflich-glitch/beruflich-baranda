import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, Text, Pressable, StyleSheet, Share, Alert } from "react-native";
import {
  LiveKitRoom,
  useTracks,
  useParticipants,
  useRoomContext,
  VideoTrack,
  isTrackReference,
  AudioSession,
  Track,
  RoomEvent,
  DisconnectReason,
} from "../../lib/livekit-platform";
import Svg, { Path } from "react-native-svg";
import { LiveCommentsOverlay } from "../../components/live/LiveCommentsOverlay";
import { FloatingHeartLayer } from "../../components/live/FloatingHeart";
import { ReportModal } from "../../components/shared/ReportModal";
import { useLiveKitToken, useLiveComments, useLiveLikes, useLiveByRoomName } from "../../lib/hooks/useLiveKitRoom";
import { useFollows } from "../../lib/hooks/useFollows";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// `id` here is actually the LiveKit room_name (see createLiveRoom in
// lib/livekit.ts) — kept as the param name since that's what the route
// file is called, but it's used to look up the real `lives` row below.
export default function LiveViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { displayName } = useCurrentUser();
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  // Every broadcast is recorded from the moment it goes live (see
  // startRecording() in app/live/broadcast.tsx, called unconditionally
  // right after connect) — so a viewer is *always* joining a session
  // that's being recorded, never sometimes. This gate is shown before
  // anything else on this screen: no token fetch, no room connect, no
  // media, until the viewer taps "موافق". "رجوع" is the only way out
  // besides agreeing — there's no dismiss/skip/X on this screen.
  const [consentGiven, setConsentGiven] = useState(false);
  const { info, error, ready } = useLiveKitToken(consentGiven ? id : "");
  // ↔ replaces trusting title/sellerName query params — this is a real
  // lookup of the `lives` row, which also gives the follow button an
  // actual seller id to act on (the params-only version had none).
  const { data: liveMeta } = useLiveByRoomName(id);

  if (!consentGiven) {
    return (
      <View style={styles.center}>
        <View style={styles.consentCard}>
          <Text style={styles.consentText}>
            {t("⚠️ هذا البث يتم تسجيله. بانضمامك أنت توافق على التسجيل.")}
          </Text>
          <Pressable style={styles.consentAgreeBtn} onPress={() => setConsentGiven(true)}>
            <Text style={styles.consentAgreeBtnText}>{t("موافق")}</Text>
          </Pressable>
          <Pressable style={styles.consentBackBtn} onPress={() => router.back()}>
            <Text style={styles.consentBackBtnText}>{t("رجوع")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t("هذا البث غير متاح حاليًا")}</Text>
        <Pressable style={styles.leaveBtn} onPress={() => router.back()}>
          <Text style={styles.leaveBtnText}>{t("رجوع")}</Text>
        </Pressable>
      </View>
    );
  }

  if (!ready || !info) return <View style={styles.center} />;

  return (
    <LiveKitRoom serverUrl={info.url} token={info.token} connect video={false} audio={false}>
      <ViewerLiveView
        roomName={id}
        liveId={liveMeta?.id}
        title={liveMeta?.title ?? ""}
        sellerId={liveMeta?.hostId}
        sellerName={liveMeta?.hostName || t("البائع")}
        displayName={displayName}
      />
    </LiveKitRoom>
  );
}

function ViewerLiveView({
  roomName, liveId, title, sellerId, sellerName, displayName,
}: { roomName: string; liveId?: string; title: string; sellerId?: string; sellerName: string; displayName: string }) {
  const { t } = useLanguage();
  const [reportVisible, setReportVisible] = useState(false);
  const room = useRoomContext();
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera]);

  // Type Guard لتأمين النوع بدون any
 // Type Guard صريح ينفي أي خطأ implicit any
  const remoteTrackRef = tracks.find(
    (trackRef: typeof tracks[number]): trackRef is typeof trackRef & { participant: { isLocal: boolean } } =>
      isTrackReference(trackRef) && !trackRef.participant.isLocal
  );
  const { comments, sendComment } = useLiveComments(displayName);
  const { burstId, sendLike } = useLiveLikes();
  const { followedIds, toggleFollow } = useFollows();
  const isFollowing = !!sellerId && followedIds.has(sellerId);

  useEffect(() => {
    AudioSession.startAudioSession();
    return () => { AudioSession.stopAudioSession(); };
  }, []);

  // Host removed this viewer via the "kick" control in livekit-moderate.
  // RoomEvent.Disconnected only fires on a *final* disconnect (not on the
  // transient reconnect attempts LiveKit handles internally), so this is
  // specifically "kicked", not "flaky network" — hence the dedicated
  // message rather than silently dropping them back to the previous screen.
  useEffect(() => {
    if (!room) return;
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        Alert.alert(t("تم إزالتك من البث"), "", [{ text: t("حسنًا"), onPress: () => router.back() }]);
      }
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => { room.off(RoomEvent.Disconnected, onDisconnected); };
  }, [room, t]);

  async function onShare() {
    try {
      await Share.share({
        message: t("شاهد البث المباشر على ديارينو") + (title ? `: ${title}` : "") + ` — ${sellerName}`,
      });
    } catch (err) {
      console.warn("Failed to open share sheet:", err);
    }
  }

  return (
    <View style={styles.container}>
      {remoteTrackRef && isTrackReference(remoteTrackRef) ? (
        <VideoTrack trackRef={remoteTrackRef} style={styles.video} />
      ) : (
        <View style={[styles.video, styles.waitingBg]}>
          <Text style={styles.waitingText}>{t("في انتظار البث...")}</Text>
        </View>
      )}

      <View style={styles.topBar}>
        <View style={styles.broadcasterChip}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{sellerName.charAt(0)}</Text>
          </View>
          <Text style={styles.broadcasterName}>{t(sellerName)}</Text>
          {!!sellerId && (
            <Pressable
              style={[styles.followBtn, isFollowing && styles.followBtnActive]}
              onPress={() => toggleFollow(sellerId)}
            >
              <Text style={styles.followBtnText}>{isFollowing ? t("متابَع ✓") : t("متابعة")}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.viewerPill}>
          <Text style={styles.viewerPillText}>👁 {participants.length}</Text>
        </View>
        <View style={styles.recPill}>
          <Text style={styles.recPillText}>● {t("يُسجَّل")}</Text>
        </View>
        <Pressable style={styles.closeBtn} onPress={() => router.back()}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
            <Path d="M6 6l12 12M18 6L6 18" />
          </Svg>
        </Pressable>
      </View>

      {!!title && (
        <View style={styles.titlePill}>
          <Text style={styles.titlePillText}>📢 {t(title)}</Text>
        </View>
      )}

      <View style={styles.sideActions}>
        <Pressable style={styles.actionBtn} onPress={sendLike} hitSlop={8}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
            <Path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" />
          </Svg>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={onShare} hitSlop={8}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
            <Path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v14" />
          </Svg>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => setReportVisible(true)} hitSlop={8}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
            <Path d="M4 22V4" /><Path d="M4 4h13l-2 4 2 4H4" />
          </Svg>
        </Pressable>
      </View>

      <LiveCommentsOverlay comments={comments} onSend={sendComment} />
      <FloatingHeartLayer burstId={burstId} />
      {!!liveId && (
        <ReportModal
          visible={reportVisible}
          onClose={() => setReportVisible(false)}
          targetType="live"
          targetId={liveId}
          targetTitle={title || "بث مباشر"}
        />
      )}
    </View>
  );
}

// ↔ قاعدة تثيم الوسائط (نسخة نهائية معتمدة — docs/deferred-tasks.md):
// styles العادية دي (module-level، ثابتة) خاصة بـ ViewerLiveView — كل
// حاجة فيها مرسومة مباشرة فوق سطح الفيديو أو هي سطح الفيديو نفسه
// (container/video/topBar/sideActions/الأزرار...) فتفضل ثابتة بغض النظر
// عن الثيم، بالظبط زي الريلز. createStyles(themeColors) تحت خاصة بشاشات
// "قبل الانضمام" (الموافقة/الخطأ/التحميل) اللي مفيش فيها فيديو أصلاً.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  recPill: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  recPillText: { color: "#ef4444", fontSize: 10, fontWeight: "900" },
  video: { flex: 1 },
  waitingBg: { backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  waitingText: { color: "#9ca3af", fontSize: 14, fontWeight: "700" },
  topBar: { position: "absolute", top: 50, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  broadcasterChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 6 },
  avatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#22A652", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontWeight: "900", fontSize: 12 },
  broadcasterName: { color: "white", fontSize: 12, fontWeight: "800" },
  followBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  followBtnActive: { backgroundColor: "rgba(255,255,255,0.2)" },
  followBtnText: { color: "white", fontSize: 10, fontWeight: "900" },
  viewerPill: { marginLeft: "auto", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  viewerPillText: { color: "white", fontSize: 11, fontWeight: "800" },
  closeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  titlePill: { position: "absolute", top: 92, left: 14, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  titlePillText: { color: "white", fontSize: 13, fontWeight: "900" },
  sideActions: { position: "absolute", right: 12, bottom: 150, gap: 18, alignItems: "center" },
  actionBtn: { alignItems: "center", justifyContent: "center" },
});

// ↔ يتبع الثيم — شاشات ما قبل الانضمام (موافقة/خطأ/تحميل)، مفيش فيديو
// ظاهر لحظتها أصلاً.
function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, backgroundColor: themeColors.background, alignItems: "center", justifyContent: "center", gap: 16 },
    errorText: { color: themeColors.text, fontSize: 15, fontWeight: "800" },
    leaveBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24 },
    leaveBtnText: { color: "white", fontWeight: "900" },
    consentCard: { width: "88%", maxWidth: 340, backgroundColor: themeColors.card, borderRadius: 20, padding: 24, alignItems: "center", gap: 14, borderWidth: 1, borderColor: themeColors.border },
    consentText: { color: themeColors.text, fontSize: 15, fontWeight: "700", textAlign: "center", lineHeight: 22 },
    consentAgreeBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 12, alignSelf: "stretch", alignItems: "center", marginTop: 4 },
    consentAgreeBtnText: { color: "white", fontWeight: "900", fontSize: 15 },
    consentBackBtn: { paddingVertical: 8, alignSelf: "stretch", alignItems: "center" },
    consentBackBtnText: { color: themeColors.textSubtle, fontWeight: "700", fontSize: 13 },
  });
}