"use client";

import { CheckSquare, Pencil, Square, X } from "lucide-react";
import { useState, useTransition } from "react";
import {
  toggleObjectStatus,
  updateBudget,
} from "@/app/(panel)/dashboard/campanhas/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import type { FunnelAssignment } from "@/lib/config/funnel";
import type { AdMetrics } from "@/lib/dashboard/ad-metrics";
import type { ConversionPath } from "@/lib/dashboard/assists";
import type { UtmAgg } from "@/lib/dashboard/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { FUNNEL_SLOTS, type FunnelSlot } from "@/lib/funnel";
import type { VetorBMetric } from "@/lib/webhook/vetor-b";

export interface ManagerRow {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  adAccountDbId: string;
  campaignId: string | null;
  adsetId: string | null;
  budgetType: "daily" | "lifetime" | null;
  budgetCents: number | null;
  spend: number;
  revenue: number;
  orders: number;
  assists: number;
  assistPaths: ConversionPath[];
  /** Faturamento por etapa do funil (Configurações → Funil). */
  slots: Record<string, UtmAgg>;
  /** Métricas de criativo/VSL do Vetor B — só no nível anúncio. */
  vetor: AdMetrics | null;
}

/** Métricas do Vetor B na ordem e no formato em que aparecem no modal. */
const VETOR_FIELDS: {
  key: VetorBMetric;
  label: string;
  kind: "pct" | "money" | "x";
}[] = [
  { key: "hook_rate", label: "Hook rate", kind: "pct" },
  { key: "hold_rate", label: "Hold rate", kind: "pct" },
  { key: "retencao_1min", label: "Retenção 1 min", kind: "pct" },
  { key: "retencao_pitch", label: "Retenção no pitch", kind: "pct" },
  { key: "conversao_vsl", label: "Conversão da VSL", kind: "pct" },
  { key: "conv_checkout", label: "Conversão do checkout", kind: "pct" },
  { key: "cpm", label: "CPM", kind: "money" },
  { key: "cpc", label: "CPC", kind: "money" },
  { key: "custo_ic", label: "Custo por IC", kind: "money" },
  { key: "faturamento", label: "Faturamento (Vetor B)", kind: "money" },
  { key: "faturamento_backend", label: "Faturamento back-end", kind: "money" },
  { key: "investimento", label: "Investimento (Vetor B)", kind: "money" },
  { key: "roas", label: "ROAS (Vetor B)", kind: "x" },
];

/** Percentual que já vem em 0–100 (o Vetor B manda 32.5 para 32,5%). */
const pct = (n: number | null): string =>
  n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function vetorValue(
  m: AdMetrics,
  f: (typeof VETOR_FIELDS)[number],
  currency: string,
): string {
  const v = m[f.key];
  if (v == null) return "—";
  if (f.kind === "pct") return pct(v);
  if (f.kind === "x") return `${v.toFixed(2)}x`;
  return formatCurrency(v, currency);
}

type Level = "campaigns" | "adsets" | "ads";

const hasIssue = (row: ManagerRow) =>
  /DISAPPROVED|WITH_ISSUES|ERROR/.test(row.effectiveStatus.toUpperCase());

function StatusBadge({ row }: { row: ManagerRow }) {
  if (hasIssue(row)) return <Badge variant="destructive">com problema</Badge>;
  const s = row.status.toUpperCase();
  if (s === "ACTIVE") return <Badge variant="success">ativo</Badge>;
  if (s === "PAUSED") return <Badge variant="secondary">pausado</Badge>;
  return <Badge variant="secondary">{s.toLowerCase() || "—"}</Badge>;
}

function Roas({ revenue, spend }: { revenue: number; spend: number }) {
  if (spend <= 0) return <span className="text-muted-foreground">—</span>;
  const roas = revenue / spend;
  return (
    <span
      className={`font-mono tabular-nums ${roas >= 1 ? "text-success" : "text-destructive"}`}
    >
      {roas.toFixed(2)}x
    </span>
  );
}

