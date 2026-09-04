import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { regionsForProvince } from "../../data/locations";

// ↔ region/compound autocomplete on the search page (and reused on the
// publish form's location field) — combines the static
// REGIONS_BY_PROVINCE baseline with names other users have actually
// typed and saved via useRememberRegion below.
export function useKnownRegions(province: string | undefined) {
  return useQuery({
    queryKey: ["knownRegions", province],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from("known_regions").select("name").eq("province", province!);
      if (error) throw error;
      return (data ?? []).map((r: { name: string }) => r.name);
    },
    enabled: !!province,
    staleTime: 60_000,
  });
}

export function useRegionSuggestions(province: string | undefined, query: string) {
  const { data: knownRegions = [] } = useKnownRegions(province);
  return useMemo(() => {
    const staticList = regionsForProvince(province);
    const combined = Array.from(new Set([...staticList, ...knownRegions]));
    const q = query.trim();
    if (!q) return combined.slice(0, 8);
    return combined.filter((r) => r.includes(q)).slice(0, 8);
  }, [province, knownRegions, query]);
}

// ↔ "احتفظ باسم المنطقة أو الكمبوند" — called when someone searches (or
// publishes) with a region name that isn't already in the static list or
// known_regions, so it becomes a suggestion for everyone next time.
export function useRememberRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ province, name }: { province: string; name: string }) => {
      const trimmed = name.trim();
      if (!province || !trimmed) return;
      const alreadyKnown = [...regionsForProvince(province)].includes(trimmed);
      if (alreadyKnown) return;
      const { error } = await supabase.from("known_regions").insert({ province, name: trimmed }).select().maybeSingle();
      // A duplicate (someone else already saved the exact same name) is
      // expected and fine — the unique constraint just no-ops it.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["knownRegions", variables.province] });
    },
  });
}
