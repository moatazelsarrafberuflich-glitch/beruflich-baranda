import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Animated, Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Rect, Circle } from "react-native-svg";
import { signInWithGoogle, signInAsGuest } from "../lib/hooks/useAuth";
import { getAuthSnapshot, subscribeAuthState, useCurrentUser } from "../lib/hooks/useCurrentUser";
import { supabase } from "../lib/supabase";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";

const SKIP_KEY = "diarino:skip_auth"; // ↔ SKIP_KEY/sessionStorage in the original — AsyncStorage on native
const INTRO_DURATION_MS = 1600;

export default function AuthGateScreen() {
  // ↔ "صفحة افتتاحية يظهر بها شعار التطبيق" — a distinct opening screen
  // shown first, before either the loading spinner or the login form,
  // regardless of how long session-checking takes (the login screen
  // already had a logo+skyline treatment of its own; this is a separate,
  // deliberately brief first impression, not a reskin of that screen).
  const [showIntro, setShowIntro] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingInGuest, setSigningInGuest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  useEffect(() => {
    const timer = setTimeout(() => setShowIntro(false), INTRO_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(SKIP_KEY).then(async (v) => {
      if (!mounted || v !== "1") return;
      // A guest flag from a previous session, but with no live Supabase
      // session (e.g. it expired, or this flag predates the anonymous-auth
      // fix above) — silently upgrade it to a real anonymous session so
      // RLS-protected reads keep working instead of the guest seeing an
      // empty app.
      if (!getAuthSnapshot().user) {
        await signInAsGuest().catch(() => {});
      }
      if (mounted) setSkipped(true);
    });

    const unsubscribe = subscribeAuthState(() => {
      const session = getAuthSnapshot();
      if (!mounted) return;
      if (session.user) {
        setHasSession(true);
        setSkipped(false);
        AsyncStorage.removeItem(SKIP_KEY);
      } else {
        setHasSession(false);
      }
    });

    setHasSession(!!currentUser);
    setLoading(authLoading);

    return () => { mounted = false; unsubscribe(); };
  }, [authLoading, currentUser]);

  // ↔ the `if (!session && !skipped) return <LoginScreen/>` branch — once
  // either is true, hand off to the tab shell instead of an iframe src swap.
  useEffect(() => {
    if (loading || (!hasSession && !skipped)) return;

    let mounted = true;
    async function routeAuthenticatedUser() {
      if (!hasSession || skipped) {
        if (mounted) router.replace("/(tabs)");
        return;
      }

      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", currentUser?.id ?? "")
        .eq("role", "admin")
        .maybeSingle();

      if (mounted) router.replace(role?.role === "admin" ? "/admin" : "/(tabs)");
    }

    routeAuthenticatedUser();
    return () => { mounted = false; };
  }, [loading, hasSession, skipped]);

  async function handleGoogleSignIn() {
    setSigningIn(true);
    setError(null);
    const { error: err } = await signInWithGoogle();
    setSigningIn(false);
    if (err) setError(err);
  }

  async function handleSkip() {
    setSigningInGuest(true);
    setError(null);
    const { error: err } = await signInAsGuest();
    setSigningInGuest(false);
    if (err) {
      setError(err);
      return;
    }
    await AsyncStorage.setItem(SKIP_KEY, "1");
    setSkipped(true);
  }

  if (showIntro) {
    return <IntroSplash />;
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#22A652" size="large" />
      </View>
    );
  }

  if (hasSession || skipped) {
    return <View style={styles.loadingContainer} />; // brief flash before the replace() above lands
  }

  return (
    <LoginScreen onGoogle={handleGoogleSignIn} onSkip={handleSkip} signingIn={signingIn} signingInGuest={signingInGuest} error={error} />
  );
}

// ↔ the standalone opening screen — the Diarino logo on an office wall,
// as approved in the brand photo, filling the screen with a soft fade-in,
// auto-dismissing after INTRO_DURATION_MS (see the timer in AuthGateScreen
// above). Same image also powers the native cold-start splash (app.json).
function IntroSplash() {
  const opacity = useRef(new Animated.Value(0)).current;
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);

  return (
    <View style={styles.introContainer}>
      <Animated.Image
        source={require("../assets/intro-splash.png")}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
      />
    </View>
  );
}

