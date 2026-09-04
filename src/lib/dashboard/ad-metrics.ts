import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import type { DateRange } from "@/lib/dashboard/range";
import { VETOR_B_METRICS, type VetorBMetric } from "@/lib/webhook/vetor-b";

// Métricas de criativo/VSL vindas do Vetor B (tabela `ad_metrics`, um snapshot
// por anúncio por dia). Aqui elas são agregadas no período escolhido e
// devolvidas num mapa por NOME do anúncio em minúsculo — a mesma chave que a
// receita por UTM usa, então a página de Campanhas casa os dois do mesmo jeito.

const CAP = 20_000;

/** Somam no período; o resto é média dos dias com dado. */
const SUM_FIELDS = new Set<VetorBMetric>([
  "faturamento",
  "faturamento_backend",
  "investimento",
]);

export type AdMetrics = Record<VetorBMetric, number | null> & {
  adName: string;
  /** Dias com snapshot dentro do período (contexto para as médias). */
  days: number;
  /** Último dia com dado (YYYY-MM-DD). */
  lastDate: string;
};

const SP_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const spDay = (iso: string): string => SP_DAY_FMT.format(new Date(iso));

const loadAdMetrics = cache(
  async (db: SupabaseClient, range: DateRange): Promise<AdMetricRow[]> => {
    // `metric_date` é o dia do negócio (SP); o range chega em instantes, e o
    // `to` é EXCLUSIVO — daí o último dia ser o de (to - 1ms).
    const until = spDay(new Date(new Date(range.to).getTime() - 1).toISOString());
    let q = db
      .from("ad_metrics")
      .select(
        `ad_name, match_key, metric_date, ${VETOR_B_METRICS.join(", ")}`,
      )
      .lte("metric_date", until)
      .order("metric_date", { ascending: true })
      .limit(CAP);
    if (range.from) q = q.gte("metric_date", spDay(range.from));
    const { data, error } = await q;
    if (error) {
      console.error("[ad-metrics] erro:", error.message);
      return [];
    }
    return (data ?? []) as unknown as AdMetricRow[];
  },
);

type AdMetricRow = Record<VetorBMetric, number | string | null> & {
  ad_name: string;
  match_key: string;
  metric_date: string;
};

/** Métricas do Vetor B por anúncio (chave: nome em minúsculo). */
export async function getAdMetricsMap(
  db: SupabaseClient,
  range: DateRange,
): Promise<Map<string, AdMetrics>> {
  const rows = await loadAdMetrics(db, range);
  return aggregateAdMetrics(rows);
}

/**
 * Junta os snapshots diários de cada anúncio: dinheiro soma, taxa/custo vira
 * média dos dias em que veio número, e o ROAS é RECALCULADO a partir das somas
 * (média de ROAS diário mentiria em dias de investimento desigual).
 */
export function aggregateAdMetrics(
  rows: AdMetricRow[],
): Map<string, AdMetrics> {
  const acc = new Map<
    string,
    {
      adName: string;
      lastDate: string;
      days: number;
      sums: Record<string, number>;
      counts: Record<string, number>;
    }
  >();

  for (const r of rows) {
    const key = r.match_key;
    const cur = acc.get(key) ?? {
      adName: r.ad_name,
      lastDate: r.metric_date,
      days: 0,
      sums: {},
      counts: {},
    };
    cur.days += 1;
    if (r.metric_date >= cur.lastDate) {
      cur.lastDate = r.metric_date;
      cur.adName = r.ad_name; // o nome mais recente manda
    }
    for (const f of VETOR_B_METRICS) {
      const v = r[f];
      if (v === null || v === undefined) continue;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      cur.sums[f] = (cur.sums[f] ?? 0) + n;
      cur.counts[f] = (cur.counts[f] ?? 0) + 1;
    }
    acc.set(key, cur);
  }

  const out = new Map<string, AdMetrics>();
  for (const [key, a] of acc) {
    const m = { adName: a.adName, days: a.days, lastDate: a.lastDate } as AdMetrics;
    for (const f of VETOR_B_METRICS) {
      const n = a.counts[f] ?? 0;
      if (n === 0) {
        m[f] = null;
        continue;
      }
      m[f] = SUM_FIELDS.has(f)
        ? round(a.sums[f])
        : round(a.sums[f] / n);
    }
    const inv = m.investimento;
    const fat = m.faturamento;
    if (inv != null && inv > 0 && fat != null) m.roas = round(fat / inv);
    out.set(key, m);
  }
  return out;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
