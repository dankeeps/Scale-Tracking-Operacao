@AGENTS.md

# CLAUDE.md — Sistema de Tracking Server-Side

Guia para agentes e humanos trabalhando neste repositório. Mantenha-o atualizado
a cada fase.

> ⚠️ **Next.js 16**: tem breaking changes vs. treino. Antes de escrever código que
> toca APIs do Next, leia o guia relevante em `node_modules/next/dist/docs/`
> (ver `AGENTS.md`). Ex.: middleware, params async, cache components.

## O que é

**Template duplicável**: um projeto por especialista/cliente, cada um com sua
pilha (Supabase + Vercel + credenciais). O repositório **não carrega dado de
ninguém** — nome/logo vêm de `NEXT_PUBLIC_BRAND_*` (`src/lib/branding.ts`), e
pixel/GA4/domínio/token são cadastrados pelo painel.

Rastreamento **server-side** com painel autenticado. Captura visitantes e eventos,
enriquece no servidor (IP real, user agent, geo) e dispara conversões para **todos**
os destinos ativos — múltiplos **Meta Pixels** (Conversions API) e múltiplas
propriedades **GA4** (Measurement Protocol) — com deduplicação por `event_id`.
Um webhook genérico de compra (Hotmart/Kiwify/Eduzz) casa a venda ao visitante e
dispara `Purchase`. O painel lê tudo via RLS.

## Stack e versões (fonte única: `src/lib/constants.ts`)

- **Next.js 16** (App Router, Turbopack, React 19) + TypeScript.
- **Supabase** (Postgres + Auth) via `@supabase/ssr` e `@supabase/supabase-js`.
- **Tailwind CSS v4** (config em CSS, `@theme`/`@custom-variant`).
- UI estilo **shadcn/ui** sobre **Radix**; **sonner** (toasts); ícones **lucide-react**.
- **Recharts** (gráficos) e **react-simple-maps** (mapa geo) — fases posteriores.
- **Meta Graph API `v25.0`** — constante `META_GRAPH_VERSION`. Atualize SÓ ali.
- **GA4 Measurement Protocol** — `https://www.google-analytics.com/mp/collect`.

> Antes de integrar qualquer API, confira a doc oficial atual. Toda versão em URL
> mora em `src/lib/constants.ts`.

## Comandos

```bash
npm run dev     # desenvolvimento (Turbopack)
npm run build   # build de produção
npm run lint    # ESLint
npm start       # servir o build
```

## Convenções

- **Idioma**: comentários e UI em pt-BR.
- **Imports**: alias `@/*` → `src/*`.
- **UI**: componentes em `src/components/ui/*`; helper `cn()` em `src/lib/utils.ts`.
- **Cores**: tokens HSL em CSS vars (`src/app/globals.css`). Primária azul do
  sistema, accents ciano/âmbar, sinalização em verde/vermelho. Tema escuro é o
  padrão (`next-themes`, classe `.dark`) e manda no desenho: preto quase puro,
  superfícies translúcidas, cor usada com parcimônia.
- **Material**: `.glass` é a superfície padrão (translucidez + `backdrop-filter`,
  fio de luz na borda de cima, sombra baixa); `.glass-bar` nas barras fixas
  (header/sidebar); `.hairline` para separadores de 1px. Nada de gradiente
  colorido: profundidade vem de desfoque e sombra. Raio base 14px (`--radius`).
- **Fontes**: Manrope (`--font-manrope`) e JetBrains Mono (`--font-jetbrains`).
  Números de **display** (KPIs, valores grandes) usam a classe `.num` — sans com
  figuras tabulares; o monoespaçado fica para tabelas e valores técnicos.
- **Movimento**: curto (150ms) e discreto — `active:scale-[0.985]` nos botões,
  transições só de cor/sombra. Respeita `prefers-reduced-motion`.

## Segurança (regras invioláveis)

- **RLS em TODAS as tabelas.** Leitura só por usuário autenticado (painel).
  Escrita só no servidor via **service_role**.
- **Cadastro público DESLIGADO.**
- **service_role só no servidor** — nunca com `NEXT_PUBLIC_`. O client admin
  (`src/lib/supabase/admin.ts`) importa `server-only`.
