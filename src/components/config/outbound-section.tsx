"use client";

import { Eye, Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import {
  previewOutboundPayload,
  saveOutboundSettings,
  sendOutboundNow,
} from "@/app/(panel)/dashboard/config/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { formatDateTime } from "@/lib/format";
import type { OutboundConfig, OutboundRun } from "@/lib/outbound/send";

/** Horas cheias — é a granularidade do cron (ele bate de hora em hora). */
const HOURS = Array.from(
  { length: 24 },
  (_, h) => `${String(h).padStart(2, "0")}:00`,
);

/**
 * Webhook de SAÍDA: a URL do outro sistema do cliente, que recebe as métricas
 * por anúncio nos horários escolhidos.
 */
export function OutboundSection({
  config,
  runs,
}: {
  config: OutboundConfig;
  runs: OutboundRun[];
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [url, setUrl] = useState(config.url);
  const [header, setHeader] = useState(config.header);
  const [times, setTimes] = useState<string[]>(() => {
    const t = [...config.times];
    while (t.length < 3) t.push(HOURS[(t.length * 8) % 24]);
    return t.slice(0, 3);
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sending, startSend] = useTransition();
  const [loadingPreview, startPreview] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await saveOutboundSettings(null, formData);
      if (res?.ok) toast.success("Envio configurado.");
      else if (res?.error) toast.error(res.error);
    });
  }

  function sendNow() {
    startSend(async () => {
      try {
        const r = await sendOutboundNow();
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha no envio.");
      }
    });
  }

  function showPreview() {
    startPreview(async () => {
      try {
        const r = await previewOutboundPayload();
        setPreview(r.json);
        if (!r.ok) toast.error("Não foi possível montar o payload.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha na prévia.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Webhook de saída — a URL do seu sistema de criativos
          </CardTitle>
          <CardDescription>
            Cole aqui a URL do webhook que o seu outro sistema fornece. Nos
            horários escolhidos, este painel faz um <code>POST</code> nela com{" "}
            <code>{`{ "ads": [ … ] }`}</code> — um objeto por anúncio, com o{" "}
            <strong>nome exato do anúncio</strong> no Meta. Investimento, CPM e
            CPC vêm do Meta Ads; faturamento, ROAS e faturamento de back-end das
            compras do webhook (por UTM); custo por IC e conversão de checkout
            dos eventos. Campo sem dado é <strong>omitido</strong> — o seu
            sistema ignora o que não vier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onSubmit} className="space-y-5">
            <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />
            {times.map((t, i) => (
              <input key={`t${i}`} type="hidden" name="times" value={t} />
            ))}

            <div className="flex items-center justify-between gap-4 rounded-md border hairline p-3">
              <div className="space-y-0.5">
                <Label htmlFor="out_enabled">Envio automático</Label>
                <p className="text-xs text-muted-foreground">
                  Desligado, nada sai — o botão “Enviar agora” continua
                  funcionando para testar.
                </p>
              </div>
              <Switch
                id="out_enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Ligar envio automático"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="out_url">URL do webhook (destino)</Label>
              <Input
                id="out_url"
                name="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://seusistema.com/webhooks/metricas"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                É a URL que o seu sistema de criativos mostra como “webhook”.
                Precisa aceitar <code>POST</code> com corpo JSON e responder 2xx.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="out_header">Cabeçalho de autenticação</Label>
                <Input
                  id="out_header"
                  name="header"
                  value={header}
                  onChange={(e) => setHeader(e.target.value)}
                  placeholder="x-webhook-token"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="out_secret">Token que vai nesse cabeçalho</Label>
                <Input
                  id="out_secret"
                  name="secret"
                  type="password"
                  placeholder={
                    config.secretMask
                      ? `salvo (${config.secretMask}) — digite para trocar`
                      : "opcional, se o seu sistema exigir"
                  }
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Horários do envio (fuso de São Paulo)</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {times.map((t, i) => (
                  <Select
                    key={`sel${i}`}
                    value={t}
                    onValueChange={(v) =>
                      setTimes((cur) => cur.map((x, j) => (j === i ? v : x)))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Três envios por dia, sempre na hora cheia. Cada envio leva o dia
                inteiro até aquele momento — o seu sistema recebe o mesmo dia
                três vezes, cada vez mais completo.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Salvar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={sendNow}
                disabled={sending || !config.url}
                title={config.url ? "Envia agora" : "Salve a URL primeiro"}
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Enviar agora
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={showPreview}
                disabled={loadingPreview}
              >
                {loadingPreview ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Eye className="size-4" />
                )}
                Ver o que será enviado
              </Button>
            </div>
          </form>

          {preview ? (
            <pre className="mt-4 max-h-80 overflow-auto rounded-md border hairline bg-background/60 p-3 font-mono text-xs leading-relaxed">
              {preview}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimos envios</CardTitle>
          <CardDescription>
            Cada tentativa fica registrada — inclusive as que falharam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum envio ainda.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {runs.map((r) => (
                <li
                  key={`${r.created_at}-${r.slot}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(r.created_at)} · {r.slot}
                  </span>
                  <span
                    className={
                      r.ok ? "text-xs text-success" : "text-xs text-destructive"
                    }
                  >
                    {r.ok
                      ? `${r.ads_count ?? 0} anúncio(s) · HTTP ${r.http_status ?? 200}`
                      : (r.message ?? `erro ${r.http_status ?? ""}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
