import { getClientIp } from "@/lib/capture/geo";
import { jsonResponse, notConfiguredResponse } from "@/lib/capture/http";
import { consumeRateLimit } from "@/lib/capture/ratelimit";
import { RATE_LIMITS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeWebhook } from "@/lib/webhook/auth";
import { ingestVetorB } from "@/lib/webhook/vetor-b-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do Vetor B — métricas de criativo/VSL por anúncio (eles empurram).
 *
 * Corpo: `{ "data": "YYYY-MM-DD" (opcional), "ads": [{ "nome": …, … }] }`.
 * Cada item é o snapshot do dia daquele anúncio: reenviar o mesmo dia substitui
 * a linha, então dá para mandar de hora em hora sem duplicar. O cruzamento com
 * campanha/conjunto/anúncio é pelo NOME do anúncio — o mesmo valor que chega no
 * `utm_content`. Quem preferir que o sistema BUSQUE os dados usa a busca
 * agendada em Configurações → Vetor B (`/api/cron/vetor-b`).
 */
export async function POST(req: Request) {
  const notReady = notConfiguredResponse();
  if (notReady) return notReady;

  const ip = getClientIp(req.headers);
  const allowed = await consumeRateLimit(
    "webhook",
    ip ?? "unknown",
    RATE_LIMITS.webhook.max,
    RATE_LIMITS.webhook.windowSeconds,
  );
  if (!allowed) return jsonResponse({ error: "rate_limited" }, 429);

  const admin = createAdminClient();

  const auth = await authorizeWebhook(admin, req);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const res = await ingestVetorB(admin, raw);
  if (!res.ok) {
    return jsonResponse(
      { error: res.error, issues: res.issues },
      res.error === "server_error" ? 500 : 400,
    );
  }

  return jsonResponse({
    ok: true,
    data: res.metricDate,
    ads_recebidos: res.received,
    ads_gravados: res.saved,
  });
}
