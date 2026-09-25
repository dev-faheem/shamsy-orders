import { beforeAll, describe, expect, it } from "vitest";
import { createWorld, randomUUID, rawRpc, workedExampleLines } from "./harness";

type World = Awaited<ReturnType<typeof createWorld>>;
type Session = Awaited<ReturnType<World["signIn"]>>;

let w: World;
let adviser: Session;
let adviser2: Session;
let owner: Session;
let warehouse: Session;

beforeAll(async () => {
  w = await createWorld();
  [adviser, adviser2, owner, warehouse] = await Promise.all([
    w.signIn(w.users.adviser),
    w.signIn(w.users.adviser2),
    w.signIn(w.users.owner),
    w.signIn(w.users.warehouse),
  ]);
}, 60_000);

function placeOrder(s: Session, lines: unknown[], rate = 8200, clientRef = randomUUID(), customerId?: string) {
  return s.client.rpc("place_order", {
    p_client_ref: clientRef,
    p_customer_id: customerId ?? w.customer.id,
    p_rate: rate,
    p_lines: lines,
  });
}

describe("worked example", () => {
  it("as the adviser, without line 3: $3,570 = 29,274,000 SDG, and it saves", async () => {
    const { line1, line2 } = workedExampleLines(w);
    const { data, error } = await placeOrder(adviser, [line1, line2]);
    expect(error).toBeNull();
    expect(data.total_usd_cents).toBe(357000);
    expect(data.total_sdg_piastres).toBe(2927400000);
    expect(data.rate_sdg_per_usd).toBe(8200);
    expect(data.order_number).toMatch(/^SA-\d{4}$/);
    expect(data.lines.map((l: { discount_bp: number; discount_tier: string; line_total_usd_cents: number }) =>
      [l.discount_bp, l.discount_tier, l.line_total_usd_cents])).toEqual([
      [194, "sand", 202000],
      [432, "red", 155000],
    ]);
  });

  it("as the adviser, with line 3 and no approval: refused", async () => {
    const { line1, line2, line3 } = workedExampleLines(w);
    const { data, error } = await placeOrder(adviser, [line1, line2, line3]);
    expect(data).toBeNull();
    expect(error?.hint).toBe("DISCOUNT_NEEDS_APPROVAL");
    expect(error?.message).toContain("7.25%");
  });

  it("after the owner approves line 3: $5,490 = 45,018,000 SDG", async () => {
    const { line1, line2, line3 } = workedExampleLines(w);
    const req = await adviser.client.rpc("request_discount_approval", {
      p_customer_id: w.customer.id,
      p_product_id: line3.product_id,
      p_quantity: line3.quantity,
      p_discount_usd_cents: line3.discount_usd_cents,
    });
    expect(req.error).toBeNull();
    expect(req.data.status).toBe("pending");

    // Still pending → still refused.
    const early = await placeOrder(adviser, [line1, line2, { ...line3, approval_id: req.data.id }]);
    expect(early.error?.hint).toBe("APPROVAL_INVALID");

    const decided = await owner.client.rpc("decide_discount_approval", { p_approval_id: req.data.id, p_approve: true });
    expect(decided.error).toBeNull();

    const { data, error } = await placeOrder(adviser, [line1, line2, { ...line3, approval_id: req.data.id }]);
    expect(error).toBeNull();
    expect(data.total_usd_cents).toBe(549000);
    expect(data.total_sdg_piastres).toBe(4501800000);
    expect(data.lines[2]).toMatchObject({ discount_bp: 725, discount_tier: "blocked", approved_by: owner.id });

    // One approval, one line: it cannot be reused for a second order.
    const again = await placeOrder(adviser, [{ ...line3, approval_id: req.data.id }]);
    expect(again.error?.hint).toBe("APPROVAL_INVALID");
  });

  it("change the rate setting to 9,000: the saved order still shows 8,200 and 45,018,000 SDG", async () => {
    const { line1, line2, line3 } = workedExampleLines(w);
    const ok = await owner.client.rpc("request_discount_approval", {
      p_customer_id: w.customer.id,
      p_product_id: line3.product_id,
      p_quantity: 1,
      p_discount_usd_cents: 15000,
    });
    expect(ok.data.status).toBe("approved"); // the owner's own approval is immediate
    const saved = await placeOrder(owner, [line1, line2, { ...line3, approval_id: ok.data.id }]);
    expect(saved.error).toBeNull();

    const rates = await owner.client.rpc("set_rates", { p_day_rate: 9000, p_min_rate: 8000 });
    expect(rates.error).toBeNull();

    const reopened = await owner.client.rpc("order_json", { p_order_id: saved.data.id });
    expect(reopened.data.rate_sdg_per_usd).toBe(8200);
    expect(reopened.data.total_usd_cents).toBe(549000);
    expect(reopened.data.total_sdg_piastres).toBe(4501800000);

    await owner.client.rpc("set_rates", { p_day_rate: 8200, p_min_rate: 8000 });
  });

  it("a rate of 7,900 is refused", async () => {
    const { line1 } = workedExampleLines(w);
    const { error } = await placeOrder(adviser, [line1], 7900);
    expect(error?.hint).toBe("RATE_BELOW_MINIMUM");
  });
});

