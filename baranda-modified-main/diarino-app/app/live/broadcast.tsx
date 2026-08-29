import { useMemo, useState, useEffect, useRef } from "react";
import { router } from "expo-router";
import { View, Text, TextInput, Pressable, StyleSheet, Modal, FlatList, Alert } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  registerGlobals,
  LiveKitRoom,
  useTracks,
  useParticipants,
  useRoomContext,
  useIsMuted,
  VideoTrack,
  isTrackReference,
  AudioSession,
  Track,
  isLocalVideoTrack,
  Participant,
} from "../../lib/livekit-platform";
import { PermissionGate } from "../../components/live/PermissionGate";
import { LiveCommentsOverlay } from "../../components/live/LiveCommentsOverlay";
import { FloatingHeartLayer } from "../../components/live/FloatingHeart";
import { useLiveKitToken, useLiveComments, useLiveLikes } from "../../lib/hooks/useLiveKitRoom";
import { createLiveRoom, endLiveRoom, startRecording, stopRecording, kickParticipant } from "../../lib/livekit";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useFinalizeSavedLive } from "../../lib/hooks/useMyContent";
import { logAndGetSafeMessage } from "../../lib/errors";

try {
  registerGlobals();
} catch (e) {
  console.warn("LiveKit already initialized", e);
}

const MAX_TITLE_WORDS = 5;

export default function BroadcastScreen() {
  const { user } = useCurrentUser();
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  if (user?.is_anonymous) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>{t("بث مباشر")}</Text>
        <Text style={styles.anonBlockedText}>
          {t("يجب تسجيل الدخول بحساب Google لبدء بث مباشر")}
        </Text>
        <Pressable style={styles.leaveSetupBtn} onPress={() => router.back()}>
          <Text style={styles.leaveSetupBtnText}>{t("رجوع")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <PermissionGate>
      <BroadcastFlow />
    </PermissionGate>
  );
}

function BroadcastFlow() {
  const { user, displayName } = useCurrentUser();
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"setup" | "starting" | "live">("setup");
  const [startError, setStartError] = useState<Error | null>(null);

  const roomName = useMemo(() => `live_${user?.id ?? "anon"}_${Date.now()}`, [user?.id]);
  const wordCount = title.trim().length ? title.trim().split(/\s+/).length : 0;
  const titleValid = wordCount > 0 && wordCount <= MAX_TITLE_WORDS;

  const { info, error, ready } = useLiveKitToken(phase === "live" || phase === "starting" ? roomName : "");

  async function startBroadcast() {
    setPhase("starting");
    setStartError(null);
    try {
      await createLiveRoom(roomName, title.trim());
      setPhase("live");
    } catch (err) {
      setStartError(err instanceof Error ? err : new Error(String(err)));
      setPhase("setup");
    }
  }

  if (phase === "setup" || phase === "starting") {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>{t("بث مباشر")}</Text>
        <Text style={styles.setupLabel}>{t("عنوان اللايف")} (٥ {t("كلمات")} كحد أقصى)</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder={t("فيلا مميزة بالتجمع الخامس")}
          placeholderTextColor={themeColors.textSubtle}
          maxLength={80}
          editable={phase === "setup"}
        />
        <Text style={[styles.wordCount, !titleValid && wordCount > 0 && styles.wordCountError]}>
          {wordCount}/{MAX_TITLE_WORDS} {t("كلمات")}
        </Text>
        {startError && <Text style={styles.wordCountError}>{startError.message}</Text>}
        <Pressable
          style={[styles.goLiveBtn, (!titleValid || phase === "starting") && styles.goLiveBtnDisabled]}
          disabled={!titleValid || phase === "starting"}
          onPress={startBroadcast}
        >
          <Text style={styles.goLiveBtnText}>{phase === "starting" ? t("جارٍ البدء...") : t("ابدأ البث")}</Text>
        </Pressable>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>{t("تعذر بدء البث")}</Text>
        <Text style={styles.wordCountError}>{error.message}</Text>
        <Pressable style={styles.goLiveBtn} onPress={() => setPhase("setup")}>
          <Text style={styles.goLiveBtnText}>{t("رجوع")}</Text>
        </Pressable>
      </View>
    );
  }

  if (!ready || !info) return null;

  return (
    <LiveKitRoom serverUrl={info.url} token={info.token} connect video={info.isHost} audio={info.isHost}>
      <BroadcasterLiveView
        title={title}
        displayName={displayName}
        userId={user?.id ?? "me"}
        roomName={roomName}
        onEnd={() => {
          endLiveRoom(roomName);
          router.back();
        }}
      />
    </LiveKitRoom>
  );
}

