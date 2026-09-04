import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "@/lib/capture/http";

// Autorização compartilhada pelos webhooks (compra e Vetor B): o mesmo
// `webhook_token` da tela Configurações → Geral, aceito no header
// `x-webhook-token` ou em `?token=`, comparado em tempo constante.

export type WebhookAuth =
  | { ok: true; currency: string | null }
  | { ok: false; response: Response };

function tokenMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function authorizeWebhook(
  admin: SupabaseClient,
  req: Request,
): Promise<WebhookAuth> {
  const url = new URL(req.url);
  const incoming =
    req.headers.get("x-webhook-token") ?? url.searchParams.get("token") ?? "";

  const { data: settings } = await admin
    .from("settings")
    .select("webhook_token_enc, currency")
    .eq("id", 1)
    .single();

  const row = settings as {
    webhook_token_enc: string | null;
    currency: string | null;
  } | null;

  if (!row?.webhook_token_enc) {
    return {
      ok: false,
      response: jsonResponse({ error: "webhook_not_configured" }, 503),
    };
  }

  const { data: expected } = await admin.rpc("decrypt_secret", {
    ciphertext: row.webhook_token_enc,
  });
  if (!expected || !incoming || !tokenMatches(incoming, expected as string)) {
    return { ok: false, response: jsonResponse({ error: "unauthorized" }, 401) };
  }

  return { ok: true, currency: row.currency ?? null };
}
