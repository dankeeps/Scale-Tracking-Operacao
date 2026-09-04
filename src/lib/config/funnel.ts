import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FunnelSlot, isFunnelSlot } from "@/lib/funnel";

// Produto de cada etapa do funil (Configurações → Funil). Usado pelo painel de
// Campanhas para quebrar faturamento/ROAS por etapa.

export interface FunnelAssignment {
  slot: FunnelSlot;
  productKey: string;
  productName: string;
}

export async function getFunnelAssignments(
  db: SupabaseClient,
): Promise<FunnelAssignment[]> {
  const { data, error } = await db
    .from("product_settings")
    .select("product_key, product_name, funnel_slot")
    .not("funnel_slot", "is", null);
  if (error) {
    console.error("[funnel] erro:", error.message);
    return [];
  }
  const out: FunnelAssignment[] = [];
  for (const r of data ?? []) {
    if (!isFunnelSlot(r.funnel_slot)) continue;
    out.push({
      slot: r.funnel_slot,
      productKey: r.product_key as string,
      productName: (r.product_name as string | null) ?? (r.product_key as string),
    });
  }
  return out;
}
