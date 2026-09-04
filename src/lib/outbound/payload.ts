import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdMetricsMap } from "@/lib/dashboard/ad-metrics";
import {
  getCheckoutsByAd,
  getFunnelRevenueUtmMaps,
  getRevenueUtmMaps,
} from "@/lib/dashboard/queries";
import type { DateRange } from "@/lib/dashboard/range";
import { listAdAccounts, rangeToSinceUntil } from "@/lib/dashboard/spend";
import { getFunnelAssignments } from "@/lib/config/funnel";
import { getInsights } from "@/lib/dispatch/meta-ads";
import { spToday } from "@/lib/webhook/vetor-b";

// Payload que ESTE sistema publica no webhook de saída: um item por anúncio,
// no mesmo formato que o Vetor B usa. Números de mídia vêm do Meta Ads,
// faturamento/ROAS do webhook de compra (por UTM), e as métricas de VSL são as
// que o Vetor B mandou para cá — o que faltar vai como `null`, nunca inventado.

/**
 * Um anúncio no payload. Só entram os campos que temos: o destino ignora campos
 * ausentes, e mandar `null` correria o risco de virar zero do outro lado.
 */
export interface OutboundAd {
  nome: string;
  hook_rate?: number;
  hold_rate?: number;
  cpm?: number;
  conv_checkout?: number;
  custo_ic?: number;
  cpc?: number;
  retencao_1min?: number;
  retencao_pitch?: number;
  conversao_vsl?: number;
  faturamento?: number;
  investimento?: number;
  roas?: number;
  faturamento_backend?: number;
}

type NumericField = Exclude<keyof OutboundAd, "nome">;

export interface OutboundPayload {
  data: string; // dia civil de São Paulo (YYYY-MM-DD)
  ads: OutboundAd[];
}

const money = (n: number): number => Math.round(n * 100) / 100;
const rate = (n: number): number => Math.round(n * 10) / 10;

/** Monta o payload do período (por padrão, o dia de hoje em São Paulo). */
export async function buildOutboundPayload(
  admin: SupabaseClient,
  range: DateRange,
): Promise<OutboundPayload> {
  const accounts = await listAdAccounts(admin);
  const { since, until } = rangeToSinceUntil(range);

  const [insights, rev, funnel, vetor, checkouts] = await Promise.all([
    Promise.all(
      accounts.map((a) => getInsights(a.ad_account_id, a.token, since, until)),
    ),
    getRevenueUtmMaps(admin, range),
    getFunnelAssignments(admin),
    getAdMetricsMap(admin, range),
    getCheckoutsByAd(admin, range),
  ]);

  const slotOfProduct = new Map(funnel.map((f) => [f.productKey, f.slot as string]));
  const slotRev = await getFunnelRevenueUtmMaps(admin, range, slotOfProduct);

  // Mídia por anúncio (um anúncio pode aparecer em várias linhas de insights).
  interface Media {
    name: string;
    spend: number;
    clicks: number;
    impressions: number;
  }
  const media = new Map<string, Media>();
  for (const r of insights) {
    for (const row of r.rows) {
      const key = row.ad_name.toLowerCase();
      const cur = media.get(key) ?? {
        name: row.ad_name,
        spend: 0,
        clicks: 0,
        impressions: 0,
      };
      cur.spend += row.spend;
      cur.clicks += row.clicks;
      cur.impressions += row.impressions ?? 0;
      media.set(key, cur);
    }
  }

  // Anúncio que só tem métrica do Vetor B (sem gasto no período) também entra.
  for (const [key, m] of vetor) {
    if (!media.has(key)) {
      media.set(key, { name: m.adName, spend: 0, clicks: 0, impressions: 0 });
    }
  }

  const ads: OutboundAd[] = [];
  for (const [key, m] of media) {
    const agg = rev.ads.get(key) ?? { revenue: 0, orders: 0 };
    const bySlot = slotRev.ads.get(key) ?? {};
    // Back-end = tudo que não é o produto principal (upsells e webinars).
    const backend = Object.entries(bySlot).reduce(
      (s, [slot, v]) => (slot === "front" ? s : s + v.revenue),
      0,
    );
    const ics = checkouts.get(key) ?? 0;
    const vb = vetor.get(key) ?? null;

    const ad: OutboundAd = { nome: m.name };
    // `put` só grava o que existe — campo sem dado simplesmente não vai.
    const put = (k: NumericField, v: number | null | undefined) => {
      if (typeof v === "number" && Number.isFinite(v)) ad[k] = v;
    };
    put("hook_rate", vb?.hook_rate);
    put("hold_rate", vb?.hold_rate);
    put("cpm", m.impressions > 0 ? money((m.spend / m.impressions) * 1000) : null);
    put("conv_checkout", ics > 0 ? rate((agg.orders / ics) * 100) : null);
    put("custo_ic", ics > 0 ? money(m.spend / ics) : null);
    put("cpc", m.clicks > 0 ? money(m.spend / m.clicks) : null);
    put("retencao_1min", vb?.retencao_1min);
    put("retencao_pitch", vb?.retencao_pitch);
    put("conversao_vsl", vb?.conversao_vsl);
    put("faturamento", money(agg.revenue));
    put("investimento", money(m.spend));
    put("roas", m.spend > 0 ? money(agg.revenue / m.spend) : null);
    put("faturamento_backend", money(backend));
    ads.push(ad);
  }

  ads.sort((a, b) => (b.investimento ?? 0) - (a.investimento ?? 0));
  return { data: spToday(new Date(new Date(range.to).getTime() - 1)), ads };
}
