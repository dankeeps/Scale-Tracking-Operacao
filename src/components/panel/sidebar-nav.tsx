"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/components/panel/nav-items";
import { cn } from "@/lib/utils";

/** Lista de links do painel, com destaque do item ativo. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        // "Visão geral" só ativa no match exato; demais por prefixo.
        const active =
          href === "/dashboard"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium",
              "transition-[background-color,color] duration-150",
              "min-h-11", // área de toque confortável no mobile
              active
                ? "bg-foreground/[0.07] text-foreground shadow-[inset_0_1px_0_hsl(var(--hairline)/0.06)]"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                active ? "text-primary" : "text-muted-foreground",
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
