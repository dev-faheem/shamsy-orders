import { beforeEach, describe, expect, it } from "vitest";
import { Outbox, type KeyValueStore, type PlaceOrderPayload, type SendResult } from "./outbox";

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const payload = (ref: string): PlaceOrderPayload => ({
  client_ref: ref,
  customer_id: "c1",
  rate: 8200,
  lines: [{ product_id: "p1", quantity: 4, discount_usd_cents: 4000 }],
});

describe("Outbox", () => {
  let store: MemoryStore;
  let outbox: Outbox;
  beforeEach(() => {
    store = new MemoryStore();
    outbox = new Outbox(store, "user-1");
  });

  it("keeps an order on the phone before it is sent, so closing the app loses nothing", async () => {
    let seenInStoreDuringSend = false;
    await outbox.submit(payload("a"), async () => {
      seenInStoreDuringSend = new Outbox(store, "user-1").list().some((i) => i.payload.client_ref === "a");
      return { kind: "network" };
    });
    expect(seenInStoreDuringSend).toBe(true);
  });

  it("removes the order once the server has stored it", async () => {
    const r = await outbox.submit(payload("a"), async () => ({ kind: "ok", order: { id: "o1" } }));
    expect(r).toEqual({ kind: "saved", order: { id: "o1" } });
    expect(outbox.list()).toEqual([]);
  });

  it("queues the order when the connection drops", async () => {
    const r = await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    expect(r).toEqual({ kind: "queued" });
    expect(outbox.list()).toMatchObject([{ status: "pending", payload: { client_ref: "a" } }]);
  });

  it("does not queue an order the server refused, and reports why", async () => {
    const r = await outbox.submit(payload("a"), async () => ({
      kind: "rejected",
      code: "DISCOUNT_NEEDS_APPROVAL",
      message: "no",
    }));
    expect(r).toEqual({ kind: "rejected", code: "DISCOUNT_NEEDS_APPROVAL", message: "no" });
    expect(outbox.list()).toEqual([]);
  });

  it("sync sends queued orders in order and removes the ones that succeed", async () => {
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    await outbox.submit(payload("b"), async () => ({ kind: "network" }));
    const sent: string[] = [];
    const result = await outbox.sync(async (p) => {
      sent.push(p.client_ref);
      return { kind: "ok", order: { id: p.client_ref } };
    });
    expect(sent).toEqual(["a", "b"]);
    expect(result.synced).toBe(2);
    expect(outbox.list()).toEqual([]);
  });

  it("sync stops at the first network failure and keeps the rest", async () => {
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    await outbox.submit(payload("b"), async () => ({ kind: "network" }));
    const sent: string[] = [];
    await outbox.sync(async (p): Promise<SendResult> => {
      sent.push(p.client_ref);
      return { kind: "network" };
    });
    expect(sent).toEqual(["a"]);
    expect(outbox.list().map((i) => i.status)).toEqual(["pending", "pending"]);
  });

  it("a queued order the server later refuses is kept as failed, never silently dropped", async () => {
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    await outbox.sync(async () => ({ kind: "rejected", code: "RATE_BELOW_MINIMUM", message: "min is 8,500" }));
    expect(outbox.list()).toMatchObject([
      { status: "failed", error: { code: "RATE_BELOW_MINIMUM", message: "min is 8,500" } },
    ]);
    // Failed items are not retried automatically.
    let called = false;
    await outbox.sync(async () => {
      called = true;
      return { kind: "ok", order: {} };
    });
    expect(called).toBe(false);
  });

  it("the same order is never queued twice", async () => {
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    expect(outbox.list()).toHaveLength(1);
  });

  it("keeps each user's queue separate on a shared phone", async () => {
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    expect(new Outbox(store, "user-2").list()).toEqual([]);
  });

  it("survives corrupt storage", () => {
    store.setItem("shamsy.outbox.user-1", "{not json");
    expect(new Outbox(store, "user-1").list()).toEqual([]);
  });

  it("a failed item can be dismissed", async () => {
    await outbox.submit(payload("a"), async () => ({ kind: "network" }));
    await outbox.sync(async () => ({ kind: "rejected", code: "X", message: "x" }));
    outbox.remove("a");
    expect(outbox.list()).toEqual([]);
  });
});
