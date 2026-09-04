// Etapas do funil de venda. A ORDEM deste array é a ordem do funil: o ROAS de
// cada etapa é acumulado (front → front+upsell 01 → front+upsell 01+02 → …).
// Cada etapa recebe UM produto na tela Configurações → Funil, e cada produto
// ocupa no máximo uma etapa (índice único em product_settings.funnel_slot).

export const FUNNEL_SLOTS = [
  { key: "front", label: "Produto principal", short: "Principal" },
  { key: "upsell_01", label: "Upsell 01", short: "Upsell 01" },
  { key: "upsell_02", label: "Upsell 02", short: "Upsell 02" },
  { key: "webinar_01", label: "Webinar 01", short: "Webinar 01" },
  { key: "webinar_02", label: "Webinar 02", short: "Webinar 02" },
  { key: "webinar_03", label: "Webinar 03", short: "Webinar 03" },
] as const;

export type FunnelSlot = (typeof FUNNEL_SLOTS)[number]["key"];

export const FUNNEL_SLOT_KEYS = FUNNEL_SLOTS.map((s) => s.key) as FunnelSlot[];

export function isFunnelSlot(v: unknown): v is FunnelSlot {
  return typeof v === "string" && (FUNNEL_SLOT_KEYS as string[]).includes(v);
}

export function funnelSlotLabel(slot: FunnelSlot): string {
  return FUNNEL_SLOTS.find((s) => s.key === slot)?.label ?? slot;
}

/** Etapas até (e incluindo) a informada — a base do ROAS acumulado. */
export function slotsUpTo(slot: FunnelSlot): FunnelSlot[] {
  const i = FUNNEL_SLOT_KEYS.indexOf(slot);
  return i < 0 ? [] : FUNNEL_SLOT_KEYS.slice(0, i + 1);
}
