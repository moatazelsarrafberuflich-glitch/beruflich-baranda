import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Database } from "../src/types/supabase";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env file."
  );
}

let authClient: ReturnType<typeof createClient<Database>> | null = null;
let refreshFailureHandled = false;
let refreshBlockedUntil = 0;
let refreshRecoveryPromise: Promise<{ accessToken: string | null }> | null = null;
let refreshRequestPromise: Promise<Response> | null = null;

// ↔ إصلاح: طلبات الحفظ كانت بترجع 401/42501 (RLS) لأن تجديد الجلسة
// (refresh token) كان بيفشل بشكل متكرر ومتلاحق (رصدنا فى الـ console
// عشرات محاولات إعادة المحاولة السريعة على /auth/v1/token، لحد ما
// Supabase رجّع 429 Too Many Requests بسبب الحد الأقصى لمعدل الطلبات).
// كل كود سابق كان بيتعامل بس مع 400/401 على التجديد؛ 429 كان بيتجاهله
// تمامًا فيسيب المؤقت الداخلي لـ supabase-js يحاول يجدد تاني وتاني بسرعة
// من غير أي مهلة — عاصفة طلبات تتصاعد لحد الحظر المؤقت. دلوقتي أي 429
// على التجديد بيتم تسجيله برضه كفشل (زي 400/401 بالظبط) عشان يوقف
// المحاولات المتلاحقة فورًا بدل ما يسيبها تتصاعد.
const REFRESH_FAILURE_STATUSES = new Set([400, 401, 429]);
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function blockedRefreshResponse(): Response {
  return new Response(
    JSON.stringify({ code: "over_request_rate_limit", message: "Session refresh is temporarily paused" }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
}

function recoverAccessToken(): Promise<{ accessToken: string | null }> {
  if (!refreshRecoveryPromise) {
    refreshRecoveryPromise = authClient!.auth.refreshSession()
      .then(({ data, error }) => ({ accessToken: error ? null : data.session?.access_token ?? null }))
      .catch(() => ({ accessToken: null }))
      .finally(() => {
        refreshRecoveryPromise = null;
      });
  }
  return refreshRecoveryPromise;
}

function handleRefreshResponse(response: Response): void {
  if (REFRESH_FAILURE_STATUSES.has(response.status)) {
    refreshBlockedUntil = Date.now() + REFRESH_COOLDOWN_MS;
    if (!refreshFailureHandled) {
      refreshFailureHandled = true;
      authClient?.auth.stopAutoRefresh();
      void authClient?.auth.signOut({ scope: "local" });
    }
    return;
  }

  if (response.ok) {
    refreshFailureHandled = false;
    refreshBlockedUntil = 0;
    authClient?.auth.startAutoRefresh();
  }
}

const fetchWithAuthRecoveryInternal = async (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  hasRetried = false,
): Promise<Response> => {
  const requestUrl = typeof input === "string"
    ? input
    : typeof Request !== "undefined" && input instanceof Request
      ? input.url
      : String(input);
  const isRefreshRequest = requestUrl.includes("/auth/v1/token?grant_type=refresh_token");
  const isAuthTokenRequest = requestUrl.includes("/auth/v1/token");

  // Do not keep hitting Supabase while its refresh endpoint is rate-limited.
  // This protects web, native and APK clients from an auth retry storm.
  if (isRefreshRequest && Date.now() < refreshBlockedUntil) {
    return blockedRefreshResponse();
  }

  if (isRefreshRequest) {
    if (!refreshRequestPromise) {
      refreshRequestPromise = fetch(input, init)
        .then((response) => {
          handleRefreshResponse(response);
          return response;
        })
        .finally(() => {
          refreshRequestPromise = null;
        });
    }
    const response = await refreshRequestPromise;
    return response.clone();
  }

  const response = await fetch(input, init);

  // A persisted token can be rejected with PGRST303 when it was issued while
  // the device clock was ahead. Refresh it once and retry the original request
  // with the newly issued access token instead of leaving every query broken.
  if (!isRefreshRequest && response.status === 401 && authClient) {
    const body = await response.clone().json().catch(() => null) as { code?: string; message?: string } | null;
    const requestHeaders = new Headers(init?.headers);
    const isFutureJwt = body?.code === "PGRST303" || body?.message === "JWT issued at future";

    if (isFutureJwt && !hasRetried) {
      const { accessToken } = await recoverAccessToken();
      if (accessToken) {
        requestHeaders.set("authorization", `Bearer ${accessToken}`);
        return fetchWithAuthRecoveryInternal(input, { ...init, headers: requestHeaders }, true);
      }
    }
  }

  if (isAuthTokenRequest && response.ok) {
    refreshFailureHandled = false;
    refreshBlockedUntil = 0;
  }

  return response;
};

const fetchWithAuthRecovery: typeof fetch = (input, init) =>
  fetchWithAuthRecoveryInternal(input, init);

export const supabase = (authClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithAuthRecovery },
}));