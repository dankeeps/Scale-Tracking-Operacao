import { jsonResponse, notConfiguredResponse } from "@/lib/capture/http";
import {
  alreadySent,
  getOutboundConfig,
  sendOutbound,
  spHourSlot,
} from "@/lib/outbound/send";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Envio agendado das métricas por anúncio para o sistema do cliente.
 *
 * O cron da Vercel (`vercel.json`) bate aqui de hora em hora; a rota decide se é
 * hora de enviar: a hora cheia de São Paulo precisa estar entre os horários
 * escolhidos em Configurações → Webhook de saída, e aquele horário não pode ter
 * enviado hoje (`outbound_runs`). Fora disso, responde `skipped`.
 *
 * Autorização: a Vercel manda `Authorization: Bearer $CRON_SECRET` quando a env
 * existe (recomendado). Sem ela, aceitamos só o cabeçalho `x-vercel-cron`, que a
 * plataforma injeta e não deixa chegar de fora.
 */
export async function GET(req: Request) {
  const notReady = notConfiguredResponse();
  if (notReady) return notReady;

  const secret = process.env.CRON_SECRET?.trim();
  const authorized = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : req.headers.get("x-vercel-cron") !== null;
  if (!authorized) return jsonResponse({ error: "unauthorized" }, 401);

  const admin = createAdminClient();
  const slot = spHourSlot();
  const cfg = await getOutboundConfig(admin);

  if (!cfg.enabled) return jsonResponse({ ok: true, slot, skipped: "desligado" });
  if (!cfg.url) return jsonResponse({ ok: true, slot, skipped: "sem_url" });
  if (!cfg.times.includes(slot)) {
    return jsonResponse({ ok: true, slot, skipped: "fora_do_horario" });
  }
  if (await alreadySent(admin, slot)) {
    return jsonResponse({ ok: true, slot, skipped: "ja_enviou" });
  }

  const res = await sendOutbound(admin, slot);
  return jsonResponse(res, res.ok ? 200 : 502);
}
