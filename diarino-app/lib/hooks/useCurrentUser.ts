import { useSyncExternalStore } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "../supabase";

type AuthSnapshot = { user: User | null; loading: boolean };
export type AuthStateListener = () => void;

let snapshot: AuthSnapshot = { user: null, loading: true };
let initialized = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getAuthSnapshot() {
  return snapshot;
}

export function subscribeAuthState(listener: AuthStateListener) {
  initializeAuthState();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function initializeAuthState() {
  if (initialized) return;
  initialized = true;

  supabase.auth.getSession()
    .then(({ data }) => {
      snapshot = { user: data.session?.user ?? null, loading: false };
      emit();
    })
    .catch((err: unknown) => {
      console.warn("Failed to fetch current user:", err);
      snapshot = { user: null, loading: false };
      emit();
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    snapshot = { user: session?.user ?? null, loading: false };
    emit();
  });
}

export function useCurrentUser() {
  const authState = useSyncExternalStore(
    subscribeAuthState,
    () => snapshot,
    () => snapshot,
  );

  const displayName =
    (authState.user?.user_metadata?.full_name as string) || (authState.user?.user_metadata?.name as string) || authState.user?.email || "مستخدم";

  return { user: authState.user, displayName, loading: authState.loading };
}
