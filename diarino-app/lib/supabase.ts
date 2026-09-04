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

const fetchWithAuthRecovery: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const requestUrl = typeof input === "string"
    ? input
    : typeof Request !== "undefined" && input instanceof Request
      ? input.url
      : String(input);
  const isRefreshRequest = requestUrl.includes("/auth/v1/token?grant_type=refresh_token");

  // A rejected refresh token must not be retried forever by the auth timer.
  // Clear only the local session; the next explicit login can establish a new one.
  if (isRefreshRequest && (response.status === 400 || response.status === 401)) {
    if (!refreshFailureHandled) {
      refreshFailureHandled = true;
      void authClient?.auth.signOut({ scope: "local" });
    }
  } else if (isRefreshRequest && response.ok) {
    refreshFailureHandled = false;
  }

  return response;
};

export const supabase = (authClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithAuthRecovery },
}));