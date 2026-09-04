"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { AccountKind } from "@/lib/config/accounts";
import {
  GA4_MP_DEBUG_ENDPOINT,
  metaAdAccountUrl,
  metaCapiUrl,
  normalizeAdAccountId,
} from "@/lib/constants";
import { DEMO_WRITE_ERROR, IS_DEMO } from "@/lib/demo/mode";
import { type FunnelSlot, isFunnelSlot } from "@/lib/funnel";
import { sha256 } from "@/lib/hash";
import { maskSecret, sanitizeSecret } from "@/lib/mask";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseRange } from "@/lib/dashboard/range";
import { buildOutboundPayload } from "@/lib/outbound/payload";
import {
  DEFAULT_OUTBOUND_HEADER,
  DEFAULT_OUTBOUND_TIMES,
  sendOutbound,
} from "@/lib/outbound/send";
import { normalizeDomain } from "@/lib/webhook/domain";

const CONFIG_PATH = "/dashboard/config";

// Mapeamento kind → tabela/colunas (server-only).
const TABLES: Record<
  AccountKind,
  { table: string; idCol: string; encCol: string; maskCol: string }
> = {
  ga4: {
    table: "ga4_accounts",
    idCol: "measurement_id",
    encCol: "api_secret_enc",
    maskCol: "api_secret_mask",
  },
  pixel: {
    table: "meta_pixels",
    idCol: "pixel_id",
    encCol: "capi_token_enc",
    maskCol: "capi_token_mask",
  },
  adaccount: {
    table: "meta_ad_accounts",
    idCol: "ad_account_id",
    encCol: "ads_token_enc",
    maskCol: "ads_token_mask",
  },
};

export type ActionState = { ok?: true; error?: string } | null;
export type TestResult = { ok: boolean; message: string };

/** Garante que quem chama a action está autenticado (as actions escrevem via admin). */
async function requireUser() {
  // Sem Supabase não há usuário nem banco: o painel está em vitrine.
  if (IS_DEMO) throw new Error(DEMO_WRITE_ERROR);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return user;
}

/** Liga/desliga o envio do Purchase de um produto ao Meta (upsert por chave). */
export async function toggleProductMeta(
  productKey: string,
  productName: string | null,
  next: boolean,
) {
  await requireUser();
  const admin = createAdminClient();
  const { error } = await admin
    .from("product_settings")
    .upsert(
      { product_key: productKey, product_name: productName, send_meta: next },
      { onConflict: "product_key" },
    );
  if (error) throw new Error(error.message);
  revalidatePath(CONFIG_PATH);
}

/**
 * Define qual produto ocupa uma etapa do funil. Uma etapa tem no máximo um
 * produto: antes de gravar, limpa quem estava nela (índice único no banco).
 * `productKey` nulo apenas esvazia a etapa.
 */
export async function setFunnelSlot(
  slot: FunnelSlot,
  productKey: string | null,
  productName: string | null,
) {
  await requireUser();
  if (!isFunnelSlot(slot)) throw new Error("Etapa inválida.");
  const admin = createAdminClient();

  const { error: clearErr } = await admin
    .from("product_settings")
    .update({ funnel_slot: null })
    .eq("funnel_slot", slot);
  if (clearErr) throw new Error(clearErr.message);

  if (productKey) {
    const { error } = await admin
      .from("product_settings")
      .upsert(
        { product_key: productKey, product_name: productName, funnel_slot: slot },
        { onConflict: "product_key" },
      );
    if (error) throw new Error(error.message);
  }
  revalidatePath(CONFIG_PATH);
}

/** Cifra um segredo via RPC (só service_role executa). */
async function encrypt(admin: ReturnType<typeof createAdminClient>, plaintext: string) {
  const { data, error } = await admin.rpc("encrypt_secret", { plaintext });
  if (error) throw new Error(`Falha ao cifrar: ${error.message}`);
  return data as string;
}

async function decrypt(
  admin: ReturnType<typeof createAdminClient>,
  ciphertext: string,
) {
  const { data, error } = await admin.rpc("decrypt_secret", { ciphertext });
  if (error) throw new Error(`Falha ao decifrar: ${error.message}`);
  return data as string | null;
}

