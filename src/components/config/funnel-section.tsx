"use client";

import { Layers } from "lucide-react";
import { useState, useTransition } from "react";
import { setFunnelSlot } from "@/app/(panel)/dashboard/config/actions";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import type { ProductRow } from "@/lib/config/products";
import { FUNNEL_SLOTS, type FunnelSlot } from "@/lib/funnel";
import { formatCurrency, formatNumber } from "@/lib/format";

const NONE = "__none__";

/**
 * Monta o funil: cada etapa recebe um produto já vendido. A tela de Campanhas
 * usa esse mapa para mostrar faturamento por etapa e o ROAS acumulado
 * (principal → principal+upsell 01 → …).
 */
export function FunnelSection({ products }: { products: ProductRow[] }) {
  // Espelho local do que está salvo, para a tela responder na hora.
  const [assigned, setAssigned] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of products) if (p.funnel_slot) init[p.funnel_slot] = p.key;
    return init;
  });
  const [pending, startTransition] = useTransition();

  function choose(slot: FunnelSlot, value: string) {
    const key = value === NONE ? null : value;
    const previous = assigned;
    setAssigned((cur) => {
      const next = { ...cur };
      // Um produto só ocupa uma etapa: tira ele de onde estava.
      for (const s of Object.keys(next)) if (key && next[s] === key) delete next[s];
      if (key) next[slot] = key;
      else delete next[slot];
      return next;
    });
    startTransition(async () => {
      try {
        const name = products.find((p) => p.key === key)?.name ?? null;
        await setFunnelSlot(slot, key, name);
        toast.success(key ? "Etapa atualizada." : "Etapa esvaziada.");
      } catch (e) {
        setAssigned(previous); // reverte
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-semibold">Funil</h2>
        <p className="text-sm text-muted-foreground">
          Escolha qual produto é cada etapa. Em <strong>Campanhas</strong>, cada
          etapa vira uma coluna com o faturamento daquele produto e o{" "}
          <strong>ROAS acumulado</strong> — o da etapa somada às anteriores
          (principal, principal+upsell 01, e assim por diante). A lista mostra os
          produtos que já venderam pelo menos uma vez.
        </p>
      </div>

      {products.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <Layers className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Os produtos aparecem aqui depois da primeira venda registrada.
          </p>
        </Card>
      ) : (
        <Card variant="solid" className="divide-y divide-border/60">
          {FUNNEL_SLOTS.map((slot) => {
            const current = assigned[slot.key] ?? NONE;
            const product = products.find((p) => p.key === assigned[slot.key]);
            return (
              <div
                key={slot.key}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <span className="block font-medium">{slot.label}</span>
                  {product ? (
                    <p className="font-mono text-xs text-muted-foreground tabular-nums">
                      {formatNumber(product.sales)} vendas ·{" "}
                      {formatCurrency(product.revenue)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem produto — a coluna não aparece em Campanhas.
                    </p>
                  )}
                </div>
                <Select
                  value={current}
                  disabled={pending}
                  onValueChange={(v) => choose(slot.key, v)}
                >
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue placeholder="Nenhum produto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum produto</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