- **Env = só infra Supabase** (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) + `CRON_SECRET`
  (autenticação do cron da Vercel, opcional). Nada de tokens de Meta/GA4/Vetor B
  em env — eles ficam **no banco, cifrados** e são geridos pelo painel.
- **Segredos cifrados** com pgcrypto; chave no **Supabase Vault**; decrypt só via
  RPC `SECURITY DEFINER` chamada com service_role.
- **Endpoints públicos** (captura/webhook): validar entrada (zod) + rate limiting
  (Postgres); webhook exige `webhook_token`.
- `.env*` fora do git (exceto `.env.example`).

## Modo demonstração (vitrine)

- **Chave**: `src/lib/demo/mode.ts` → `IS_DEMO` = faltou alguma das 3 envs do
  Supabase. Server-only; para Client Components o flag vai **por prop**.
- **Quando ligado**: `/` e `/login` mandam para `/dashboard`; `proxy.ts` não
  renova sessão; `(panel)/layout.tsx` não chama `getUser()`; o shell mostra o
  banner e esconde "Sair". Endpoints públicos respondem **503**
  (`notConfiguredResponse` em `capture/http.ts`); actions de escrita lançam
  `DEMO_WRITE_ERROR` no `requireUser()`.
- **Dados**: `src/lib/demo/data.ts` — determinístico (PRNG com semente do dia),
  coerente (compras são geradas como linhas; receita/funil/ROAS/mapa saem delas)
  e barato (visitas/eventos são contagens + amostra de linhas). Nada de
  `Math.random()` solto: a tela não pode mudar a cada refresh.
- **Roteamento de dados**: `src/lib/dashboard/data.ts` é o ÚNICO lugar que
  decide real × fictício. As páginas chamam `getSource()` e passam `Source`.
  Nunca importe `queries.ts`/`spend.ts` direto numa página nova.

## Auth (painel)

- **Next 16**: o middleware virou **`proxy.ts`** (em `src/proxy.ts`). Ele renova a
  sessão (cookies) e faz redirect otimista de `/dashboard*` → `/login`.
- **Proteção real**: `src/app/(panel)/layout.tsx` valida `getUser()` no servidor
  (proxy é só otimista, como manda a doc do Next 16).
- **Login**: Server Action `signInWithPassword` (`src/app/login/`). Signup off →
  sem rota de cadastro; usuários criados à mão no Supabase (Auth → Users).
- **Rotas**: `/` landing pública, `/login`, painel em `/dashboard/*` (route group
  `(panel)`). Shell responsivo em `src/components/panel/` (sidebar desktop + drawer
  mobile via Sheet + header com toggle/logout).

## Captura (endpoints públicos)

- **`GET /api/config`** — ids públicos ativos (measurement_ids + pixel_ids) pro
  snippet. Sem segredos.
- **`POST /api/identify`** — upsert em `visitors` (parcial, não sobrescreve o que
  falta); IP/UA/geo do servidor; normaliza email/telefone e gera hashes SHA-256.
- **`POST /api/event`** — insere em `events_log`, enriquece com o visitante,
  `event_id` compartilhado (dedup por unique → `deduped:true`). Disparo Meta/GA4
  entra na Fase 6, logo após o insert.
- Todos: validação **zod** + **rate limit** (RPC `consume_rate_limit`, fail-open)
  + **CORS** (`*`, o snippet roda cross-origin) + `OPTIONS` preflight + Node runtime.
- Utils: `src/lib/capture/{geo,ratelimit,http,schemas}.ts`, `src/lib/hash.ts`
  (server-only). **Não** hashear fbp/fbc/ip/user_agent.
- **Snippet**: `public/t.js` — resolve trck_user_id (URL `?trck=` → localStorage),
  carrega gtag.js + Pixel dinâmicos, `window.trck.{track,identify,decorate,getId}`;
  `track()` usa o MESMO event_id no Pixel e no servidor. Teste local: `/demo.html`.

## Dashboard (`/dashboard/*`)

- Leitura via cliente **autenticado** (RLS); agregações em JS sobre faixas
  limitadas (`src/lib/dashboard/queries.ts`). Período via `?range=7d|30d|90d|all`.
