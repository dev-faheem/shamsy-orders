"use client";

import { useEffect, useState } from "react";
import { formatPercent, formatUsd } from "@/lib/money";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { t } from "@/i18n/en";

interface Row {
  id: string;
  status: "pending" | "approved" | "rejected";
  quantity: number;
  unit_price_usd_cents: number;
  discount_usd_cents: number;
  discount_bp: number;
  created_at: string;
  decided_at: string | null;
  products: { name: string } | null;
  customers: { name: string; city: string } | null;
  requester: { full_name: string } | null;
}

const SELECT =
  "id, status, quantity, unit_price_usd_cents, discount_usd_cents, discount_bp, created_at, decided_at, products(name), customers(name, city), requester:profiles!discount_approvals_requested_by_fkey(full_name)";

export function ApprovalsList() {
  const [pending, setPending] = useState<Row[]>([]);
  const [recent, setRecent] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);

  // Poll every 5 s: new requests appear without a reload; on 3G this is sturdier than a socket.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const db = supabaseBrowser();
      const [p, r] = await Promise.all([
        db.from("discount_approvals").select(SELECT).eq("status", "pending").order("created_at"),
        db.from("discount_approvals").select(SELECT).neq("status", "pending").order("decided_at", { ascending: false }).limit(10),
      ]);
      if (!alive) return;
      if (p.data) setPending(p.data as unknown as Row[]);
      if (r.data) setRecent(r.data as unknown as Row[]);
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [version]);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    const { error } = await supabaseBrowser().rpc("decide_discount_approval", { p_approval_id: id, p_approve: approve });
    setBusy(null);
    if (error) setError(error.message);
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-md border border-red-edge bg-red-tint px-3 py-2 text-sm text-red-ink">{error}</p>}
      {pending.length === 0 && <p className="text-ink-2">{t.approvals.empty}</p>}
      <ul className="space-y-3">
        {pending.map((r) => (
          <li key={r.id} className="rounded-lg border-2 border-red-edge bg-white p-4 space-y-2" data-testid="approval-request">
            <Summary r={r} />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => decide(r.id, true)}
                disabled={busy === r.id}
                className="rounded-md bg-brand py-3 font-semibold text-white disabled:opacity-50"
                data-testid="approve"
              >
                {t.approvals.approve}
              </button>
              <button
                onClick={() => decide(r.id, false)}
                disabled={busy === r.id}
                className="rounded-md border border-line py-3 font-semibold disabled:opacity-50"
              >
                {t.approvals.reject}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink-2">{t.approvals.recent}</h2>
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-white p-3 text-sm">
                <Summary r={r} />
                <p className={r.status === "approved" ? "text-ok" : "text-red-ink"}>
                  {r.status === "approved" ? `✓ ${t.approvals.approve}` : `✗ ${t.approvals.reject}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Summary({ r }: { r: Row }) {
  const value = r.unit_price_usd_cents * r.quantity;
  return (
    <div className="text-sm">
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{r.products?.name}</span>
        <span className="num font-semibold text-red-ink">{formatPercent(r.discount_bp)}</span>
      </div>
      <p className="num text-ink-2">
        {r.quantity} × {formatUsd(r.unit_price_usd_cents)} = {formatUsd(value)} − {formatUsd(r.discount_usd_cents)} ={" "}
        {formatUsd(value - r.discount_usd_cents)}
      </p>
      <p className="text-ink-2">
        {r.customers?.name} — {r.customers?.city} · {t.approvals.requestedBy(r.requester?.full_name ?? "")}
      </p>
    </div>
  );
}
