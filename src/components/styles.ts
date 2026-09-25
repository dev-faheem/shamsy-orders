import type { DiscountTier } from "@/lib/money";

/** The prototype's uppercase badges: "Bijbestellen" (sand), "Op" (red), "OK" (green). */
export const badgeStyle: Record<DiscountTier | "approved", string> = {
  none: "bg-panel text-ink-2",
  sand: "bg-sand text-sand-ink",
  red: "bg-red-badge text-red-ink",
  blocked: "bg-urgent text-white",
  approved: "bg-ok-badge text-ok-ink",
};

export const badgeCls = "inline-block whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.3px]";

export const inputCls =
  "w-full rounded-[3px] border border-line bg-white px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

export const buttonCls =
  "inline-flex items-center justify-center rounded-[3px] bg-brand px-4 py-2.5 font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50";

export const secondaryButtonCls =
  "inline-flex items-center justify-center rounded-[3px] border border-line bg-white px-4 py-2.5 font-semibold text-ink transition-colors hover:border-ink-2 disabled:opacity-50";