- **Dedup de consultas**: os carregadores base (`loadPurchases`,
  `loadDistinctUsers`, `countRows`, `listAdAccounts`) usam `cache()` do React —
  memoiza por request pela IDENTIDADE dos argumentos. Por isso o client e o
  `range` são criados **uma vez por página** (`getSource()` + `parseRange`).
  Passar objeto novo por chamada fura o cache.
- **Instruções**: `/dashboard/instrucoes` — passo a passo de ativação (Supabase,
  Vercel, Pixel/CAPI, Ads, GA4, webhook, snippet, testes). Abre em modo demo.
- **Visão geral**: KPIs (visitantes/eventos/compras/conversão) + funil + receita
  no tempo (Recharts) + eventos por tipo.
- **Eventos**: tabela paginada filtrável (tipo) + modal com payload/response
  (Meta/GA4) por destino.
- **Faturamento**: receita/ticket/reembolsos + tabela de compras.
- **Campanhas**: Meta Ads insights (`src/lib/dispatch/meta-ads.ts`, cache
  `unstable_cache` ~30min + `revalidateTag(tag,"max")` sob demanda) × receita por
  UTM → ROAS/CPA em árvore campanha→conjunto→anúncio (`<details>`), filtro de conta.
  Uma coluna por etapa do funil configurada (faturamento do produto daquela
  etapa + **ROAS acumulado**: etapa somada às anteriores ÷ investimento) e, no
  nível Anúncios, a coluna **VSL** com as métricas do Vetor B em modal. O que a
  tabela mostra como investimento/faturamento continua vindo do Meta e do
  webhook de compra — os números do Vetor B ficam só no modal, rotulados.
- **Geo**: mapa-múndi renderizado no servidor (d3-geo + world-atlas, SVG inline;
  match por nome en) + barras por país/estado/cidade.
- Gráficos: `recharts` (client). Paleta em `chart-theme.ts`. Datas no render de
  Server Components: derivar do `range` (evitar `Date.now()`/`new Date()` puros).
- Demo: `scripts/seed-demo.mjs` (insere/`--clean` remove dados fictícios seed-/SEED-).

## Webhook de compra (`/api/webhook/compra`)

- Protegido por `webhook_token` (header `x-webhook-token` **ou** `?token=`),
  comparado em constant-time (decifrado via `decrypt_secret`). Rate limit + Node.
- **Parser genérico** `src/lib/webhook/parse.ts` (Hotmart/Kiwify/Eduzz): candidate
  paths + busca recursiva por chave; `parseMoney` (aceita "97,50"/"1.234,56"/cents-ish).
- **Matching**: `trck_user_id` → email → telefone; grava `matched` + `match_reason`.
- **Idempotência**: upsert em `purchases` por `transaction_id`; `meta_event_id =
  pur_<transaction_id>`; se já tem `response_meta`, não redispara (`already_dispatched`).
- **Disparo**: `Purchase` p/ Meta (todos os pixels) + GA4 MP (todas as propriedades,
  só se houver `ga_client_id`); salva payload/response de cada envio + `raw_webhook`.
- `shouldDispatchPurchase(status)`: dispara salvo status claramente negativo
  (refund/chargeback/cancel/pending/…).

## Webhook de SAÍDA (`src/lib/outbound/`)

- Tela Configurações → **Webhook de saída**: URL do webhook do sistema de
  criativos do cliente, cabeçalho + token (cifrado), 3 horários, "Enviar agora",
  prévia do JSON e histórico dos envios.
- `payload.ts` monta um item por anúncio no MESMO formato do Vetor B: mídia
  (investimento/CPM/CPC) do Meta Ads, faturamento/ROAS por UTM do webhook de
  compra, `faturamento_backend` = etapas do funil que não são `front`,
  `conv_checkout`/`custo_ic` dos InitiateCheckout por `utm_content`, e as
  métricas de VSL quando existirem em `ad_metrics`. Campo sem dado é OMITIDO do
  JSON (o destino ignora campos ausentes) — nada é estimado.
- `send.ts` faz o POST do dia corrente (SP) e grava a tentativa em
  `outbound_runs` (idempotente por dia + horário).

## Webhook de métricas — Vetor B (`/api/webhook/vetor-b`)

