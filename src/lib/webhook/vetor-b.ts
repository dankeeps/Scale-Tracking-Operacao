import { z } from "zod";
import { parseMoney } from "@/lib/webhook/parse";

// Integração Vetor B: métricas de criativo/VSL por anúncio, recebidas por
// webhook. Cada envio é o SNAPSHOT DE UM DIA (o de hoje, salvo `data` no corpo)
// — reenviar o mesmo dia substitui a linha, então a plataforma pode mandar de
// hora em hora sem duplicar nada.

/** Campos numéricos aceitos por anúncio, na ordem em que aparecem no painel. */
export const VETOR_B_METRICS = [
  "hook_rate",
  "hold_rate",
  "retencao_1min",
  "retencao_pitch",
  "conversao_vsl",
  "conv_checkout",
  "cpm",
  "cpc",
  "custo_ic",
  "faturamento",
  "faturamento_backend",
  "investimento",
  "roas",
] as const;

export type VetorBMetric = (typeof VETOR_B_METRICS)[number];

// Tolerante de propósito: aceita número ou string ("32,5", "1.234,56", "R$ 97").
// Valor ausente/ilegível vira null — a coluna fica vazia em vez de derrubar o lote.
const num = z.unknown().transform((v) => parseMoney(v));

const adSchema = z.object({
  nome: z.string().trim().min(1).max(256),
  ...Object.fromEntries(VETOR_B_METRICS.map((k) => [k, num.optional()])),
});

export const vetorBSchema = z.object({
  /** Dia dos números (YYYY-MM-DD). Ausente → dia de hoje em São Paulo. */
  data: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ads: z.array(adSchema).min(1).max(500),
});

export type VetorBInput = z.infer<typeof vetorBSchema>;

/**
 * Chave de cruzamento com o Meta/UTM: nome do anúncio em minúsculo, sem espaços
 * nas pontas. É a mesma normalização usada pela receita por UTM (`utm_content`),
 * então "Criativo B — VSL curta" casa com o anúncio de mesmo nome.
 */
export function adMatchKey(name: string): string {
  return name.trim().toLowerCase();
}

const SP_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dia civil de São Paulo (YYYY-MM-DD) — o mesmo corte de "Hoje" do painel. */
export function spToday(now: Date = new Date()): string {
  return SP_DAY_FMT.format(now);
}

export interface AdMetricRow {
  source: string;
  ad_name: string;
  match_key: string;
  metric_date: string;
  raw: unknown;
  [metric: string]: unknown;
}

/** Monta a linha de `ad_metrics` a partir de um item já validado. */
export function toAdMetricRow(
  ad: z.infer<typeof adSchema>,
  metricDate: string,
  raw: unknown,
): AdMetricRow {
  const row: AdMetricRow = {
    source: "vetor_b",
    ad_name: ad.nome.trim(),
    match_key: adMatchKey(ad.nome),
    metric_date: metricDate,
    raw: (raw ?? null) as Record<string, unknown> | null,
  };
  for (const k of VETOR_B_METRICS) {
    row[k] = (ad as Record<string, unknown>)[k] ?? null;
  }
  return row;
}
