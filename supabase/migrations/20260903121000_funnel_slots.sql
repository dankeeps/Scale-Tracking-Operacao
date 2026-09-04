-- ═══════════════════════════════════════════════════════════════════════════
-- Etapas do funil por produto (Configurações → Funil)
--
-- Cada produto vendido pode ocupar UMA etapa do funil (produto principal,
-- upsells, webinars). A tela de Campanhas usa isso para quebrar faturamento e
-- ROAS por etapa — o ROAS de cada etapa soma as etapas anteriores.
-- Escrita só via service_role (Server Action do painel); leitura autenticada.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.product_settings
  add column if not exists funnel_slot text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_settings_funnel_slot_valid'
  ) then
    alter table public.product_settings
      add constraint product_settings_funnel_slot_valid
      check (
        funnel_slot is null
        or funnel_slot in (
          'front', 'upsell_01', 'upsell_02',
          'webinar_01', 'webinar_02', 'webinar_03'
        )
      );
  end if;
end
$$;

-- Uma etapa não pode ter dois produtos (o produto já é único pela PK).
create unique index if not exists product_settings_funnel_slot_key
  on public.product_settings (funnel_slot)
  where funnel_slot is not null;