- Mesmo `webhook_token` do webhook de compra (auth compartilhada em
  `src/lib/webhook/auth.ts`), header `x-webhook-token` ou `?token=`.
- Corpo: `{ "data": "AAAA-MM-DD" (opcional), "ads": [{ "nome", hook_rate,
  hold_rate, cpm, conv_checkout, custo_ic, cpc, retencao_1min, retencao_pitch,
  conversao_vsl, faturamento, investimento, roas, faturamento_backend }] }`.
  Validação zod tolerante (`src/lib/webhook/vetor-b.ts`): número ou string
  ("32,5", "R$ 97") via `parseMoney`; campo ilegível vira `null`, não derruba o lote.
- **Snapshot diário**: upsert em `ad_metrics` por `(source, match_key,
  metric_date)` — reenviar o mesmo dia substitui. `metric_date` é o dia civil de
  São Paulo; `match_key` = nome do anúncio em minúsculo (casa com `utm_content`,
  mesma regra da receita por UTM).
- Gravação compartilhada em `src/lib/webhook/vetor-b-ingest.ts`. Enquanto nada
  for recebido aqui, as colunas de VSL ficam vazias no painel e são omitidas do
  webhook de saída — o resto das métricas não depende disso.
- **Cron**: `vercel.json` agenda `/api/cron/integracoes` de hora em hora. A rota
  compara a hora cheia de São Paulo com os horários do envio, pula o que já
  enviou hoje (`outbound_runs`) e dispara o resto. Auth: `CRON_SECRET` (Bearer)
  ou, sem ela, o cabeçalho `x-vercel-cron`. Cron de hora em hora exige plano Pro
  na Vercel.
- Leitura no painel: `src/lib/dashboard/ad-metrics.ts` agrega o período
  (dinheiro soma; taxas/custos viram média dos dias; ROAS é recalculado das
  somas) e devolve mapa por nome do anúncio.

## Disparo server-side (`src/lib/dispatch/`)

- `accounts.ts` — lê pixels/GA4 **ativos** e decifra tokens (`decrypt_secret`, só
  service_role). Server-only.
- `meta.ts` — **Meta CAPI** (Graph v25). Hash SHA-256 em em/ph/fn/ln/ct/st/country/
  external_id; **NÃO** hash em fbp/fbc/ip/ua. `action_source:"website"`, `event_id`,
  `event_source_url`, `custom_data`. `dispatchMeta` faz fan-out p/ todos os pixels.
- `ga4.ts` — **Measurement Protocol**. `dispatchGa4` p/ todas as propriedades;
  reusa `client_id`/`session_id`; suporta `debug`. **Só** p/ evento offline (webhook).
- **`/api/event`**: após o insert, dispara Meta CAPI via `after()` (não bloqueia) e
  grava `payload_meta` + `response_meta` (array por destino) no `events_log`.
  GA4 **não** entra aqui (já foi pela gtag) — o MP é acionado pelo webhook (Fase 7).

## Configurações (credenciais pelo painel)

- Tela `/dashboard/config` (tabs: Geral, Webhook de saída, Pixels, GA4, Contas
  de anúncio, Produtos, Funil).
- **Leitura**: server component via client authenticated (RLS + privilégio de
  coluna → só colunas seguras/máscara). **Escrita**: Server Actions em
  `config/actions.ts` que checam `getUser()` e gravam via **admin (service_role)**.
- Segredos: cifrados com a RPC `encrypt_secret` (a coluna `bytea` recebe a string
  `\x…` de volta pelo client — validado); máscara calculada em `src/lib/mask.ts`.
- **Webhook**: a aba Geral tem o campo `webhook_domain` (host onde o sistema está
  publicado, ex.: `dados.seudominio.com`). Ele + o token recém-gerado montam a
  **URL completa** na tela (`src/lib/webhook/domain.ts`, usado pelo form e pela
  action) — a pessoa só copia. O token só aparece no momento em que é gerado (no
  banco fica cifrado), então o formulário NÃO limpa o campo após salvar.
