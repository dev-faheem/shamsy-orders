/**
 * Orders are written to the phone first and sent second, so a dropped connection or a closed
 * tab never loses one. Each order carries a client_ref generated on the phone; the server
 * stores an order once per client_ref, so re-sending after a timeout is always safe.
 */

export interface PlaceOrderLine {
  product_id: string;
  quantity: number;
  discount_usd_cents: number;
  unit_price_usd_cents?: number;
  approval_id?: string;
}

export interface PlaceOrderPayload {
  client_ref: string;
  customer_id: string;
  rate: number;
  lines: PlaceOrderLine[];
}

export type SendResult =
  | { kind: "ok"; order: unknown }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "network" };

export type SubmitResult =
  | { kind: "saved"; order: unknown }
  | { kind: "queued" }
  | { kind: "rejected"; code: string; message: string };

export interface OutboxItem {
  payload: PlaceOrderPayload;
  createdAt: string;
  status: "pending" | "failed";
  error?: { code: string; message: string };
  /** Shown in the queue so the adviser can recognise the order. */
  summary?: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type Sender = (payload: PlaceOrderPayload) => Promise<SendResult>;

export class Outbox {
  private key: string;

  constructor(
    private store: KeyValueStore,
    userId: string,
  ) {
    this.key = Outbox.storageKey(userId);
  }

  static storageKey(userId: string) {
    return `shamsy.outbox.${userId}`;
  }

  /** Reads a stored queue; corrupt or missing storage is an empty queue. */
  static parse(raw: string | null): OutboxItem[] {
    try {
      const parsed = JSON.parse(raw ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  list(): OutboxItem[] {
    return Outbox.parse(this.store.getItem(this.key));
  }

  private save(items: OutboxItem[]) {
    this.store.setItem(this.key, JSON.stringify(items));
  }

  private put(item: OutboxItem) {
    const items = this.list();
    const i = items.findIndex((x) => x.payload.client_ref === item.payload.client_ref);
    if (i >= 0) items[i] = item;
    else items.push(item);
    this.save(items);
  }

  remove(clientRef: string) {
    this.save(this.list().filter((x) => x.payload.client_ref !== clientRef));
  }

  async submit(payload: PlaceOrderPayload, send: Sender, summary?: string): Promise<SubmitResult> {
    this.put({ payload, createdAt: new Date().toISOString(), status: "pending", summary });
    const r = await send(payload);
    if (r.kind === "ok") {
      this.remove(payload.client_ref);
      return { kind: "saved", order: r.order };
    }
    if (r.kind === "rejected") {
      // Refused while the adviser is looking at the screen: she fixes it there, nothing to queue.
      this.remove(payload.client_ref);
      return r;
    }
    return { kind: "queued" };
  }

  /** Sends pending orders oldest first. Stops at the first network failure. */
  async sync(send: Sender): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;
    for (const item of this.list().filter((x) => x.status === "pending")) {
      const r = await send(item.payload);
      if (r.kind === "network") break;
      if (r.kind === "ok") {
        this.remove(item.payload.client_ref);
        synced++;
      } else {
        this.put({ ...item, status: "failed", error: { code: r.code, message: r.message } });
        failed++;
      }
    }
    return { synced, failed };
  }
}
