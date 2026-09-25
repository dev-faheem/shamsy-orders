/**
 * The order being built on the phone, and everything the screen derives from it.
 * Pure functions: the screen renders the result, the tests check it.
 */
import {
  computeLine,
  parseRate,
  parseUsdToCents,
  type DiscountThresholds,
  type LineResult,
} from "./money";
import type { PlaceOrderLine, PlaceOrderPayload } from "./outbox";

export interface DraftProduct {
  id: string;
  name: string;
  price_usd_cents: number;
}

interface DraftApproval {
  id: string;
  status: "pending" | "approved" | "rejected";
  customerId: string;
  productId: string;
  quantity: number;
  discountCents: number;
  unitPriceCents: number;
}

export interface DraftLine {
  key: string;
  productId: string;
  quantity: number;
  discountInput: string;
  /** Owner only: a price other than the catalogue price. */
  priceInput?: string;
  approval?: DraftApproval;
}

export interface Draft {
  clientRef: string;
  customerId: string;
  rateInput: string;
  lines: DraftLine[];
}

type ApprovalState = "not-needed" | "needed" | "pending" | "approved" | "rejected" | "stale";
type LineError = "unknown-product" | "discount-invalid" | "discount-too-big" | "price-invalid";
type Blocker = "customer" | "lines" | "rate" | "invalid" | "blocked";

export interface EvaluatedLine {
  line: DraftLine;
  product?: DraftProduct;
  unitPriceCents?: number;
  discountCents?: number;
  result?: LineResult;
  error?: LineError;
  approval: ApprovalState;
}

export interface Evaluation {
  rate: { ok: true; value: number } | { ok: false; reason: "invalid" | "below-min" };
  lines: EvaluatedLine[];
  totals: { usdCents: number; sdgPiastres: number } | null;
  blockers: Blocker[];
  payload: PlaceOrderPayload | null;
}

function approvalState(
  line: DraftLine,
  customerId: string,
  unitPriceCents: number,
  discountCents: number,
): ApprovalState {
  const a = line.approval;
  if (!a) return "needed";
  const matches =
    a.customerId === customerId &&
    a.productId === line.productId &&
    a.quantity === line.quantity &&
    a.discountCents === discountCents &&
    a.unitPriceCents === unitPriceCents;
  if (!matches) return "stale";
  return a.status;
}

export function evaluateDraft(
  draft: Draft,
  products: DraftProduct[],
  thresholds: DiscountThresholds,
  minRate: number,
): Evaluation {
  const parsedRate = parseRate(draft.rateInput);
  const rate: Evaluation["rate"] =
    parsedRate === null || parsedRate < 1
      ? { ok: false, reason: "invalid" }
      : parsedRate < minRate
        ? { ok: false, reason: "below-min" }
        : { ok: true, value: parsedRate };

  const lines: EvaluatedLine[] = draft.lines.map((line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return { line, error: "unknown-product", approval: "not-needed" };

    let unitPriceCents = product.price_usd_cents;
    if (line.priceInput !== undefined && line.priceInput.trim() !== "") {
      const p = parseUsdToCents(line.priceInput);
      if (p === null) return { line, product, error: "price-invalid", approval: "not-needed" };
      unitPriceCents = p;
    }

    const discountCents = parseUsdToCents(line.discountInput);
    if (discountCents === null) return { line, product, unitPriceCents, error: "discount-invalid", approval: "not-needed" };
    if (discountCents > unitPriceCents * line.quantity) {
      return { line, product, unitPriceCents, discountCents, error: "discount-too-big", approval: "not-needed" };
    }

    const result = computeLine({ unitPriceCents, quantity: line.quantity, discountCents }, thresholds);
    const approval =
      result.tier === "blocked" ? approvalState(line, draft.customerId, unitPriceCents, discountCents) : "not-needed";
    return { line, product, unitPriceCents, discountCents, result, approval };
  });

  const blockers: Blocker[] = [];
  if (!draft.customerId) blockers.push("customer");
  if (lines.length === 0) blockers.push("lines");
  if (!rate.ok) blockers.push("rate");
  if (lines.some((l) => l.error)) blockers.push("invalid");
  if (lines.some((l) => l.result?.tier === "blocked" && l.approval !== "approved")) blockers.push("blocked");

  const valid = lines.every((l) => l.result);
  const usdCents = valid ? lines.reduce((s, l) => s + l.result!.lineTotalCents, 0) : null;
  const totals =
    usdCents === null ? null : { usdCents, sdgPiastres: rate.ok ? usdCents * rate.value : 0 };

  const payload: PlaceOrderPayload | null =
    blockers.length === 0 && rate.ok
      ? {
          client_ref: draft.clientRef,
          customer_id: draft.customerId,
          rate: rate.value,
          lines: lines.map((l): PlaceOrderLine => {
            const out: PlaceOrderLine = {
              product_id: l.line.productId,
              quantity: l.line.quantity,
              discount_usd_cents: l.discountCents!,
            };
            if (l.unitPriceCents !== l.product!.price_usd_cents) out.unit_price_usd_cents = l.unitPriceCents;
            if (l.result!.tier === "blocked") out.approval_id = l.line.approval!.id;
            return out;
          }),
        }
      : null;

  return { rate, lines, totals, blockers, payload };
}
