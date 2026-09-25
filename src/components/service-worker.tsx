"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline page loads are a bonus; the app works without the worker.
    });
  }, []);
  return null;
}

/** On sign-out: drop cached pages so the next person on a shared phone never sees them. */
export async function clearOfflineCaches() {
  try {
    navigator.serviceWorker?.controller?.postMessage("clear");
    if ("caches" in window) await caches.delete("shamsy-v1");
  } catch {
    // ignore
  }
}
