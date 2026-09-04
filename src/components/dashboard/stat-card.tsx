import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Cartão de KPI (número tabular grande + rótulo; ícone opcional). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "text-primary",
  labelClassName,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  accent?: string;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <Card className="transition-[background-color,box-shadow] duration-200 hover:bg-card/70">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle
          className={cn(
            "text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground",
            labelClassName,
          )}
        >
          {label}
        </CardTitle>
        {Icon ? (
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-lg bg-foreground/[0.05]",
              accent,
            )}
          >
            <Icon className="size-3.5" />
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "num text-[30px] font-semibold leading-none",
            valueClassName,
          )}
        >
          {value}
        </div>
        {hint ? (
          <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
