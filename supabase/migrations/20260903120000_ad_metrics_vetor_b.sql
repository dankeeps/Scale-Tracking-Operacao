-- ═══════════════════════════════════════════════════════════════════════════
-- Métricas de criativo/VSL por anúncio (integração Vetor B)
--
-- O Vetor B envia, por webhook, um bloco de métricas por ANÚNCIO (nome exato).
-- Cada envio é um SNAPSHOT DO DIA: a linha (fonte, anúncio, dia) é substituída
-- quando o mesmo dia é reenviado. O painel cruza com o Meta/UTM por `match_key`
-- (nome do anúncio em minúsculo) — a mesma chave usada pela receita por UTM.
--
-- Escrita só via service_role (webhook); painel (authenticated) apenas lê.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ad_metrics (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null default 'vetor_b',   -- origem da integração
  ad_name             text not null,                     -- nome exato do anúncio
  match_key           text not null,                     -- ad_name normalizado (casa com o UTM)
  metric_date         date not null,                     -- dia civil de São Paulo
  -- Criativo / VSL (percentuais, 0–100 como vêm do Vetor B).
  hook_rate           numeric(8, 3),
  hold_rate           numeric(8, 3),
  retencao_1min       numeric(8, 3),
  retencao_pitch      numeric(8, 3),
  conversao_vsl       numeric(8, 3),
  conv_checkout       numeric(8, 3),
  -- Custos.
  cpm                 numeric(14, 2),
  cpc                 numeric(14, 2),
  custo_ic            numeric(14, 2),
  -- Resultado (segunda fonte: o sistema também calcula por Meta × webhook).
  faturamento         numeric(14, 2),
  faturamento_backend numeric(14, 2),
  investimento        numeric(14, 2),
  roas                numeric(10, 3),
  raw                 jsonb,                              -- item bruto (auditoria)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ad_metrics_unique_day unique (source, match_key, metric_date)
);

create index if not exists ad_metrics_date_idx      on public.ad_metrics (metric_date desc);
create index if not exists ad_metrics_match_key_idx on public.ad_metrics (match_key);

create trigger ad_metrics_set_updated_at before update on public.ad_metrics
  for each row execute function public.tg_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.ad_metrics enable row level security;

create policy "ad_metrics: authenticated read" on public.ad_metrics
  for select to authenticated using (true);

revoke all on public.ad_metrics from anon, authenticated;
grant select on public.ad_metrics to authenticated;
grant all on public.ad_metrics to service_role;