// Custom Type Guard لضمان مطابقة الأنواع وأمان التشغيل بدون any
function isValidTrackRef(tr: unknown): tr is { participant: { isLocal: boolean }; publication?: { track?: { restartTrack?: (opts: { facingMode: string }) => Promise<void> } } } {
  return isTrackReference(tr) && typeof tr === "object" && tr !== null && "participant" in tr;
}

function BroadcasterLiveView({
  title, displayName, userId, roomName, onEnd,
}: { title: string; displayName: string; userId: string; roomName: string; onEnd: () => void }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const room = useRoomContext();
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera]);

  // Safe track reference lookup باستخدام دالة Guard المخصصة
  const localTrackRef = tracks.find(isValidTrackRef);

  const { comments, sendComment } = useLiveComments(displayName);
  const microphoneTrackRef = { participant: room.localParticipant, source: Track.Source.Microphone };
  const isMuted = useIsMuted(microphoneTrackRef);

  const startedAtRef = useRef(Date.now());
  const peakViewersRef = useRef(0);
  const egressIdRef = useRef<string | null>(null);
  const [recordingStarted, setRecordingStarted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [viewersModalVisible, setViewersModalVisible] = useState(false);
  const [kickingId, setKickingId] = useState<string | null>(null);
  const finalizeSavedLive = useFinalizeSavedLive();
  const { burstId: likeBurstId } = useLiveLikes();

  const viewers = participants.filter((p: Participant) => !p.isLocal);

  useEffect(() => {
    AudioSession.startAudioSession();
    return () => { AudioSession.stopAudioSession(); };
  }, []);

  useEffect(() => {
    startRecording(roomName)
      .then(({ egressId }) => { egressIdRef.current = egressId; setRecordingStarted(true); })
      .catch((err) => console.warn("Failed to start Egress recording:", err));
  }, [roomName]);

  useEffect(() => {
    const current = Math.max(0, participants.length - 1);
    if (current > peakViewersRef.current) peakViewersRef.current = current;
  }, [participants.length]);

  function toggleMic() {
    room?.localParticipant.setMicrophoneEnabled(isMuted);
  }

  async function flipCamera() {
    if (!localTrackRef) return;
    const track = localTrackRef.publication?.track;
    if (!isLocalVideoTrack(track)) return;
    const next = facingMode === "user" ? "environment" : "user";
    try {
      await track.restartTrack({ facingMode: next });
      setFacingMode(next);
    } catch (err) {
      console.warn("Failed to switch camera:", err);
    }
  }

  async function endLive() {
    const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);

    if (egressIdRef.current) {
      try {
        await stopRecording(roomName, egressIdRef.current, durationSec);
      } catch (err) {
        console.warn("Failed to stop Egress recording:", err);
      }
    }

    finalizeSavedLive.mutate({ roomName, viewerPeak: peakViewersRef.current });
    room?.disconnect();
    onEnd();
  }

  function confirmKick(participant: { identity: string; name?: string }) {
    Alert.alert(
      t("طرد المشاهد"),
      `${t("هل تريد إزالة")} ${participant.name || t("مشاهد")} ${t("من البث؟")}`,
      [
        { text: t("إلغاء"), style: "cancel" },
        {
          text: t("طرد"),
          style: "destructive",
          onPress: async () => {
            setKickingId(participant.identity);
            try {
              await kickParticipant(roomName, participant.identity);
            } catch (err) {
              Alert.alert(t("تعذّر الطرد"), logAndGetSafeMessage("kickParticipant failed", err, t("برجاء المحاولة مرة أخرى.")));
            } finally {
              setKickingId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.liveContainer}>
      {localTrackRef ? (
        <VideoTrack trackRef={localTrackRef} style={styles.video} />
      ) : (
        <View style={[styles.video, { backgroundColor: "#111" }]} />
      )}

      <View style={styles.liveTopBar}>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>{t("بث مباشر")}</Text>
        </View>
        {recordingStarted && (
          <View style={styles.recPill}>
            <Text style={styles.recPillText}>● REC</Text>
          </View>
        )}
        <Pressable style={styles.viewerPill} onPress={() => setViewersModalVisible(true)}>
          <Text style={styles.viewerPillText}>👁 {Math.max(0, participants.length - 1)}</Text>
        </Pressable>
        <Pressable style={styles.endBtn} onPress={endLive}>
          <Text style={styles.endBtnText}>{t("إنهاء البث")}</Text>
        </Pressable>
      </View>

      <View style={styles.titlePill}>
        <Text style={styles.titlePillText}>📢 {t(title)}</Text>
      </View>

      <View style={styles.controlsRow}>
        <Pressable style={styles.controlBtn} onPress={toggleMic}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
            {isMuted ? (
              <Path d="M1 1l22 22M12 1a3 3 0 013 3v6M19 10v2a7 7 0 01-11 5.6M5 10v2a7 7 0 001.5 4.4M12 19v4M8 23h8" />
            ) : (
              <Path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
            )}
          </Svg>
        </Pressable>
        <Pressable style={styles.controlBtn} onPress={flipCamera}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
            <Path d="M23 4v6h-6M1 20v-6h6" />
            <Path d="M3.5 9a9 9 0 0114.5-3.5L23 10M1 14l5 5a9 9 0 0014.5-3.5" />
          </Svg>
        </Pressable>
      </View>

      <LiveCommentsOverlay comments={comments} onSend={sendComment} />
      <FloatingHeartLayer burstId={likeBurstId} />

      <Modal
        visible={viewersModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setViewersModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setViewersModalVisible(false)}>
          <Pressable style={styles.viewersSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.viewersSheetHeader}>
              <Text style={styles.viewersSheetTitle}>
                {t("المشاهدون")} ({viewers.length})
              </Text>
              <Pressable onPress={() => setViewersModalVisible(false)} hitSlop={8}>
                <Text style={styles.viewersSheetClose}>{t("إغلاق")}</Text>
              </Pressable>
            </View>
            <FlatList
              data={viewers}
              keyExtractor={(p: Participant) => p.identity}
              style={{ maxHeight: 360 }}
              ListEmptyComponent={
                <Text style={styles.noViewersText}>{t("لا يوجد مشاهدون حاليًا")}</Text>
              }
              renderItem={({ item }: { item: Participant }) => (
                <View style={styles.viewerRow}>
                  <View style={styles.viewerRowAvatar}>
                    <Text style={styles.viewerRowAvatarText}>{(item.name || "?").charAt(0)}</Text>
                  </View>
                  <Text style={styles.viewerRowName} numberOfLines={1}>{item.name || t("زائر")}</Text>
                  <Pressable
                    style={styles.kickBtn}
                    disabled={kickingId === item.identity}
                    onPress={() => confirmKick({ identity: item.identity, name: item.name })}
                  >
                    <Text style={styles.kickBtnText}>
                      {kickingId === item.identity ? t("جارٍ الطرد...") : t("طرد")}
                    </Text>
                  </Pressable>
                </View>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ↔ قاعدة تثيم الوسائط (نسخة نهائية معتمدة — docs/deferred-tasks.md):
// setupContainer وكل شاشات "قبل البث" (مفيش كاميرا شغالة لسه) + مودال
// المشاهدين (Sheet كامل، مش مرسوم على الفيديو) بتتبع الثيم. أما
// liveContainer/liveTopBar/titlePill/controlsRow وكل حاجة فوق الفيديو
// نفسه أثناء البث الفعلي — دول "تراكبات على سطح الوسائط" فتفضل ثابتة
// (أبيض/أسود + ظلال) بغض النظر عن الثيم، زي بالظبط الريلز.
function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    // ↔ يتبع الثيم — شاشات ما قبل البث
    setupContainer: { flex: 1, backgroundColor: themeColors.background, padding: 24, justifyContent: "center", gap: 10 },
    setupTitle: { color: themeColors.text, fontSize: 20, fontWeight: "900", marginBottom: 12, textAlign: "center" },
    anonBlockedText: { color: themeColors.textMuted, fontSize: 14, fontWeight: "600", textAlign: "center", lineHeight: 21, marginBottom: 8 },
    leaveSetupBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 12, alignItems: "center" },
    leaveSetupBtnText: { color: "white", fontWeight: "900", fontSize: 15 },
    setupLabel: { color: themeColors.textSubtle, fontSize: 13, fontWeight: "700" },
    titleInput: {
      backgroundColor: themeColors.surface, color: themeColors.text, borderRadius: 12, padding: 14, fontSize: 15,
      borderWidth: 1, borderColor: themeColors.border,
    },
    wordCount: { color: themeColors.textSubtle, fontSize: 12, textAlign: "right" },
    wordCountError: { color: "#ef4444" },
    goLiveBtn: { marginTop: 16, backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 14, alignItems: "center" },
    goLiveBtnDisabled: { backgroundColor: themeColors.isDark ? "#3f3f46" : "#374151" },
    goLiveBtnText: { color: "white", fontWeight: "900", fontSize: 15 },

    // ↔ ثابت دائمًا — سطح الفيديو وتراكباته المباشرة (البث الفعلي)
    liveContainer: { flex: 1, backgroundColor: "#000" },
    video: { flex: 1 },
    liveTopBar: { position: "absolute", top: 50, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 8 },
    livePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ef4444", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "white" },
    livePillText: { color: "white", fontSize: 11, fontWeight: "900" },
    recPill: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    recPillText: { color: "#ef4444", fontSize: 10, fontWeight: "900" },
    viewerPill: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    viewerPillText: { color: "white", fontSize: 11, fontWeight: "800" },
    endBtn: { marginLeft: "auto", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
    endBtnText: { color: "white", fontSize: 12, fontWeight: "900" },
    titlePill: {
      position: "absolute", top: 92, left: 14,
      backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
    },
    titlePillText: { color: "white", fontSize: 13, fontWeight: "900" },
    controlsRow: { position: "absolute", right: 14, bottom: 140, gap: 14, alignItems: "center" },
    controlBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },

    // ↔ يتبع الثيم — Sheet كامل، مش مرسوم على الفيديو
    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    viewersSheet: { backgroundColor: themeColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
    viewersSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    viewersSheetTitle: { color: themeColors.text, fontSize: 15, fontWeight: "900" },
    viewersSheetClose: { color: themeColors.textSubtle, fontSize: 13, fontWeight: "700" },
    noViewersText: { color: themeColors.textSubtle, fontSize: 13, textAlign: "center", paddingVertical: 24 },
    viewerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    viewerRowAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#22A652", alignItems: "center", justifyContent: "center" },
    viewerRowAvatarText: { color: "white", fontWeight: "900", fontSize: 13 },
    viewerRowName: { flex: 1, color: themeColors.text, fontSize: 13, fontWeight: "700" },
    kickBtn: { backgroundColor: themeColors.isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.1)", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, borderWidth: 1, borderColor: "rgba(239,68,68,0.4)" },
    kickBtnText: { color: "#ef4444", fontSize: 12, fontWeight: "900" },
  });
}