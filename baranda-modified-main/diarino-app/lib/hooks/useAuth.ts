import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase";
import { queryClient } from "../queryClient";
import { resetAdminDB } from "./useAdminDB";
import { clearCompareSelection } from "./useCompareSelection";
import { getAuthSnapshot } from "./useCurrentUser";

const SKIP_KEY = "diarino:skip_auth"; // must match app/index.tsx

let callbackSessionPromise: Promise<{ error: string | null }> | null = null;
let callbackUrl: string | null = null;
let intentionalSignOut = false;

export function consumeIntentionalSignOut(): boolean {
  const value = intentionalSignOut;
  intentionalSignOut = false;
  return value;
}

WebBrowser.maybeCompleteAuthSession();

// ↔ translateOAuthError() — same error-message mapping, ported as-is.
export function translateOAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("popup") && m.includes("closed")) return "تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.";
  if (m.includes("popup") && m.includes("block")) return "المتصفح منع النافذة المنبثقة. فعّل النوافذ لهذا الموقع وحاول مجدداً.";
  if (m.includes("unsupported provider") || m.includes("provider is not enabled"))
    return "مزوّد Google غير مفعّل في الخلفية. راجع إعدادات OAuth.";
  if (m.includes("redirect") && (m.includes("uri") || m.includes("mismatch")))
    return "عنوان إعادة التوجيه غير مطابق للمُسجَّل في Google Cloud.";
  if (m.includes("invalid_client") || m.includes("client_id"))
    return "بيانات اعتماد Google غير صحيحة (Client ID/Secret). حدّثها من صفحة الإعدادات.";
  if (m.includes("access_denied") || m.includes("denied")) return "تم رفض الإذن من قِبل المستخدم أو من قِبل Google.";
  if (m.includes("network") || m.includes("fetch")) return "تعذر الاتصال بالخادم. تحقق من الإنترنت.";
  if (m.includes("timeout") || m.includes("timed out")) return "انتهت مهلة الاتصال. حاول مرة أخرى.";
  if (m.includes("expired")) return "انقضت صلاحية الجلسة/الرمز. أعد المحاولة.";
  return raw || "تعذر تسجيل الدخول. حاول مرة أخرى.";
}

export async function completeOAuthCallback(rawUrl: string): Promise<{ error: string | null }> {
  if (callbackUrl === rawUrl && callbackSessionPromise) return callbackSessionPromise;
  callbackUrl = rawUrl;
  callbackSessionPromise = completeOAuthCallbackOnce(rawUrl);
  return callbackSessionPromise;
}

async function completeOAuthCallbackOnce(rawUrl: string): Promise<{ error: string | null }> {
  const url = new URL(rawUrl);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const accessToken = url.searchParams.get("access_token") || hashParams.get("access_token");
  const refreshToken = url.searchParams.get("refresh_token") || hashParams.get("refresh_token");

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return error ? { error: translateOAuthError(error.message) } : { error: null };
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? { error: translateOAuthError(error.message) } : { error: null };
  }

  const errorDescription = url.searchParams.get("error_description") || hashParams.get("error_description");
  return { error: translateOAuthError(errorDescription || "") };
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  // In a browser, always return to the current web origin. The custom
  // diarino:// scheme is only handled by an installed native build.
  const isWeb = typeof window !== "undefined";
  const redirectUri = isWeb
    ? `${window.location.origin}/auth-callback`
    : AuthSession.makeRedirectUri({ scheme: "diarino", path: "auth-callback" });

  // 1. التعامل مع بيئة الويب (Web)
  if (isWeb) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUri,
        skipBrowserRedirect: false, // تحويل مباشر في المتصفح دون تعليق
      },
    });

    if (error) return { error: translateOAuthError(error.message) };
    if (data?.url) {
      window.location.href = data.url; // التوجيه الفوري لصفحة Google
    }
    return { error: null };
  }

  // 2. التعامل مع تطبيقات الهاتف (Native)
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectUri, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    return { error: translateOAuthError(error?.message || "") };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
  if (result.type !== "success" || !result.url) {
    return { error: result.type === "cancel" ? null : "تعذر تسجيل الدخول. حاول مرة أخرى." };
  }

  const callbackResult = await completeOAuthCallback(result.url);
  if (callbackResult.error) return callbackResult;

  const uid = getAuthSnapshot().user?.id;
  if (uid) {
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle();
    supabase.from("user_activity_log").insert({
      user_id: uid, user_name: profile?.full_name ?? null, activity_type: "login",
    }).then(({ error }) => {
      if (error) console.warn("Failed to log login activity:", error);
    });
  }

  return { error: null };
}

export async function signInAsGuest(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) return { error: translateOAuthError(error.message) };
  return { error: null };
}

export async function signOut(): Promise<void> {
  intentionalSignOut = true;
  try {
    // A local sign-out must not wait for the network. Global revocation can
    // be rate-limited by Supabase and would leave the settings button stuck.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Clear the local session even when the auth request fails.
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
  }
  await AsyncStorage.removeItem(SKIP_KEY).catch(() => {});
  queryClient.clear();
  resetAdminDB();
  clearCompareSelection();
}