// ↔ redesigned to match the new brand photo (assets/logo-mark.png — the
// same navy/gold "D" mark + wordmark cropped out of the intro splash
// image, background stripped of the plant/office so it reads cleanly on
// its own) instead of the old dark night-skyline treatment, so the
// hand-off from IntroSplash into this screen feels like one continuous
// identity rather than two different apps.
function LoginScreen({
  onGoogle, onSkip, signingIn, signingInGuest, error,
}: { onGoogle: () => void; onSkip: () => void; signingIn: boolean; signingInGuest: boolean; error: string | null }) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(1)).current;
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  useEffect(() => {
    Animated.timing(logoOpacity, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, { toValue: 1.12, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowScale, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <LinearGradient
      colors={themeColors.isDark ? ["#0F1B28", "#14293C", "#1A3550"] : ["#E7EBDD", "#C7CFBC", "#B6BEAF"]}
      locations={[0, 0.55, 1]}
      style={styles.container}
    >
      <View style={styles.centerBlock}>
        <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }] }]} />
        <Animated.View style={{ opacity: logoOpacity, alignItems: "center" }}>
          <Animated.Image source={require("../assets/logo-mark.png")} style={styles.logoMark} resizeMode="contain" />
          <Text style={styles.logoSubtext}>منصة العقارات على شكل ريلز</Text>
        </Animated.View>
      </View>

      <View style={styles.bottomBlock}>
        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable style={styles.googleBtn} onPress={onGoogle} disabled={signingIn || signingInGuest}>
          {signingIn ? (
            <ActivityIndicator color="#14293C" size="small" />
          ) : (
            <>
              <GoogleIcon />
              <Text style={styles.googleBtnText}>المتابعة باستخدام جوجل</Text>
            </>
          )}
        </Pressable>

        <Pressable style={styles.skipBtn} onPress={onSkip} disabled={signingInGuest || signingIn}>
          {signingInGuest ? (
            <ActivityIndicator color="#14293C" size="small" />
          ) : (
            <Text style={styles.skipBtnText}>المتابعة كضيف</Text>
          )}
        </Pressable>
      </View>
    </LinearGradient>
  );
}

function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Rect width={24} height={24} rx={4} fill="white" />
      <Circle cx={12} cy={12} r={9} fill="none" stroke="#4285F4" strokeWidth={0} />
    </Svg>
  );
}

// ↔ الوضع الداكن (إغلاق الملف — بدون استثناء): خلفية التدرّج (gradient)
// وألوان النصوص بتتبدّل مع الثيم — نسخة داكنة متناسقة مع هوية العلامة
// (نفس درجة الأزرق الكحلي #14293C المستخدمة أصلاً فى النص، بس كخلفية
// دلوقتي) بدل ما تفضل ثابتة على الوضع الفاتح دايمًا.
//
// ⚠️ استثناء واحد مبرَّر: زرار "المتابعة باستخدام جوجل" (`googleBtn`)
// فضل خلفيته بيضا ثابتة فى الوضعين — ده مش تفضيل تصميمي مننا، ده شرط من
// إرشادات العلامة التجارية الرسمية لـ Google لأزرار تسجيل الدخول
// (Google Sign-In Branding Guidelines) اللي بتوجب استخدام الزرار الأبيض
// القياسي أو الأسود القياسي بس، مش أي لون تاني — نفس السبب اللي خلى
// شعارات/أزرار "Sign in with Apple" فى تطبيقات تانية بتفضل بألوانها
// المحددة برضه بغض النظر عن ثيم التطبيق المضيف.
function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    loadingContainer: { flex: 1, backgroundColor: themeColors.isDark ? "#0F1B28" : "#B6BEAF", alignItems: "center", justifyContent: "center" },
    introContainer: { flex: 1, backgroundColor: themeColors.isDark ? "#0F1B28" : "#B6BEAF", alignItems: "center", justifyContent: "center" },
    container: { flex: 1, justifyContent: "space-between" },
    centerBlock: { flex: 1, alignItems: "center", justifyContent: "center" },
    glow: {
      position: "absolute", width: 260, height: 260, borderRadius: 130,
      backgroundColor: "rgba(176,166,107,0.28)",
    },
    logoMark: { width: 220, height: 230 },
    logoSubtext: { color: themeColors.isDark ? "#E7EBDD" : "#14293C", opacity: 0.75, fontSize: 12.5, fontWeight: "700", marginTop: 10, textAlign: "center" },
    bottomBlock: { padding: 24, paddingBottom: 42, gap: 12 },
    errorText: { color: themeColors.isDark ? "#F87171" : "#B3261E", fontSize: 12, textAlign: "center", marginBottom: 4, fontWeight: "700" },
    googleBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      backgroundColor: "white", borderRadius: 14, paddingVertical: 15,
      borderWidth: 1, borderColor: "rgba(20,41,60,0.12)",
      shadowColor: "#14293C", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    },
    googleBtnText: { color: "#14293C", fontSize: 14, fontWeight: "800" },
    skipBtn: { alignItems: "center", paddingVertical: 10 },
    skipBtnText: { color: themeColors.isDark ? "#E7EBDD" : "#14293C", opacity: 0.65, fontSize: 12.5, fontWeight: "700" },
  });
}