describe("the 5% block cannot be bypassed", () => {
  it("is refused over raw HTTP with the adviser's token", async () => {
    const { line3 } = workedExampleLines(w);
    const res = await rawRpc(adviser.token, "place_order", {
      p_client_ref: randomUUID(),
      p_customer_id: w.customer.id,
      p_rate: 8200,
      p_lines: [line3],
    });
    expect(res.status).toBe(400);
    expect(res.body.hint).toBe("DISCOUNT_NEEDS_APPROVAL");
  });

  it("is refused when the adviser claims the line is not blocked", async () => {
    const { line3 } = workedExampleLines(w);
    const { error } = await placeOrder(adviser, [{ ...line3, discount_tier: "sand", discount_bp: 100 }]);
    expect(error?.hint).toBe("DISCOUNT_NEEDS_APPROVAL");
  });

  it("is refused when the adviser invents an approval id", async () => {
    const { line3 } = workedExampleLines(w);
    const { error } = await placeOrder(adviser, [{ ...line3, approval_id: randomUUID() }]);
    expect(error?.hint).toBe("APPROVAL_INVALID");
  });

  it("is refused when an approval is used for a bigger discount than was approved", async () => {
    const req = await owner.client.rpc("request_discount_approval", {
      p_customer_id: w.customer.id, p_product_id: w.hope16.id, p_quantity: 1, p_discount_usd_cents: 15000,
    });
    const { error } = await placeOrder(owner, [
      { product_id: w.hope16.id, quantity: 1, discount_usd_cents: 30000, approval_id: req.data.id },
    ]);
    expect(error?.hint).toBe("APPROVAL_INVALID");
  });

  it("is refused when another adviser's approval is borrowed", async () => {
    const req = await adviser2.client.rpc("request_discount_approval", {
      p_customer_id: w.customer.id, p_product_id: w.hope16.id, p_quantity: 1, p_discount_usd_cents: 15000,
    });
    await owner.client.rpc("decide_discount_approval", { p_approval_id: req.data.id, p_approve: true });
    const { error } = await placeOrder(adviser, [
      { product_id: w.hope16.id, quantity: 1, discount_usd_cents: 15000, approval_id: req.data.id },
    ]);
    expect(error?.hint).toBe("APPROVAL_INVALID");
  });

  it("the adviser cannot approve her own request", async () => {
    const req = await adviser.client.rpc("request_discount_approval", {
      p_customer_id: w.customer.id, p_product_id: w.hope16.id, p_quantity: 1, p_discount_usd_cents: 15000,
    });
    const { error } = await adviser.client.rpc("decide_discount_approval", { p_approval_id: req.data.id, p_approve: true });
    expect(error?.hint).toBe("FORBIDDEN");
  });

  it("the adviser cannot write to the tables directly", async () => {
    const order = await adviser.client.from("orders").insert({
      tenant_id: w.tenantId, order_number: "SA-9999", client_ref: randomUUID(), customer_id: w.customer.id,
      adviser_id: adviser.id, rate_sdg_per_usd: 8200, total_usd_cents: 192000, total_sdg_piastres: 192000 * 8200,
    });
    expect(order.error?.code).toBe("42501"); // permission denied
    const approval = await adviser.client.from("discount_approvals").insert({
      tenant_id: w.tenantId, requested_by: adviser.id, customer_id: w.customer.id, product_id: w.hope16.id,
      quantity: 1, unit_price_usd_cents: 207000, discount_usd_cents: 15000, discount_bp: 725,
      status: "approved", decided_by: adviser.id, decided_at: new Date().toISOString(),
    });
    expect(approval.error?.code).toBe("42501");
  });

  describe("even with the secret key, skipping place_order", () => {
    // Direct inserts with the service-role key, as a buggy back-office script might do.
    // Each is a single statement, so it runs in its own transaction and the deferred
    // total check fires at the end of it.
    async function insertOrder(order: Record<string, unknown>) {
      return w.admin.from("orders").insert({
        tenant_id: w.tenantId, order_number: `XX-${randomUUID().slice(0, 6)}`, client_ref: randomUUID(),
        customer_id: w.customer.id, adviser_id: adviser.id, rate_sdg_per_usd: 8200,
        total_usd_cents: 192000, total_sdg_piastres: 192000 * 8200, ...order,
      });
    }
    const blockedLine = {
      tenant_id: undefined as unknown as string, line_no: 1, product_name: "x",
      unit_price_usd_cents: 207000, catalogue_price_usd_cents: 207000, quantity: 1,
      line_value_usd_cents: 207000, discount_usd_cents: 15000, discount_bp: 725, line_total_usd_cents: 192000,
    };

    it("an order below the minimum rate is refused by the rate rule", async () => {
      const { error } = await insertOrder({ rate_sdg_per_usd: 7900, total_sdg_piastres: 192000 * 7900 });
      expect(error?.hint).toBe("RATE_BELOW_MINIMUM");
    });

    it("an order without lines is refused by the total rule", async () => {
      const { error } = await insertOrder({});
      expect(error?.hint).toBe("EMPTY_ORDER");
    });

    it("a 7.25% line labelled 'red' is refused by the discount rule", async () => {
      const orderId = randomUUID();
      // Order and line in one request would need a transaction; the line alone must also be refused.
      const { error } = await w.admin.from("order_lines").insert({
        ...blockedLine, order_id: orderId, tenant_id: w.tenantId, product_id: w.hope16.id, discount_tier: "red",
      });
      expect(error).not.toBeNull();
      expect(error?.message).not.toContain("permission denied");
    });

    it("a 7.25% line on a real order, without approval, is refused by the discount rule", async () => {
      const saved = await placeOrder(owner, [workedExampleLines(w).line1]);
      const { error } = await w.admin.from("order_lines").insert({
        ...blockedLine, order_id: saved.data.id, tenant_id: w.tenantId, product_id: w.hope16.id,
        line_no: 2, discount_tier: "red",
      });
      expect(error?.hint).toBe("INVALID_LINE");
    });
  });
});

