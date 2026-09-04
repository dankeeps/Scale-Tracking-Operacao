import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FunnelSlot, isFunnelSlot } from "@/lib/funnel";
import { productKey } from "@/lib/products";

// Lista de produtos derivada de purchases + o flag send_meta (product_settings).
// Roda com o cliente AUTENTICADO (RLS) no server component de Configurações.

export interface ProductRow {
  key: string;
  name: string;
  sales: number;
  revenue: number;
  send_meta: boolean;
  /** Etapa do funil que este produto ocupa (null = fora do funil). */
  funnel_slot: FunnelSlot | null;
}

const CAP = 5000;

function isRefund(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return ["refund", "chargeback", "cancel", "dispute", "reembols"].some((d) =>
    s.includes(d),
  );
}

export async function getProducts(
  db: SupabaseClient,
): Promise<ProductRow[]> {
  const [{ data: purchases }, { data: settings }] = await Promise.all([
    db
      .from("purchases")
      .select("product_id, product_name, value, status")
      .limit(CAP),
    db.from("product_settings").select("product_key, send_meta, funnel_slot"),
  ]);

  const flag = new Map<string, boolean>(
    (settings ?? []).map((s) => [s.product_key as string, s.send_meta as boolean]),
  );
  const slot = new Map<string, FunnelSlot>();
  for (const s of settings ?? []) {
    if (isFunnelSlot(s.funnel_slot)) slot.set(s.product_key as string, s.funnel_slot);
  }

  const map = new Map<string, { name: string; sales: number; revenue: number }>();
  for (const p of purchases ?? []) {
    const key = productKey(p.product_id, p.product_name);
    if (!key) continue;
    const cur = map.get(key) ?? {
      name: p.product_name ?? key,
      sales: 0,
      revenue: 0,
    };
    cur.sales += 1;
    if (!isRefund(p.status) && p.value != null) cur.revenue += Number(p.value);
    map.set(key, cur);
  }

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      sales: v.sales,
      revenue: v.revenue,
      send_meta: flag.get(key) ?? true, // default LIGADO
      funnel_slot: slot.get(key) ?? null,
    }))
    .sort((a, b) => b.sales - a.sales);
}
