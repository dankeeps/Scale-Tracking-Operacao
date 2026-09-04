import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OUTBOUND_TIMEOUT_MS } from "@/lib/constants";
import { buildOutboundPayload } from "@/lib/outbound/payload";
import { parseRange } from "@/lib/dashboard/range";
import { spToday } from "@/lib/webhook/vetor-b";

// Webhook de SAÍDA: publica as métricas por anúncio na URL cadastrada em
// Configurações → Envio de dados. O cron da Vercel bate de hora em hora e chama
// isto quando a hora cheia (São Paulo) é um dos horários escolhidos.

export interface OutboundConfig {
  enabled: boolean;
  url: string;
  header: string;
  times: string[];
  secretMask: string | null;
}

const SP_HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  hour12: false,
});

/** Hora cheia atual em São Paulo, no formato dos horários salvos ("14:00"). */
export function spHourSlot(now: Date = new Date()): string {
  return `${SP_HOUR_FMT.format(now)}:00`;
}

export const DEFAULT_OUTBOUND_HEADER = "x-webhook-token";
export const DEFAULT_OUTBOUND_TIMES = ["06:00", "12:00", "20:00"];

/** Lê a configuração com o cliente do painel (RLS + privilégio de coluna). */
export async function getOutboundConfig(
  db: SupabaseClient,
): Promise<OutboundConfig> {
  const { data } = await db
    .from("settings")
    .select(
      "outbound_enabled, outbound_url, outbound_header, outbound_times, outbound_secret_mask",
    )
    .eq("id", 1)
    .single();
  const r = data as {
    outbound_enabled: boolean | null;
    outbound_url: string | null;
    outbound_header: string | null;
    outbound_times: string[] | null;
    outbound_secret_mask: string | null;
  } | null;
  return {
    enabled: r?.outbound_enabled ?? false,
    url: r?.outbound_url ?? "",
    header: r?.outbound_header ?? DEFAULT_OUTBOUND_HEADER,
    times: r?.outbound_times?.length ? r.outbound_times : DEFAULT_OUTBOUND_TIMES,
    secretMask: r?.outbound_secret_mask ?? null,
  };
}

export interface OutboundRun {
  slot: string;
  ok: boolean;
  http_status: number | null;
  ads_count: number | null;
  message: string | null;
  created_at: string;
}

/** Últimos envios (painel). */
export async function getOutboundRuns(
  db: SupabaseClient,
  limit = 10,
): Promise<OutboundRun[]> {
  const { data } = await db
    .from("outbound_runs")
    .select("slot, ok, http_status, ads_count, message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as OutboundRun[];
}

export interface SendResult {
  ok: boolean;
  slot: string;
  status?: number;
  ads?: number;
  message?: string;
}

/**
 * Monta o payload do dia e faz o POST na URL cadastrada. `slot` é o horário
 * configurado ("12:00") ou "manual" quando disparado pelo botão do painel.
 * Nunca lança: falha vira `ok:false` + mensagem, que fica no histórico.
 */
export async function sendOutbound(
  admin: SupabaseClient,
  slot: string,
): Promise<SendResult> {
  const { data } = await admin
    .from("settings")
    .select("outbound_url, outbound_header, outbound_secret_enc")
    .eq("id", 1)
    .single();
  const cfg = data as {
    outbound_url: string | null;
    outbound_header: string | null;
    outbound_secret_enc: string | null;
  } | null;

  const url = cfg?.outbound_url?.trim();
  if (!url) {
    return log(admin, { ok: false, slot, message: "URL de destino não configurada." });
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg?.outbound_secret_enc) {
    const { data: secret } = await admin.rpc("decrypt_secret", {
      ciphertext: cfg.outbound_secret_enc,
    });
    if (secret) {
      headers[cfg.outbound_header?.trim() || DEFAULT_OUTBOUND_HEADER] =
        secret as string;
    }
  }

  let status: number | undefined;
  try {
    // Sempre o dia corrente (São Paulo): três envios por dia atualizam o mesmo
    // dia, do jeito que o destino espera receber ("snapshot" do dia).
    const payload = await buildOutboundPayload(admin, parseRange("today"));
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) {
      return log(admin, {
        ok: false,
        slot,
        status,
        ads: payload.ads.length,
        message: `O destino respondeu ${res.status}.`,
      });
    }
    return log(admin, { ok: true, slot, status, ads: payload.ads.length });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "TimeoutError"
        ? "O destino não respondeu a tempo."
        : e instanceof Error
          ? e.message
          : "Falha no envio.";
    return log(admin, { ok: false, slot, status, message: msg });
  }
}

/** Registra o envio (uma linha por dia + horário) e devolve o resultado. */
async function log(
  admin: SupabaseClient,
  r: SendResult,
): Promise<SendResult> {
  const { error } = await admin.from("outbound_runs").upsert(
    {
      run_date: spToday(),
      slot: r.slot,
      ok: r.ok,
      http_status: r.status ?? null,
      ads_count: r.ads ?? null,
      message: r.message ?? null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "run_date,slot" },
  );
  if (error) console.error("[outbound] log:", error.message);
  return r;
}

/** Já enviou com sucesso hoje neste horário? (o cron bate de hora em hora) */
export async function alreadySent(
  admin: SupabaseClient,
  slot: string,
): Promise<boolean> {
  const { data } = await admin
    .from("outbound_runs")
    .select("ok")
    .eq("run_date", spToday())
    .eq("slot", slot)
    .maybeSingle();
  return (data as { ok: boolean } | null)?.ok === true;
}