describe("prices, rates and permissions", () => {
  it("the adviser cannot change a price in the order", async () => {
    const { error } = await placeOrder(adviser, [
      { product_id: w.spf6000.id, quantity: 1, discount_usd_cents: 0, unit_price_usd_cents: 100 },
    ]);
    expect(error?.hint).toBe("PRICE_LOCKED");
  });

  it("the owner can override a price on a line, and the line records both prices", async () => {
    const { data, error } = await placeOrder(owner, [
      { product_id: w.spf6000.id, quantity: 1, discount_usd_cents: 0, unit_price_usd_cents: 50000 },
    ]);
    expect(error).toBeNull();
    expect(data.lines[0]).toMatchObject({ unit_price_usd_cents: 50000, catalogue_price_usd_cents: 51500 });
  });

  it("the adviser cannot change the rate settings or a catalogue price", async () => {
    const rates = await adviser.client.rpc("set_rates", { p_day_rate: 9000, p_min_rate: 1 });
    expect(rates.error?.hint).toBe("FORBIDDEN");
    const price = await adviser.client.rpc("set_product_price", { p_product_id: w.spf6000.id, p_price_usd_cents: 1 });
    expect(price.error?.hint).toBe("FORBIDDEN");
    const direct = await adviser.client.from("settings").update({ min_rate_sdg_per_usd: 1 }).eq("tenant_id", w.tenantId).select();
    expect(direct.error?.code ?? (direct.data?.length === 0 ? "no rows" : "updated")).not.toBe("updated");
  });

  it("the minimum rate is a setting: raising it to 8,500 refuses 8,200", async () => {
    await owner.client.rpc("set_rates", { p_day_rate: 8500, p_min_rate: 8500 });
    const { error } = await placeOrder(adviser, [workedExampleLines(w).line1], 8200);
    expect(error?.hint).toBe("RATE_BELOW_MINIMUM");
    await owner.client.rpc("set_rates", { p_day_rate: 8200, p_min_rate: 8000 });
  });

  it("the warehouse cannot record orders", async () => {
    const { error } = await placeOrder(warehouse, [workedExampleLines(w).line1]);
    expect(error?.hint).toBe("FORBIDDEN");
  });

  it("the discount boundaries are exact: 3.00% is sand, 5.00% is red and saves", async () => {
    // $515 × 4 = $2,060. 3% = $61.80, 5% = $103.00.
    const { data, error } = await placeOrder(adviser, [
      { product_id: w.spf6000.id, quantity: 4, discount_usd_cents: 6180 },
      { product_id: w.spf6000.id, quantity: 4, discount_usd_cents: 10300 },
    ]);
    expect(error).toBeNull();
    expect(data.lines.map((l: { discount_tier: string }) => l.discount_tier)).toEqual(["sand", "red"]);
    const over = await placeOrder(adviser, [{ product_id: w.spf6000.id, quantity: 4, discount_usd_cents: 10301 }]);
    expect(over.error?.hint).toBe("DISCOUNT_NEEDS_APPROVAL");
  });

  it("refuses fractional cents, fractional quantities and discounts larger than the line", async () => {
    const frac = await placeOrder(adviser, [{ product_id: w.spf6000.id, quantity: 1, discount_usd_cents: 10.5 }]);
    expect(frac.error?.hint).toBe("INVALID_INPUT");
    const qty = await placeOrder(adviser, [{ product_id: w.spf6000.id, quantity: 1.5, discount_usd_cents: 0 }]);
    expect(qty.error?.hint).toBe("INVALID_INPUT");
    const big = await placeOrder(adviser, [{ product_id: w.spf6000.id, quantity: 1, discount_usd_cents: 51501 }]);
    expect(big.error?.hint).toBe("INVALID_INPUT");
  });
});

