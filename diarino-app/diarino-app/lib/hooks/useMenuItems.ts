import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";

export type MenuItem = {
  id: string;
  title: string;
  subtitle: string | null;
  color: string;
  iconKey: string;
  // 'tall' pairs with the next two 'half' items (search-style hero card);
  // 'round' pairs with the following 'half' item as a small square button.
  size: "full" | "half" | "tall" | "round";
  actionType: "whatsapp" | "route" | "url";
  actionValue: string;
  sortOrder: number;
  active: boolean;
  ctaLabel: string | null;
};

type Row = {
  id: string;
  title: string;
  subtitle: string | null;
  color: string;
  icon_key: string;
  size: "full" | "half" | "tall" | "round";
  action_type: "whatsapp" | "route" | "url";
  action_value: string;
  sort_order: number;
  active: boolean;
  cta_label: string | null;
};

type MenuItemInsert = {
  title: string;
  subtitle: string | null;
  color: string;
  icon_key: string;
  size: "full" | "half" | "tall" | "round";
  action_type: "whatsapp" | "route" | "url";
  action_value: string;
  sort_order: number;
  cta_label: string | null;
};

type MenuItemUpdate = Partial<MenuItemInsert> & {
  active?: boolean;
};

function rowToItem(r: Row): MenuItem {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    color: r.color,
    iconKey: r.icon_key,
    size: r.size,
    actionType: r.action_type,
    actionValue: r.action_value,
    sortOrder: r.sort_order,
    active: r.active,
    ctaLabel: r.cta_label ?? null,
  };
}

// ↔ the menu page's card list — was hardcoded JSX before, now driven
// entirely by public.menu_items.
export function useActiveMenuItems() {
  const { user, loading } = useCurrentUser();

  return useQuery({
    queryKey: ["menuItems", "active", user?.id ?? "anonymous"],
    queryFn: async (): Promise<MenuItem[]> => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, title, subtitle, color, icon_key, size, action_type, action_value, sort_order, active, cta_label, created_at")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Row[]).map(rowToItem);
    },
    enabled: !loading && !!user,
    staleTime: 30_000,
  });
}

// ↔ the admin "أيقونات القائمة" tab — every item, active or not.
export function useAllMenuItems() {
  return useQuery({
    queryKey: ["menuItems", "all"],
    queryFn: async (): Promise<MenuItem[]> => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, title, subtitle, color, icon_key, size, action_type, action_value, sort_order, active, cta_label, created_at")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Row[]).map(rowToItem);
    },
    staleTime: 10_000,
  });
}

export function useMenuItemMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["menuItems"] });

  const create = useMutation({
    mutationFn: async (input: Omit<MenuItem, "id" | "active"> & { sortOrder?: number }) => {
      const payload: MenuItemInsert = {
        title: input.title,
        subtitle: input.subtitle,
        color: input.color,
        icon_key: input.iconKey,
        size: input.size,
        action_type: input.actionType,
        action_value: input.actionValue,
        sort_order: input.sortOrder ?? 0,
        cta_label: input.ctaLabel ?? null,
      };

      const { error } = await supabase.from("menu_items").insert(payload);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Omit<MenuItem, "id">> }) => {
      const row: MenuItemUpdate = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.subtitle !== undefined) row.subtitle = patch.subtitle;
      if (patch.color !== undefined) row.color = patch.color;
      if (patch.iconKey !== undefined) row.icon_key = patch.iconKey;
      if (patch.size !== undefined) row.size = patch.size;
      if (patch.actionType !== undefined) row.action_type = patch.actionType;
      if (patch.actionValue !== undefined) row.action_value = patch.actionValue;
      if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
      if (patch.active !== undefined) row.active = patch.active;
      if (patch.ctaLabel !== undefined) row.cta_label = patch.ctaLabel;

      const { error } = await supabase.from("menu_items").update(row).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("menu_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // ↔ "إعادة ترتيب الأيقونات" — swaps two items' sort_order.
  const reorder = useMutation({
    mutationFn: async ({ a, b }: { a: { id: string; sortOrder: number }; b: { id: string; sortOrder: number } }) => {
      const { error: e1 } = await supabase.from("menu_items").update({ sort_order: b.sortOrder }).eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("menu_items").update({ sort_order: a.sortOrder }).eq("id", b.id);
      if (e2) throw e2;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove, reorder };
}