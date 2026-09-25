"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { OutboxItem } from "@/lib/outbox";
import { OUTBOX_EVENT, outboxFor, syncNow } from "@/lib/send-order";
import { useOnline } from "./use-online";

function subscribe(onChange: () => void) {
  window.addEventListener(OUTBOX_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab
  return () => {
    window.removeEventListener(OUTBOX_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Live view of this user's outbox, plus the background sync loop. */
export function useOutbox(userId: string) {
  const key = `shamsy.outbox.${userId}`;
  // The raw string is a stable snapshot; parsing happens below.
  const raw = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key) ?? "[]",
    () => "[]",
  );
  const items = useMemo<OutboxItem[]>(() => {
    void raw;
    return typeof window === "undefined" ? [] : outboxFor(userId).list();
  }, [raw, userId]);
  const online = useOnline();

  useEffect(() => {
    const sync = () => void syncNow(userId);
    window.addEventListener("online", sync);
    sync();
    const timer = window.setInterval(sync, 30_000);
    return () => {
      window.removeEventListener("online", sync);
      window.clearInterval(timer);
    };
  }, [userId]);

  return { items, online };
}