- **Funil**: cada etapa (`front`, `upsell_01`, `upsell_02`, `webinar_01..03` —
  `src/lib/funnel.ts`) recebe um produto já vendido; grava em
  `product_settings.funnel_slot` (índice único → uma etapa, um produto). A aba
  Geral também mostra a URL de RECEBIMENTO do Vetor B (mesmo token).
- "Testar conexão": Pixel → CAPI test event (usa `test_event_code`); GA4 → debug
  do Measurement Protocol; Ad account → nó `act_<id>` (fields=name). Decifra o
  segredo via `decrypt_secret` (service_role) só na hora do teste/disparo.
- Padrão de UI: form actions via `useTransition` + toast (evita `setState` em
  effect, que o lint do React 19 barra).

## Clientes Supabase

- `src/lib/supabase/browser.ts` — Client Components (anon, sob RLS).
- `src/lib/supabase/server.ts` — Server Components/Actions (anon + sessão, sob RLS).
- `src/lib/supabase/admin.ts` — service_role, **só servidor**, bypassa RLS.

## Estrutura (planejada)

```
src/
  app/                # rotas (App Router)
    api/{identify,event}/route.ts
    api/webhook/compra/route.ts
    (dashboard)/...    # painel autenticado
  components/ui/       # kit de UI
  lib/
    constants.ts       # versões de API, endpoints, TTLs, limites
    supabase/          # clientes browser/server/admin
    dispatch/{meta,ga4}.ts   # CAPI e Measurement Protocol
    {hash,geo,ratelimit,crypto}.ts
supabase/migrations/   # schema, RLS, RPCs de cifra, pg_cron
middleware.ts          # refresh de sessão Supabase (conferir nome no Next 16)
```

## Decisões arquiteturais

- **Tenancy: single-tenant.** Signup desligado ⇒ os autenticados são o dono + time
  do painel e veem tudo. **Não há `user_id` por linha** nas tabelas; o corte de
  acesso é anon (nada) × authenticated (lê) × service_role (escreve, ignora RLS).
- **Geo por IP**: headers da Vercel (`x-vercel-ip-*`); fallback no dev local.
- **Rate limiting**: contadores por IP/janela em `private.rate_limits` (RPC
  `consume_rate_limit`), sem serviço extra.
- **Cifra**: chave aleatória no Vault (`tracking_pgp_key`); `encrypt_secret`/
  `decrypt_secret` (pgcrypto, SECURITY DEFINER, só `service_role`). Segredos nas
  colunas `*_enc`; painel só vê `*_mask`. Privilégio de coluna esconde o ciphertext.
- **Dedup**: um único `event_id` compartilhado entre gtag (browser) e CAPI (server).
- **GA4**: gtag cobre os eventos do site; o Measurement Protocol só AUGMENTA com o
  evento offline (compra do webhook) — sem duplicar.

## Banco de dados

Migrations em `supabase/migrations/` (ver `supabase/README.md` para aplicar). Sem
Docker no ambiente de dev, valide a **sintaxe** com libpg-query; aplique no projeto
Supabase via `supabase db push` ou SQL Editor. `config.toml` tem `enable_signup=false`
(confirmar também no painel do projeto hospedado).

## Progresso por fase

- [x] **Fase 1** — Fundação, design system, clientes Supabase, CLAUDE.md.
- [x] **Fase 2** — Banco/RLS/pgcrypto+Vault/pg_cron (migrations + config signup off).
- [x] **Fase 3** — Auth (login server action + `proxy.ts` de sessão) + shell responsivo.
- [x] **Fase 4** — Config multi-conta (CRUD cifrado + testar conexão).
- [x] **Fase 5** — Captura (identify/event + /api/config + snippet t.js + rate limit).
- [x] **Fase 6** — Disparo (Meta CAPI no /api/event via after; GA4 MP pronto p/ webhook).
- [x] **Fase 7** — Webhook de compra (token, matching, idempotente, Purchase Meta+GA4).
- [x] **Fase 8** — Dashboard (overview, eventos, faturamento, campanhas, geo).
- [x] **Fase 9** — Template duplicável: branding por env, dados pessoais fora do
      repo, modo demonstração (sem login + dados fictícios), aba Instruções e
      deduplicação das consultas do painel.
- [ ] **Fase 10** — Auditoria de segurança + deploy.
