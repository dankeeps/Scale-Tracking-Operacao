-- ═══════════════════════════════════════════════════════════════════════════
-- Webhook de SAÍDA (Configurações → Envio de dados)
--
-- A URL do sistema do cliente onde ESTE sistema publica, nos horários
-- escolhidos (3x/dia por padrão), o bloco de métricas por anúncio — mesmo
-- formato do payload do Vetor B. O cron da Vercel bate de hora em hora e
-- `outbound_runs` guarda cada tentativa (uma linha por dia + horário).
--
-- O segredo do cabeçalho é cifrado (mesma RPC dos demais); painel só vê máscara.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.settings
  add column if not exists outbound_url         text,
  add column if not exists outbound_secret_enc  bytea,
  add column if not exists outbound_secret_mask text,
  add column if not exists outbound_header      text,
  add column if not exists outbound_times       text[] not null default array['06:00', '12:00', '20:00'],
  add column if not exists outbound_enabled     boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'settings_outbound_times_valid'
  ) then
    alter table public.settings
      add constraint settings_outbound_times_valid
      check (
        array_length(outbound_times, 1) between 1 and 6
        -- Só horas cheias: o cron da Vercel bate de hora em hora.
        and outbound_times <@ array[
          '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00',
          '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
          '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
        ]
      );
  end if;
end
$$;

grant select (
  outbound_url, outbound_secret_mask, outbound_header, outbound_times,
  outbound_enabled
) on public.settings to authenticated;

-- ── registro dos envios ──────────────────────────────────────────────────────
create table if not exists public.outbound_runs (
  id          uuid primary key default gen_random_uuid(),
  run_date    date not null,                    -- dia civil de São Paulo
  slot        text not null,                    -- horário configurado ou "manual"
  ok          boolean not null default false,
  http_status integer,
  ads_count   integer,                          -- anúncios enviados
  message     text,
  created_at  timestamptz not null default now(),
  constraint outbound_runs_unique_slot unique (run_date, slot)
);

create index if not exists outbound_runs_created_idx
  on public.outbound_runs (created_at desc);

alter table public.outbound_runs enable row level security;

create policy "outbound_runs: authenticated read" on public.outbound_runs
  for select to authenticated using (true);

revoke all on public.outbound_runs from anon, authenticated;
grant select on public.outbound_runs to authenticated;
grant all on public.outbound_runs to service_role;