// ── Settings ─────────────────────────────────────────────────────────────────
export async function saveSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const admin = createAdminClient();

    const currency = String(formData.get("currency") ?? "BRL").trim() || "BRL";
    const testEventCode = sanitizeSecret(formData.get("test_event_code") as string);
    const webhookToken = sanitizeSecret(formData.get("webhook_token") as string);
    // Normaliza igual ao formulário: guardamos só o host (sem protocolo/caminho).
    const webhookDomain = normalizeDomain(
      formData.get("webhook_domain") as string,
    );

    const update: Record<string, unknown> = {
      currency,
      test_event_code: testEventCode || null,
      webhook_domain: webhookDomain || null,
    };
    if (webhookToken) {
      update.webhook_token_enc = await encrypt(admin, webhookToken);
      update.webhook_token_mask = maskSecret(webhookToken);
    }

    const { error } = await admin.from("settings").update(update).eq("id", 1);
    if (error) return { error: error.message };

    revalidatePath(CONFIG_PATH);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro inesperado." };
  }
}

// Horários aceitos: só hora cheia (o cron da Vercel bate de hora em hora).
const HOUR_RE = /^([01]\d|2[0-3]):00$/;

// ── Webhook de saída (envio das métricas para o sistema do cliente) ──────────
const outboundSchema = z.object({
  url: z.union([z.literal(""), z.url("URL inválida.")]),
  header: z.string().trim().max(64),
  times: z.array(z.string().regex(HOUR_RE)).min(1).max(6),
});

/** Salva a URL de destino, o cabeçalho/segredo e os horários do envio. */
export async function saveOutboundSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const admin = createAdminClient();

    const times = [...new Set(formData.getAll("times").map(String))].sort();
    const parsed = outboundSchema.safeParse({
      url: String(formData.get("url") ?? "").trim(),
      header: String(formData.get("header") ?? "").trim(),
      times,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    }

    const secret = sanitizeSecret(formData.get("secret") as string);
    const update: Record<string, unknown> = {
      outbound_enabled: String(formData.get("enabled") ?? "0") === "1",
      outbound_url: parsed.data.url || null,
      outbound_header: parsed.data.header || DEFAULT_OUTBOUND_HEADER,
      outbound_times: parsed.data.times.length
        ? parsed.data.times
        : DEFAULT_OUTBOUND_TIMES,
    };
    // Segredo só é reescrito quando a pessoa digita um novo.
    if (secret) {
      update.outbound_secret_enc = await encrypt(admin, secret);
      update.outbound_secret_mask = maskSecret(secret);
    }

    const { error } = await admin.from("settings").update(update).eq("id", 1);
    if (error) return { error: error.message };

    revalidatePath(CONFIG_PATH);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro inesperado." };
  }
}

/** Dispara o envio na hora (botão "Enviar agora"), fora do agendamento. */
export async function sendOutboundNow(): Promise<TestResult> {
  await requireUser();
  const admin = createAdminClient();
  const res = await sendOutbound(admin, "manual");
  return {
    ok: res.ok,
    message: res.ok
      ? `Enviado: ${res.ads ?? 0} anúncio(s), resposta ${res.status ?? 200}.`
      : (res.message ?? "Falha no envio."),
  };
}

/** Prévia do JSON que sai no próximo envio (o dia de hoje, como está agora). */
export async function previewOutboundPayload(): Promise<{
  ok: boolean;
  json: string;
}> {
  await requireUser();
  const admin = createAdminClient();
  try {
    const payload = await buildOutboundPayload(admin, parseRange("today"));
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  } catch (e) {
    return {
      ok: false,
      json: e instanceof Error ? e.message : "Falha ao montar o payload.",
    };
  }
}

// ── Contas (GA4 / Pixel / Ad account) ────────────────────────────────────────
const accountSchema = z.object({
  label: z.string().trim().min(1, "Informe um rótulo."),
  publicId: z.string().trim().min(1, "Informe o identificador."),
});

export async function saveAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const admin = createAdminClient();

    const kind = String(formData.get("kind")) as AccountKind;
    const map = TABLES[kind];
    if (!map) return { error: "Tipo de conta inválido." };

    const id = String(formData.get("id") ?? "").trim();
    const secret = sanitizeSecret(formData.get("secret") as string);
    const isActive = String(formData.get("is_active") ?? "1") === "1";

    const parsed = accountSchema.safeParse({
      label: formData.get("label"),
      publicId: formData.get("publicId"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
    }

    let publicId = sanitizeSecret(parsed.data.publicId);
    if (kind === "adaccount") publicId = normalizeAdAccountId(publicId);

    const row: Record<string, unknown> = {
      label: parsed.data.label,
      [map.idCol]: publicId,
      is_active: isActive,
    };
    if (secret) {
      row[map.encCol] = await encrypt(admin, secret);
      row[map.maskCol] = maskSecret(secret);
    }

    const res = id
      ? await admin.from(map.table).update(row).eq("id", id)
      : await admin.from(map.table).insert(row);

    if (res.error) {
      if (res.error.code === "23505") {
        return { error: "Já existe uma conta com esse identificador." };
      }
      return { error: res.error.message };
    }

    revalidatePath(CONFIG_PATH);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro inesperado." };
  }
}

