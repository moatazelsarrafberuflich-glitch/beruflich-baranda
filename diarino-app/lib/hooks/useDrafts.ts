import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";
import { Json } from "../../src/types/supabase";

export type DraftType = "listing" | "request";
export type Draft = { id: string; draftType: DraftType; title: string | null; data: Record<string, unknown>; updatedAt: string };

type DraftRow = { id: string; draft_type: DraftType; title: string | null; data: Record<string, unknown>; updated_at: string };

export function useDrafts(draftType: DraftType) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["drafts", draftType, user?.id],
    queryFn: async (): Promise<Draft[]> => {
      const { data, error } = await supabase
        .from("drafts")
        .select("id, draft_type, title, data, updated_at")
        .eq("user_id", user!.id)
        .eq("draft_type", draftType)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return ((data as unknown as DraftRow[]) ?? []).map((r) => ({
        id: r.id,
        draftType: r.draft_type,
        title: r.title,
        data: r.data,
        updatedAt: r.updated_at,
      }));
    },
    enabled: !!user,
    staleTime: 10_000,
  });
}

export function useDraftById(id: string | undefined) {
  return useQuery({
    queryKey: ["draft", id],
    queryFn: async (): Promise<Draft | null> => {
      const { data, error } = await supabase
        .from("drafts")
        .select("id, draft_type, title, data, updated_at")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as unknown as DraftRow;
      return { id: r.id, draftType: r.draft_type, title: r.title, data: r.data, updatedAt: r.updated_at };
    },
    enabled: !!id,
  });
}

export function useDraftMutations() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["drafts"] });

  const save = useMutation({
    mutationFn: async (input: { id?: string; draftType: DraftType; title: string | null; data: Record<string, unknown> }) => {
      if (!user) throw new Error("Not signed in");
      if (input.id) {
        const { error } = await supabase
          .from("drafts")
          .update({
            title: input.title,
            // ↔ #3: Draft.data هى Record<string, unknown> (شكلها مش معروف
            // مقدمًا)، وعمود قاعدة البيانات Json (نوع مُعرَّف بشكل متكرر) —
            // TS مش قادر يتأكد بنيويًا إن unknown اعتباطي بيطابق Json، فكان
            // فيه as any على الكائن كله (بما فيه title/updated_at اللي
            // TS كان قادر يتأكد منهم عادي). التحويل بقى مضبوط على حقل data
            // بس (as unknown as Json)، وباقى الحقول فضلت تحت الفحص النوعى
            // الكامل زي ما المفروض.
            data: input.data as unknown as Json,
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from("drafts")
        .insert({
          user_id: user.id,
          draft_type: input.draftType,
          title: input.title,
          data: input.data as unknown as Json,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("drafts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { save, remove };
}