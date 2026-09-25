"use client";

import { Outbox, type PlaceOrderPayload, type SendResult } from "./outbox";

/** Sends one order to /api/orders. Any transport problem is "network": the outbox keeps it. */
export async function postOrder(payload: PlaceOrderPayload): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { kind: "network" };
  }
  // 401: the session expired while offline; it refreshes when the connection is back. Keep the order.
  if (res.status === 401 || res.status >= 500) return { kind: "network" };
  const body = await res.json().catch(() => null);
  if (res.ok) return { kind: "ok", order: body };
  return { kind: "rejected", code: body?.code ?? "SERVER_ERROR", message: body?.message ?? res.statusText };
}

export function outboxFor(userId: string) {
  return new Outbox(window.localStorage, userId);
}

export const OUTBOX_EVENT = "shamsy:outbox-changed";

export function announceOutboxChange() {
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

let syncing = false;

/** Sends whatever is waiting. Safe to call often; only one sync runs at a time. */
export async function syncNow(userId: string) {
  if (syncing) return;
  syncing = true;
  try {
    const r = await outboxFor(userId).sync(postOrder);
    if (r.synced || r.failed) announceOutboxChange();
  } finally {
    syncing = false;
  }
}
