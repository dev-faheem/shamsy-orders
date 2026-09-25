import { describe, expect, it } from "vitest";
import { evaluateDraft, type Draft, type DraftProduct } from "./order-draft";

const T = { sandMaxBp: 300, redMaxBp: 500 };
const products: DraftProduct[] = [
  { id: "spf", name: "SPF 6000 ES Plus", price_usd_cents: 51500 },
  { id: "h5", name: "Hope 5.0L-B1", price_usd_cents: 81000 },
  { id: "h16", name: "Hope 16.0LM-A1", price_usd_cents: 207000 },
];

function draft(over: Partial<Draft> = {}): Draft {
  return {
    clientRef: "ref",
    customerId: "c1",
    rateInput: "8,200",
    lines: [
      { key: "1", productId: "spf", quantity: 4, discountInput: "40" },
      { key: "2", productId: "h5", quantity: 2, discountInput: "70" },
    ],
    ...over,
  };
}

const line3 = { key: "3", productId: "h16", quantity: 1, discountInput: "150" };
const approvedFor = (over = {}) => ({
  id: "a1", status: "approved" as const, customerId: "c1", productId: "h16",
  quantity: 1, discountCents: 15000, unitPriceCents: 207000, ...over,
});

describe("evaluateDraft", () => {
  it("the worked example without line 3 can be saved: $3,570 / 29,274,000 SDG", () => {
    const e = evaluateDraft(draft(), products, T, 8000);
    expect(e.blockers).toEqual([]);
    expect(e.totals).toEqual({ usdCents: 357000, sdgPiastres: 2927400000 });
    expect(e.lines.map((l) => l.result?.tier)).toEqual(["sand", "red"]);
  });

  it("line 3 without approval blocks saving", () => {
    const e = evaluateDraft(draft({ lines: [...draft().lines, line3] }), products, T, 8000);
    expect(e.lines[2].approval).toBe("needed");
    expect(e.blockers).toEqual(["blocked"]);
  });

  it("line 3 waiting for the owner still blocks saving", () => {
    const e = evaluateDraft(
      draft({ lines: [...draft().lines, { ...line3, approval: approvedFor({ status: "pending" }) }] }),
      products, T, 8000,
    );
    expect(e.lines[2].approval).toBe("pending");
    expect(e.blockers).toEqual(["blocked"]);
  });

  it("line 3 approved: saves at $5,490 / 45,018,000 SDG and sends the approval id", () => {
    const e = evaluateDraft(draft({ lines: [...draft().lines, { ...line3, approval: approvedFor() }] }), products, T, 8000);
    expect(e.blockers).toEqual([]);
    expect(e.totals).toEqual({ usdCents: 549000, sdgPiastres: 4501800000 });
    expect(e.payload?.lines[2]).toEqual({ product_id: "h16", quantity: 1, discount_usd_cents: 15000, approval_id: "a1" });
  });

  it("an approval stops counting when the discount, quantity or dealer changes", () => {
    const more = evaluateDraft(
      draft({ lines: [{ ...line3, discountInput: "160", approval: approvedFor() }] }), products, T, 8000);
    expect(more.lines[0].approval).toBe("stale");
    const qty = evaluateDraft(draft({ lines: [{ ...line3, quantity: 2, discountInput: "300", approval: approvedFor() }] }), products, T, 8000);
    expect(qty.lines[0].approval).toBe("stale");
    const dealer = evaluateDraft(draft({ customerId: "c2", lines: [{ ...line3, approval: approvedFor() }] }), products, T, 8000);
    expect(dealer.lines[0].approval).toBe("stale");
    expect(dealer.blockers).toEqual(["blocked"]);
  });

  it("an approval is not sent for a line that no longer needs it", () => {
    const e = evaluateDraft(draft({ lines: [{ ...line3, discountInput: "20", approval: approvedFor() }] }), products, T, 8000);
    expect(e.lines[0].approval).toBe("not-needed");
    expect(e.payload?.lines[0]).toEqual({ product_id: "h16", quantity: 1, discount_usd_cents: 2000 });
  });

  it("a rate below the minimum blocks saving", () => {
    const e = evaluateDraft(draft({ rateInput: "7,900" }), products, T, 8000);
    expect(e.rate).toEqual({ ok: false, reason: "below-min" });
    expect(e.blockers).toEqual(["rate"]);
  });

  it("an unreadable rate or discount blocks saving", () => {
    expect(evaluateDraft(draft({ rateInput: "8.2k" }), products, T, 8000).rate).toEqual({ ok: false, reason: "invalid" });
    const bad = evaluateDraft(draft({ lines: [{ key: "1", productId: "spf", quantity: 1, discountInput: "4.555" }] }), products, T, 8000);
    expect(bad.lines[0].error).toBe("discount-invalid");
    expect(bad.blockers).toEqual(["invalid"]);
    const big = evaluateDraft(draft({ lines: [{ key: "1", productId: "spf", quantity: 1, discountInput: "600" }] }), products, T, 8000);
    expect(big.lines[0].error).toBe("discount-too-big");
  });

  it("needs a dealer and at least one line", () => {
    expect(evaluateDraft(draft({ customerId: "" }), products, T, 8000).blockers).toEqual(["customer"]);
    expect(evaluateDraft(draft({ lines: [] }), products, T, 8000).blockers).toEqual(["lines"]);
  });

  it("an owner price override is used and sent; without one no price is sent", () => {
    const e = evaluateDraft(
      draft({ lines: [{ key: "1", productId: "spf", quantity: 1, discountInput: "", priceInput: "500" }] }), products, T, 8000);
    expect(e.lines[0].unitPriceCents).toBe(50000);
    expect(e.payload?.lines[0]).toEqual({ product_id: "spf", quantity: 1, discount_usd_cents: 0, unit_price_usd_cents: 50000 });
    expect(evaluateDraft(draft(), products, T, 8000).payload?.lines[0]).not.toHaveProperty("unit_price_usd_cents");
  });

  it("a product that disappeared from the catalogue blocks saving", () => {
    const e = evaluateDraft(draft({ lines: [{ key: "1", productId: "gone", quantity: 1, discountInput: "" }] }), products, T, 8000);
    expect(e.lines[0].error).toBe("unknown-product");
    expect(e.blockers).toEqual(["invalid"]);
  });
});
