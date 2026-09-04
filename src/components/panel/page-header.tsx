import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Cabeçalho padrão das páginas do painel. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.028em]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Aviso de seção ainda não construída (páginas de fases futuras). */
export function ComingSoon({ phase }: { phase: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed hairline p-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent-amber/12 text-accent-amber ring-1 ring-inset ring-accent-amber/20">
        <Construction className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Em construção</p>
        <p className="text-sm text-muted-foreground">
          Esta seção será implementada na {phase}.
        </p>
      </div>
      <Badge variant="warning">{phase}</Badge>
    </div>
  );
}
