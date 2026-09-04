import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spToday, toAdMetricRow, vetorBSchema } from "@/lib/webhook/vetor-b";

// Gravação das métricas do Vetor B. Vale para as DUAS direções: o POST que eles
// mandam (`/api/webhook/vetor-b`) e a busca agendada, em que somos nós a chamar
// a URL deles (`/api/cron/vetor-b`). O formato do corpo é o mesmo.

export type IngestResult =
  | { ok: true; metricDate: string; received: number; saved: number }
  | { ok: false; error: string; issues?: { path: string; message: string }[] };

export async function ingestVetorB(
  admin: SupabaseClient,
  raw: unknown,
): Promise<IngestResult> {
  const parsed = vetorBSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_payload",
      // Só caminho e mensagem — nada do corpo volta pro remetente.
      issues: parsed.error.issues.slice(0, 10).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }

  const metricDate = parsed.data.data ?? spToday();
  const rawAds = Array.isArray((raw as { ads?: unknown[] })?.ads)
    ? ((raw as { ads: unknown[] }).ads as unknown[])
    : [];

  // Um anúncio repetido no mesmo lote colidiria no upsert (mesma chave): fica o
  // último, que é o mais recente.
  const byKey = new Map<string, ReturnType<typeof toAdMetricRow>>();
  parsed.data.ads.forEach((ad, i) => {
    const row = toAdMetricRow(ad, metricDate, rawAds[i] ?? null);
    byKey.set(row.match_key, row);
  });
  const rows = [...byKey.values()];

  const { error } = await admin
    .from("ad_metrics")
    .upsert(rows, { onConflict: "source,match_key,metric_date" });

  if (error) {
    console.error("[vetor-b] upsert error:", error.message);
    return { ok: false, error: "server_error" };
  }

  return {
    ok: true,
    metricDate,
    received: parsed.data.ads.length,
    saved: rows.length,
  };
}