function toggleSet(set: Set<string>, id: string): Set<string> {
  const n = new Set(set);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

/** Caminho de uma conversão assistida: toques em ordem + onde converteu. */
function PathCard({
  path,
  highlight,
  currency,
}: {
  path: ConversionPath;
  highlight: string;
  currency: string;
}) {
  const line = (campaign: string, adset: string | null, ad: string | null) =>
    [campaign, adset, ad].filter(Boolean).join(" · ");
  return (
    <div className="rounded-md border hairline p-2 text-xs">
      <ol className="space-y-1">
        {path.steps.map((s, j) => {
          const hit = s.campaign.toLowerCase() === highlight.toLowerCase();
          return (
            <li key={j} className={hit ? "text-primary" : ""}>
              <span className={hit ? "font-medium" : ""}>
                {line(s.campaign, s.adset, s.ad)}
              </span>
              {s.events.length ? (
                <span className="text-muted-foreground"> — {s.events.join(", ")}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-1 border-t hairline pt-1 font-medium text-success">
        ✅ Comprou em{" "}
        {line(
          path.converting.campaign,
          path.converting.adset,
          path.converting.ad,
        )}{" "}
        — {formatCurrency(path.value, currency)}
      </div>
    </div>
  );
}

export function CampaignsManager({
  campaigns,
  adsets,
  ads,
  currency,
  funnel,
}: {
  campaigns: ManagerRow[];
  adsets: ManagerRow[];
  ads: ManagerRow[];
  currency: string;
  /** Etapas configuradas em Configurações → Funil (uma coluna cada). */
  funnel: FunnelAssignment[];
}) {
  const [level, setLevel] = useState<Level>("campaigns");
  // Múltipla seleção (como no Meta): marca várias campanhas/conjuntos.
  const [selCampaigns, setSelCampaigns] = useState<Set<string>>(new Set());
  const [selAdsets, setSelAdsets] = useState<Set<string>>(new Set());

  // overrides locais para refletir escrita na hora (o cache do Meta demora).
  const [statusOv, setStatusOv] = useState<Record<string, boolean>>({});
  const [budgetOv, setBudgetOv] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();

  // diálogos
  const [confirm, setConfirm] = useState<{ row: ManagerRow; next: boolean } | null>(
    null,
  );
  const [editing, setEditing] = useState<ManagerRow | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [assistRow, setAssistRow] = useState<ManagerRow | null>(null);
  const [vetorRow, setVetorRow] = useState<ManagerRow | null>(null);
  const vetorMetrics = vetorRow?.vetor ?? null;

  // Colunas do funil: só as etapas que têm produto, na ordem do funil.
  const slotCols = FUNNEL_SLOTS.filter((s) =>
    funnel.some((f) => f.slot === s.key),
  );
  const productOf = (slot: FunnelSlot) =>
    funnel.find((f) => f.slot === slot)?.productName ?? "";
  /** Faturamento da etapa somado ao das anteriores — base do ROAS acumulado. */
  const cumulative = (r: ManagerRow, slot: FunnelSlot) => {
    let sum = 0;
    for (const s of FUNNEL_SLOTS) {
      sum += r.slots[s.key]?.revenue ?? 0;
      if (s.key === slot) break;
    }
    return sum;
  };

  const isActive = (r: ManagerRow) => statusOv[r.id] ?? r.status === "ACTIVE";
  const budgetOf = (r: ManagerRow) =>
    budgetOv[r.id] ?? (r.budgetCents != null ? r.budgetCents : null);

  const rows =
    level === "campaigns"
      ? campaigns
      : level === "adsets"
        ? selCampaigns.size
          ? adsets.filter((a) => a.campaignId && selCampaigns.has(a.campaignId))
          : adsets
        : selAdsets.size
          ? ads.filter((a) => a.adsetId && selAdsets.has(a.adsetId))
          : selCampaigns.size
            ? ads.filter((a) => a.campaignId && selCampaigns.has(a.campaignId))
            : ads;

  // As métricas do Vetor B chegam por ANÚNCIO — a coluna só faz sentido lá.
  const showVetor = level === "ads" && rows.some((r) => r.vetor);

  const selectable = level !== "ads";
  const isSelected = (r: ManagerRow) =>
    level === "campaigns"
      ? selCampaigns.has(r.id)
      : level === "adsets"
        ? selAdsets.has(r.id)
        : false;
  function toggleSel(r: ManagerRow) {
    if (level === "campaigns") setSelCampaigns((s) => toggleSet(s, r.id));
    else if (level === "adsets") setSelAdsets((s) => toggleSet(s, r.id));
  }

  function doToggle(row: ManagerRow, next: boolean) {
    setStatusOv((m) => ({ ...m, [row.id]: next }));
    startTransition(async () => {
      const r = await toggleObjectStatus(row.adAccountDbId, row.id, next);
      if (r.ok) toast.success(next ? "Ativado." : "Pausado.");
      else {
        setStatusOv((m) => ({ ...m, [row.id]: !next })); // reverte
        toast.error(r.message);
      }
    });
  }

  function doBudget(row: ManagerRow) {
    const reais = Number(budgetInput.replace(",", "."));
    if (!Number.isFinite(reais) || reais <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const r = await updateBudget(
        row.adAccountDbId,
        row.id,
        row.budgetType ?? "daily",
        reais,
      );
      if (r.ok) {
        setBudgetOv((m) => ({ ...m, [row.id]: Math.round(reais * 100) }));
        toast.success("Orçamento atualizado.");
        setEditing(null);
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <Tabs value={level} onValueChange={(v) => setLevel(v as Level)}>
        <TabsList>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="adsets">Conjuntos</TabsTrigger>
          <TabsTrigger value="ads">Anúncios</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filtro por seleção (múltipla) */}
      {level !== "campaigns" &&
      (selCampaigns.size > 0 || (level === "ads" && selAdsets.size > 0)) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Filtrando por:</span>
          {selCampaigns.size > 0 ? (
            <Badge variant="secondary" className="gap-1">
              {selCampaigns.size} campanha(s)
              <button
                onClick={() => setSelCampaigns(new Set())}
                aria-label="Limpar campanhas"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : null}
          {level === "ads" && selAdsets.size > 0 ? (
            <Badge variant="secondary" className="gap-1">
              {selAdsets.size} conjunto(s)
              <button
                onClick={() => setSelAdsets(new Set())}
                aria-label="Limpar conjuntos"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border hairline">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">Ativo</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead className="text-right">Orçamento</TableHead>
              <TableHead className="text-right">Investimento</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              {slotCols.map((s) => (
                <TableHead
                  key={s.key}
                  className="text-right"
                  title={`${productOf(s.key)} — faturamento da etapa e ROAS acumulado`}
                >
                  {s.short}
                </TableHead>
              ))}
              <TableHead className="text-right">Compras</TableHead>
              <TableHead className="text-right">Custo/compra</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-right">Assist.</TableHead>
              {showVetor ? <TableHead className="text-right">VSL</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9 + slotCols.length + (showVetor ? 1 : 0)}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nada aqui no período/seleção.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const budget = budgetOf(r);
                const cpa = r.orders > 0 ? r.spend / r.orders : null;
                const sel = isSelected(r);
                return (
                  <TableRow key={r.id} className={sel ? "bg-primary/5" : ""}>
                    <TableCell className="text-center">
                      <Switch
                        checked={isActive(r)}
                        disabled={pending}
                        aria-label={isActive(r) ? "Pausar" : "Ativar"}
                        onCheckedChange={(next) => setConfirm({ row: r, next })}
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="flex items-center gap-2">
                        {selectable ? (
                          <button
                            onClick={() => toggleSel(r)}
                            aria-label={sel ? "Desmarcar" : "Selecionar"}
                            title="Marcar para filtrar o nível abaixo"
                            className="shrink-0 text-muted-foreground hover:text-primary"
                          >
                            {sel ? (
                              <CheckSquare className="size-4 text-primary" />
                            ) : (
                              <Square className="size-4" />
                            )}
                          </button>
                        ) : null}
                        {selectable ? (
                          <button
                            onClick={() => toggleSel(r)}
                            className="block min-w-0 truncate text-left font-medium hover:underline"
                          >
                            {r.name}
                          </button>
                        ) : (
                          <span className="block min-w-0 truncate font-medium">
                            {r.name}
                          </span>
                        )}
                      </div>
                      {hasIssue(r) ? (
                        <div className="mt-1">
                          <StatusBadge row={r} />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {budget != null ? (
                        <button
                          onClick={() => {
                            setEditing(r);
                            setBudgetInput((budget / 100).toFixed(2));
                          }}
                          title="Editar orçamento"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {formatCurrency(budget / 100, currency)}
                          <Pencil className="size-3 text-muted-foreground" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatCurrency(r.spend, currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {r.revenue > 0 ? (
                        formatCurrency(r.revenue, currency)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {slotCols.map((sc) => {
                      const agg = r.slots[sc.key];
                      const acc = cumulative(r, sc.key);
                      return (
                        <TableCell
                          key={sc.key}
                          className="text-right font-mono text-sm tabular-nums"
                        >
                          {agg?.revenue ? (
                            <>
                              <span className="block">
                                {formatCurrency(agg.revenue, currency)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {r.spend > 0
                                  ? `${(acc / r.spend).toFixed(2)}x acum.`
                                  : "—"}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatNumber(r.orders)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {cpa != null ? formatCurrency(cpa, currency) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Roas revenue={r.revenue} spend={r.spend} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.assists > 0 ? (
                        <button
                          onClick={() => setAssistRow(r)}
                          className="font-mono text-sm tabular-nums text-primary hover:underline"
                          title="Ver caminho das conversões assistidas"
                        >
                          {formatNumber(r.assists)}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {showVetor ? (
                      <TableCell className="text-right">
                        {r.vetor ? (
                          <button
                            onClick={() => setVetorRow(r)}
                            className="font-mono text-sm tabular-nums text-primary hover:underline"
                            title="Métricas de criativo/VSL (Vetor B)"
                          >
                            {pct(r.vetor.hook_rate)}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Confirmação de ativar/pausar */}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.next ? "Ativar" : "Pausar"} no Meta?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso altera o status <strong>ao vivo</strong> de “{confirm?.row.name}
            ”. Confirmar?
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                if (confirm) doToggle(confirm.row, confirm.next);
                setConfirm(null);
              }}
            >
              {confirm?.next ? "Ativar" : "Pausar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Editar orçamento */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar orçamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{editing?.name}” —{" "}
            {editing?.budgetType === "lifetime" ? "vitalício" : "diário"}. Altera{" "}
            <strong>ao vivo</strong> no Meta.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">R$</span>
            <Input
              inputMode="decimal"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="w-32"
              autoFocus
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => editing && doBudget(editing)}
            >
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Métricas de criativo/VSL (Vetor B) */}
      <Dialog open={vetorRow !== null} onOpenChange={(o) => !o && setVetorRow(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate">
              VSL e criativo — {vetorRow?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Enviado pelo Vetor B e cruzado com o anúncio pelo nome. Dinheiro soma
            no período; taxas e custos são a média dos dias com dado
            {vetorMetrics
              ? ` (${vetorMetrics.days} dia(s), até ${vetorMetrics.lastDate})`
              : ""}
            . Faturamento, investimento e ROAS aqui são os números do Vetor B —
            os da tabela continuam vindo do Meta e do webhook de compra.
          </p>
          {vetorMetrics ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {VETOR_FIELDS.map((f) => (
                <div key={f.key} className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="font-mono tabular-nums">
                    {vetorValue(vetorMetrics, f, currency)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Assistências: caminho das conversões */}
      <Dialog
        open={assistRow !== null}
        onOpenChange={(o) => !o && setAssistRow(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate">
              Assistências — {assistRow?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Conversões em que “{assistRow?.name}” foi um toque anterior (não o
            último clique). Cada bloco é o caminho de um comprador (mesmo
            dispositivo).
          </p>
          <div className="space-y-2">
            {(assistRow?.assistPaths ?? []).map((path, i) => (
              <PathCard
                key={i}
                path={path}
                highlight={assistRow?.name ?? ""}
                currency={currency}
              />
            ))}
            {assistRow && assistRow.assists > assistRow.assistPaths.length ? (
              <p className="text-center text-xs text-muted-foreground">
                + {assistRow.assists - assistRow.assistPaths.length} outras (não
                exibidas)
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
