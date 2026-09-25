"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { DraftProduct } from "@/lib/order-draft";

export interface Catalog {
  products: (DraftProduct & { sku: string })[];
  customers: { id: string; name: string; city: string }[];
  settings: {
    day_rate_sdg_per_usd: number;
    min_rate_sdg_per_usd: number;
    discount_sand_max_bp: number;
    discount_red_max_bp: number;
  };
  loadedAt: string;
}

function readCache(key: string): Catalog | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Products, dealers and settings. Fetched fresh when online; the last good copy is kept
 * on the phone so the order screen still works on a dropped connection. Browser-only.
 */
export function useCatalog(tenantId: string) {
  const key = `shamsy.catalog.${tenantId}`;
  const [catalog, setCatalog] = useState<Catalog | null>(() => readCache(key));
  const [source, setSource] = useState<"loading" | "live" | "cache" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    const fallBack = () => !cancelled && setSource(readCache(key) ? "cache" : "missing");
    (async () => {
      const db = supabaseBrowser();
      const [p, c, s] = await Promise.all([
        db.from("products").select("id, sku, name, price_usd_cents").eq("active", true).order("sort_order"),
        db.from("customers").select("id, name, city").order("name"),
        db
          .from("settings")
          .select("day_rate_sdg_per_usd, min_rate_sdg_per_usd, discount_sand_max_bp, discount_red_max_bp")
          .single(),
      ]);
      if (cancelled) return;
      if (p.error || c.error || s.error || !s.data) return fallBack();
      const fresh: Catalog = { products: p.data, customers: c.data, settings: s.data, loadedAt: new Date().toISOString() };
      try {
        localStorage.setItem(key, JSON.stringify(fresh));
      } catch {
        // storage full: the live copy still works
      }
      setCatalog(fresh);
      setSource("live");
    })().catch(fallBack);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { catalog, source };
}
