"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Outbox } from "@/lib/outbox";
import { OUTBOX_EVENT, syncNow } from "@/lib/send-order";
import { useOnline } from "./use-online";

function subscribe(onChange: () => void) {
  window.addEventListener(OUTBOX_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab
  return () => {
    window.removeEventListener(OUTBOX_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Live view of this user's outbox, without sending anything. */
export function useOutboxItems(userId: string) {
  const key = Outbox.storageKey(userId);
  // The stored string is a stable snapshot for React; it is parsed only when it changes.
  const raw = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key),
    () => null,
  );
  return useMemo(() => Outbox.parse(raw), [raw]);
}

/** The outbox plus the background sync loop. Used once, by the app shell. */
export function useOutbox(userId: string) {
  const items = useOutboxItems(userId);
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