export async function deleteAccount(kind: AccountKind, id: string) {
  await requireUser();
  const map = TABLES[kind];
  if (!map) throw new Error("Tipo inválido.");
  const admin = createAdminClient();
  const { error } = await admin.from(map.table).delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(CONFIG_PATH);
}

export async function toggleActive(
  kind: AccountKind,
  id: string,
  next: boolean,
) {
  await requireUser();
  const map = TABLES[kind];
  if (!map) throw new Error("Tipo inválido.");
  const admin = createAdminClient();
  const { error } = await admin
    .from(map.table)
    .update({ is_active: next })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(CONFIG_PATH);
}

// ── Testar conexão ───────────────────────────────────────────────────────────
export async function testConnection(
  kind: AccountKind,
  id: string,
): Promise<TestResult> {
  try {
    await requireUser();
    const map = TABLES[kind];
    if (!map) return { ok: false, message: "Tipo inválido." };
    const admin = createAdminClient();

    const { data, error } = await admin
      .from(map.table)
      .select(`${map.idCol}, ${map.encCol}`)
      .eq("id", id)
      .single();
    if (error || !data) return { ok: false, message: "Conta não encontrada." };

    const row = data as unknown as Record<string, string | null>;
    const enc = row[map.encCol];
    if (!enc) {
      return { ok: false, message: "Cadastre o segredo antes de testar." };
    }
    const secret = await decrypt(admin, enc);
    if (!secret) return { ok: false, message: "Não foi possível ler o segredo." };

    const publicId = row[map.idCol] as string;

    if (kind === "pixel") return await testMetaPixel(admin, publicId, secret);
    if (kind === "ga4") return await testGa4(publicId, secret);
    return await testAdAccount(publicId, secret);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Erro inesperado.",
    };
  }
}

async function testMetaPixel(
  admin: ReturnType<typeof createAdminClient>,
  pixelId: string,
  token: string,
): Promise<TestResult> {
  const { data: settings } = await admin
    .from("settings")
    .select("test_event_code")
    .eq("id", 1)
    .single();

  // event_source_url a partir do host da request (a Meta exige uma URL válida).
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";

  const event = {
    event_name: "PageView",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_id: crypto.randomUUID(),
    event_source_url: `${proto}://${host}/`,
    // user_data precisa de ao menos um identificador forte (email hasheado aqui).
    user_data: {
      em: sha256("teste@tracking.local"),
      client_user_agent: "tracking-test/1.0",
    },
  };
  const body = {
    data: [event],
    ...(settings?.test_event_code
      ? { test_event_code: settings.test_event_code }
      : {}),
  };

  const res = await fetch(
    `${metaCapiUrl(pixelId)}?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  if (res.ok && (json.events_received ?? 0) >= 1) {
    const note = settings?.test_event_code
      ? ` Veja em Test Events (code ${settings.test_event_code}).`
      : " (Defina um test_event_code em Geral para ver em Test Events.)";
    return { ok: true, message: `Evento de teste recebido.${note}` };
  }

  const err = json?.error;
  const detail =
    err?.error_user_msg ?? err?.message ?? "Falha ao enviar evento de teste.";
  const code = err?.code
    ? ` (código ${err.code}${err.error_subcode ? "/" + err.error_subcode : ""})`
    : "";
  return { ok: false, message: `${detail}${code}` };
}

async function testGa4(measurementId: string, apiSecret: string): Promise<TestResult> {
  const url = `${GA4_MP_DEBUG_ENDPOINT}?measurement_id=${encodeURIComponent(
    measurementId,
  )}&api_secret=${encodeURIComponent(apiSecret)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: `test.${Date.now()}`,
      events: [{ name: "page_view", params: {} }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  const msgs: Array<{ description?: string }> = json?.validationMessages ?? [];
  if (res.ok && msgs.length === 0) {
    return {
      ok: true,
      message:
        "Payload válido no endpoint de debug do GA4. Confirme a chegada no DebugView (o MP não valida o api_secret na resposta).",
    };
  }
  return {
    ok: false,
    message: msgs.map((m) => m.description).filter(Boolean).join("; ") ||
      "Falha na validação do GA4.",
  };
}

async function testAdAccount(adAccountId: string, token: string): Promise<TestResult> {
  const url = `${metaAdAccountUrl(adAccountId)}?fields=name,account_status&access_token=${encodeURIComponent(
    token,
  )}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (res.ok && json?.name) {
    return { ok: true, message: `Conectado: ${json.name}` };
  }
  return {
    ok: false,
    message: json?.error?.message ?? "Falha ao acessar a conta de anúncio.",
  };
}