describe("a saved order never changes", () => {
  it("cannot be updated or deleted — not even with the secret key", async () => {
    const { data } = await placeOrder(adviser, [workedExampleLines(w).line1]);
    const upd = await w.admin.from("orders").update({ rate_sdg_per_usd: 9000 }).eq("id", data.id);
    expect(upd.error?.hint).toBe("ORDER_IMMUTABLE");
    const del = await w.admin.from("order_lines").delete().eq("order_id", data.id);
    expect(del.error?.hint).toBe("ORDER_IMMUTABLE");
    const after = await adviser.client.rpc("order_json", { p_order_id: data.id });
    expect(after.data.rate_sdg_per_usd).toBe(8200);
  });

  it("saving the same order twice (a retry after a dropped connection) stores it once", async () => {
    const ref = randomUUID();
    const first = await placeOrder(adviser, [workedExampleLines(w).line1], 8200, ref);
    const second = await placeOrder(adviser, [workedExampleLines(w).line1], 8200, ref);
    expect(second.error).toBeNull();
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.replayed).toBe(true);
  });
});

describe("visibility", () => {
  it("an adviser sees her own orders, not her colleague's", async () => {
    const mine = await placeOrder(adviser2, [workedExampleLines(w).line1]);
    const seenByAdviser = await adviser.client.from("orders").select("id").eq("id", mine.data.id);
    expect(seenByAdviser.data).toEqual([]);
    const seenByOwner = await owner.client.from("orders").select("id").eq("id", mine.data.id);
    expect(seenByOwner.data).toHaveLength(1);
  });

  it("another tenant's data is invisible", async () => {
    const other = await createWorld();
    const stranger = await other.signIn(other.users.owner);
    const { data } = await stranger.client.from("orders").select("id").eq("tenant_id", w.tenantId);
    expect(data).toEqual([]);
    const { error } = await placeOrder(stranger, [workedExampleLines(w).line1]);
    expect(error?.hint).toBe("INVALID_INPUT"); // our customer does not exist in their environment
  }, 60_000);

  it("nobody can call the API without signing in", async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/place_order`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ p_client_ref: randomUUID(), p_customer_id: w.customer.id, p_rate: 8200, p_lines: [] }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
