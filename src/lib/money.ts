/**
 * Money arithmetic for orders. Every amount is an integer in the smallest unit:
 * US cents for dollars, piastres (1/100 SDG) for pounds. No floating point anywhere,
 * so the browser preview and the database always agree to the last piastre.
 *
 * The database (supabase/migrations) repeats these rules and is the authority;
 * this module only drives the on-screen preview.
 */

export type DiscountTier = "none" | "sand" | "red" | "blocked";

/** Upper bounds in basis points (1 bp = 0.01%). A discount exactly on a bound belongs to the lower tier. */
export interface DiscountThresholds {
  sandMaxBp: number;
  redMaxBp: number;
}

export interface LineInput {
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
}

export interface LineResult {
  lineValueCents: number;
  discountCents: number;
  discountBp: number;
  tier: DiscountTier;
  lineTotalCents: number;
}

export interface OrderResult {
  lines: LineResult[];
  totalUsdCents: number;
  totalSdgPiastres: number;
  blockedLineIndexes: number[];
}

const USD_PATTERN = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;
const RATE_PATTERN = /^\d{1,3}(,\d{3})*$|^\d+$/;

/** "2,070.55" → 207055. Blank → 0. Anything else (negatives, 3 decimals, dates) → null. */
export function parseUsdToCents(input: string): number | null {
  const s = input.trim();
  if (s === "") return 0;
  if (!USD_PATTERN.test(s)) return null;
  const [whole, frac = ""] = s.replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Whole SDG per USD. "8,200" → 8200. */
export function parseRate(input: string): number | null {
  const s = input.trim();
  if (!RATE_PATTERN.test(s)) return null;
  const rate = Number(s.replace(/,/g, ""));
  return Number.isSafeInteger(rate) ? rate : null;
}

/** Discount as basis points of the line value, rounded half up. For display only. */
export function discountBasisPoints(discountCents: number, lineValueCents: number): number {
  if (lineValueCents === 0) return 0;
  // Integer rounding: floor((2·d·10000 + v) / (2·v)).
  return Math.floor((2 * discountCents * 10000 + lineValueCents) / (2 * lineValueCents));
}

/** Tier decided by exact cross-multiplication on cents, never on the rounded percentage. */
export function discountTier(
  discountCents: number,
  lineValueCents: number,
  t: DiscountThresholds,
): DiscountTier {
  if (discountCents <= 0) return "none";
  const scaled = discountCents * 10000;
  if (scaled <= lineValueCents * t.sandMaxBp) return "sand";
  if (scaled <= lineValueCents * t.redMaxBp) return "red";
  return "blocked";
}

export function computeLine(line: LineInput, t: DiscountThresholds): LineResult {
  const { unitPriceCents, quantity, discountCents } = line;
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError("Quantity must be a whole number of at least 1");
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new RangeError("Invalid price");
  if (!Number.isSafeInteger(discountCents) || discountCents < 0) throw new RangeError("Invalid discount");
  const lineValueCents = unitPriceCents * quantity;
  if (discountCents > lineValueCents) throw new RangeError("Discount cannot exceed the line value");
  return {
    lineValueCents,
    discountCents,
    discountBp: discountBasisPoints(discountCents, lineValueCents),
    tier: discountTier(discountCents, lineValueCents, t),
    lineTotalCents: lineValueCents - discountCents,
  };
}

export function computeOrder(lines: LineInput[], rateSdgPerUsd: number, t: DiscountThresholds): OrderResult {
  const results = lines.map((l) => computeLine(l, t));
  const totalUsdCents = results.reduce((sum, l) => sum + l.lineTotalCents, 0);
  return {
    lines: results,
    totalUsdCents,
    // cents × (SDG per USD) = piastres, exactly.
    totalSdgPiastres: totalUsdCents * rateSdgPerUsd,
    blockedLineIndexes: results.flatMap((l, i) => (l.tier === "blocked" ? [i] : [])),
  };
}

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return sign + group(whole) + (frac ? "." + String(frac).padStart(2, "0") : "");
}

export function formatUsd(cents: number): string {
  const s = formatMinor(cents);
  return s.startsWith("-") ? "-$" + s.slice(1) : "$" + s;
}

export function formatSdg(piastres: number): string {
  return formatMinor(piastres) + " SDG";
}

export function formatRate(rate: number): string {
  return group(rate);
}

export function formatPercent(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}%`;
}
