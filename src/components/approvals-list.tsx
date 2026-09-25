"use client";

import { useEffect, useState } from "react";
import { Notice } from "./notice";
import { Panel } from "./page-header";
import { badgeCls, badgeStyle, buttonCls, secondaryButtonCls } from "./styles";
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
  const [loaded, setLoaded] = useState(false);
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
      setLoaded(true);
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
    <div className="space-y-4 lg:space-y-6">
      {error && <Notice tone="error">{error}</Notice>}

      <Panel title={t.approvals.waiting(pending.length)}>
        {loaded && pending.length === 0 && <p className="text-[13px] text-ink-2">{t.approvals.empty}</p>}
        {/* The prototype's signal cards: a coloured left edge, the facts, the action at the bottom. */}
        <ul className="grid gap-3 md:grid-cols-2">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-col rounded-[4px] border border-s-4 border-line border-s-urgent bg-white p-4" data-testid="approval-request">
              <Summary r={r} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => decide(r.id, true)} disabled={busy === r.id} className={buttonCls} data-testid="approve">
                  {t.approvals.approve}
                </button>
                <button onClick={() => decide(r.id, false)} disabled={busy === r.id} className={secondaryButtonCls}>
                  {t.approvals.reject}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {recent.length > 0 && (
        <Panel title={t.approvals.recent}>
          <ul className="grid gap-2 md:grid-cols-2">
            {recent.map((r) => (
              <li
                key={r.id}
                className={`rounded-[4px] border border-s-4 border-line bg-white p-3 ${r.status === "approved" ? "border-s-ok" : "border-s-ink-2"}`}
              >
                <Summary r={r} />
                <span className={`${badgeCls} mt-2 ${r.status === "approved" ? badgeStyle.approved : badgeStyle.none}`}>
                  {r.status === "approved" ? t.approvals.approved : t.approvals.declined}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Summary({ r }: { r: Row }) {
  const value = r.unit_price_usd_cents * r.quantity;
  return (
    <div className="text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-bold">{r.products?.name}</span>
        <span className={`${badgeCls} ${badgeStyle.blocked} shrink-0`}>{formatPercent(r.discount_bp)}</span>
      </div>
      <p className="num mt-1 text-ink-2">
        {r.quantity} × {formatUsd(r.unit_price_usd_cents)} = {formatUsd(value)} − {formatUsd(r.discount_usd_cents)} ={" "}
        <strong className="text-ink">{formatUsd(value - r.discount_usd_cents)}</strong>
      </p>
      <p className="text-ink-2">
        {r.customers?.name} — {r.customers?.city} · {t.approvals.requestedBy(r.requester?.full_name ?? "")}
      </p>
    </div>
  );
}
