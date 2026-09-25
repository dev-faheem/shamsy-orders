"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "./use-catalog";
import { useOnline } from "./use-online";
import { evaluateDraft, type Draft, type DraftLine, type EvaluatedLine } from "@/lib/order-draft";
import { formatPercent, formatRate, formatSdg, formatUsd, parseRate, type DiscountTier } from "@/lib/money";
import { announceOutboxChange, outboxFor, postOrder } from "@/lib/send-order";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { t } from "@/i18n/en";
import type { Profile } from "@/lib/supabase/server";

const tierStyle: Record<DiscountTier, string> = {
  none: "bg-white border-line",
  sand: "bg-sand border-sand-edge",
  red: "bg-red-tint border-red-edge",
  blocked: "bg-red-tint border-red-edge border-2",
};
const badgeStyle: Record<DiscountTier, string> = {
  none: "bg-panel text-ink-2",
  sand: "bg-sand-edge text-white",
  red: "bg-red-edge text-white",
  blocked: "bg-red-ink text-white",
};

/** A blank order. rateInput "" means "today's rate", until the adviser types her own. */
function newDraft(): Draft {
  return { clientRef: crypto.randomUUID(), customerId: "", rateInput: "", lines: [] };
}

function loadDraft(key: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? "null");
    return d && Array.isArray(d.lines) && typeof d.clientRef === "string" ? d : null;
  } catch {
    return null;
  }
}

export function OrderScreen({ profile }: { profile: Profile }) {
  const router = useRouter();
  const { catalog, source } = useCatalog(profile.tenant_id);
  const draftKey = `shamsy.draft.${profile.id}`;
  const isOwner = profile.role === "owner";

  // Restore an unsaved order (the adviser may have been waiting for approval, or lost signal).
  const [initial] = useState(() => loadDraft(draftKey));
  const [storedDraft, setDraft] = useState<Draft>(() => initial ?? newDraft());
  const [restored, setRestored] = useState(() => Boolean(initial && (initial.lines.length || initial.customerId)));
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const online = useOnline();

  // A fresh order starts at today's rate setting.
  const draft: Draft = useMemo(
    () =>
      storedDraft.rateInput === "" && catalog
        ? { ...storedDraft, rateInput: formatRate(catalog.settings.day_rate_sdg_per_usd) }
        : storedDraft,
    [storedDraft, catalog],
  );

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(storedDraft));
    } catch {
      // storage full or blocked: the order still works, it just will not survive a reload
    }
  }, [storedDraft, draftKey]);

  const thresholds = useMemo(
    () =>
      catalog
        ? { sandMaxBp: catalog.settings.discount_sand_max_bp, redMaxBp: catalog.settings.discount_red_max_bp }
        : { sandMaxBp: 0, redMaxBp: 0 },
    [catalog],
  );
  const minRate = catalog?.settings.min_rate_sdg_per_usd ?? Number.MAX_SAFE_INTEGER;
  const evaluation = useMemo(
    () => (draft && catalog ? evaluateDraft(draft, catalog.products, thresholds, minRate) : null),
    [draft, catalog, thresholds, minRate],
  );

  const update = useCallback((fn: (d: Draft) => Draft) => setDraft(fn), []);
  const updateLine = (key: string, fn: (l: DraftLine) => DraftLine) =>
    update((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? fn(l) : l)) }));

  // Poll pending approvals. Polling is kinder than a socket on a 3G connection that keeps dropping.
  const pendingIds = draft?.lines.filter((l) => l.approval?.status === "pending").map((l) => l.approval!.id) ?? [];
  const pendingKey = pendingIds.join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    const poll = async () => {
      const { data } = await supabaseBrowser().from("discount_approvals").select("id, status").in("id", ids);
      if (!data) return;
      update((d) => ({
        ...d,
        lines: d.lines.map((l) => {
          const row = l.approval && data.find((r: { id: string; status: "pending" | "approved" | "rejected" }) => r.id === l.approval!.id);
          return row && row.status !== l.approval!.status ? { ...l, approval: { ...l.approval!, status: row.status } } : l;
        }),
      }));
    };
    poll();
    const timer = window.setInterval(poll, 4000);
    return () => window.clearInterval(timer);
  }, [pendingKey, update]);

  if (source === "missing" && !catalog) {
    return <p className="rounded-md border border-warn bg-white p-4">{t.order.catalogueMissing}</p>;
  }
  if (!catalog || !evaluation) return <p className="text-ink-2">{t.order.loading}</p>;

  const minText = formatRate(minRate);
  const rateOk = evaluation.rate.ok;
  const rateError = evaluation.rate.ok
    ? null
    : evaluation.rate.reason === "below-min"
      ? t.order.rateBelowMin(minText)
      : t.order.rateInvalid;

  function onRateBlur() {
    const parsed = parseRate(draft.rateInput);
    if (parsed === null || parsed < minRate) {
      update((d) => ({ ...d, rateInput: minText }));
      setRateNotice(t.order.rateSnapped(minText));
    } else {
      update((d) => ({ ...d, rateInput: formatRate(parsed) }));
    }
  }

  function addProduct(productId: string) {
    if (!rateOk) return;
    update((d) => ({
      ...d,
      lines: [...d.lines, { key: crypto.randomUUID(), productId, quantity: 1, discountInput: "" }],
    }));
  }

  async function requestApproval(e: EvaluatedLine) {
    if (!e.result || !draft) return;
    setBusyLine(e.line.key);
    setMessage(null);
    const { data, error } = await supabaseBrowser().rpc("request_discount_approval", {
      p_customer_id: draft.customerId,
      p_product_id: e.line.productId,
      p_quantity: e.line.quantity,
      p_discount_usd_cents: e.discountCents,
      p_unit_price_usd_cents: e.unitPriceCents !== e.product!.price_usd_cents ? e.unitPriceCents : null,
    });
    setBusyLine(null);
    if (error || !data) {
      setMessage({ kind: "error", text: error?.message ?? t.order.needsConnection });
      return;
    }
    updateLine(e.line.key, (l) => ({
      ...l,
      approval: {
        id: data.id,
        status: data.status,
        customerId: data.customer_id,
        productId: data.product_id,
        quantity: data.quantity,
        discountCents: data.discount_usd_cents,
        unitPriceCents: data.unit_price_usd_cents,
      },
    }));
  }

  async function save() {
    if (!evaluation?.payload || saving) return;
    setSaving(true);
    setMessage(null);
    const customer = catalog!.customers.find((c) => c.id === draft.customerId);
    const summary = `${customer?.name ?? ""} · ${formatUsd(evaluation.totals!.usdCents)} · ${formatSdg(evaluation.totals!.sdgPiastres)}`;
    const result = await outboxFor(profile.id).submit(evaluation.payload, postOrder, summary);
    setSaving(false);
    announceOutboxChange();
    if (result.kind === "rejected") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    const next = newDraft();
    localStorage.setItem(draftKey, JSON.stringify(next));
    setDraft(next);
    setRestored(false);
    if (result.kind === "saved") {
      router.push(`/orders/${(result.order as { id: string }).id}?saved=1`);
    } else {
      setMessage({ kind: "info", text: t.order.queued });
    }
  }

  const reasonText = evaluation.blockers.map((b) => t.order.reasons[b]).join(", ");

  return (
    <div className="space-y-4 pb-44">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand">{t.order.title}</h1>
        {(draft.lines.length > 0 || draft.customerId) && (
          <button
            onClick={() => {
              setDraft(newDraft());
              setRestored(false);
              setMessage(null);
            }}
            className="text-sm text-ink-2 underline"
          >
            {t.order.clear}
          </button>
        )}
      </div>

      {source === "cache" && <Notice tone="warn">{t.order.catalogueOffline}</Notice>}
      {restored && <Notice tone="info">{t.order.draftRestored}</Notice>}
      {message && <Notice tone={message.kind === "error" ? "error" : "info"}>{message.text}</Notice>}

      <section className="bg-white rounded-lg border border-line p-4 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">{t.order.customer}</span>
          <select
            value={draft.customerId}
            onChange={(e) => update((d) => ({ ...d, customerId: e.target.value }))}
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-3"
            data-testid="customer"
          >
            <option value="">{t.order.chooseCustomer}</option>
            {catalog.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.city}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">{t.order.rate}</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={draft.rateInput}
            onChange={(e) => {
              setRateNotice(null);
              update((d) => ({ ...d, rateInput: e.target.value }));
            }}
            onBlur={onRateBlur}
            aria-invalid={!rateOk}
            aria-describedby="rate-help"
            data-testid="rate"
            className={`num mt-1 w-full rounded-md border px-3 py-3 text-lg ${
              rateOk ? "border-line" : "border-2 border-red-edge bg-red-tint"
            }`}
          />
          <span id="rate-help" className={`mt-1 block text-sm ${rateOk && !rateNotice ? "text-ink-2" : "text-red-ink font-medium"}`} role={rateOk ? undefined : "alert"}>
            {rateError ?? rateNotice ?? t.order.rateHint(minText)}
          </span>
        </label>
      </section>

      <section className="bg-white rounded-lg border border-line p-4">
        <h2 className="text-sm font-medium mb-2">{t.order.addProduct}</h2>
        <div className="grid grid-cols-2 gap-2">
          {catalog.products.map((p) => (
            <button
              key={p.id}
              onClick={() => addProduct(p.id)}
              disabled={!rateOk}
              className="text-start rounded-md border border-line px-3 py-2 text-sm hover:bg-panel active:bg-panel disabled:opacity-50"
              data-testid={`add-${p.sku}`}
            >
              <span className="block font-medium leading-snug">＋ {p.name}</span>
              <span className="num text-ink-2">{formatUsd(p.price_usd_cents)}</span>
            </button>
          ))}
        </div>
        {!rateOk && <p className="mt-2 text-sm text-red-ink">{t.order.addBlockedByRate}</p>}
      </section>

      <section className="space-y-3" aria-label="Order lines">
        {evaluation.lines.length === 0 && <p className="text-ink-2 text-sm px-1">{t.order.noLines}</p>}
        {evaluation.lines.map((e, i) => (
          <LineCard
            key={e.line.key}
            index={i}
            e={e}
            isOwner={isOwner}
            online={online}
            busy={busyLine === e.line.key}
            redMaxText={formatPercent(thresholds.redMaxBp)}
            onChange={(fn) => updateLine(e.line.key, fn)}
            onRemove={() => update((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== e.line.key) }))}
            onRequestApproval={() => requestApproval(e)}
            canRequest={Boolean(draft.customerId)}
          />
        ))}
      </section>

      <footer className="fixed bottom-0 inset-x-0 z-10 bg-white border-t-2 border-gold shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <div className="max-w-3xl mx-auto px-4 py-3 space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-ink-2">{t.order.totals}</div>
              <div className="num text-2xl font-bold text-brand" data-testid="total-usd">
                {evaluation.totals ? formatUsd(evaluation.totals.usdCents) : "—"}
              </div>
            </div>
            <div className="text-end">
              <div className="num text-lg font-semibold" data-testid="total-sdg">
                {evaluation.totals && rateOk ? formatSdg(evaluation.totals.sdgPiastres) : "—"}
              </div>
              <div className="num text-xs text-ink-2">
                {rateOk && evaluation.rate.ok ? t.order.atRate(formatRate(evaluation.rate.value)) : rateError}
              </div>
            </div>
          </div>
          <button
            onClick={save}
            disabled={!evaluation.payload || saving}
            className="w-full rounded-md bg-brand text-white py-3 text-lg font-semibold disabled:bg-ink-2/40"
            data-testid="save"
          >
            {saving ? t.order.saving : t.order.save}
          </button>
          {evaluation.blockers.length > 0 && (
            <p className="text-xs text-ink-2" data-testid="blockers">
              {t.order.cannotSave} {reasonText}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

function LineCard(props: {
  index: number;
  e: EvaluatedLine;
  isOwner: boolean;
  online: boolean;
  busy: boolean;
  redMaxText: string;
  canRequest: boolean;
  onChange: (fn: (l: DraftLine) => DraftLine) => void;
  onRemove: () => void;
  onRequestApproval: () => void;
}) {
  const { e, isOwner, onChange } = props;
  const tier = e.result?.tier ?? "none";
  const approved = tier === "blocked" && e.approval === "approved";
  const [editingPrice, setEditingPrice] = useState(e.line.priceInput !== undefined);
  const qtyRef = useRef<HTMLInputElement>(null);
  const setQty = (q: number) => onChange((l) => ({ ...l, quantity: Math.max(1, Math.min(100000, Math.floor(q) || 1)) }));
  const overridden = e.unitPriceCents !== undefined && e.product && e.unitPriceCents !== e.product.price_usd_cents;

  return (
    <article className={`rounded-lg border p-4 space-y-3 ${e.error ? "bg-white border-2 border-red-edge" : tierStyle[tier]}`} data-testid={`line-${props.index + 1}`} data-tier={e.error ? "error" : tier}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{e.product?.name ?? "—"}</h3>
          <p className="text-sm text-ink-2 num">
            {overridden ? t.order.overrideActive(formatUsd(e.product!.price_usd_cents)) : `🔒 ${t.order.priceLocked}`} ·{" "}
            {e.unitPriceCents !== undefined ? formatUsd(e.unitPriceCents) : "—"}
          </p>
        </div>
        <button onClick={props.onRemove} className="text-sm text-ink-2 underline px-2 py-1" aria-label={`${t.order.remove} ${e.product?.name ?? ""}`}>
          {t.order.remove}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-xs text-ink-2">{t.order.quantity}</span>
          <div className="mt-1 flex items-stretch">
            <button onClick={() => setQty(e.line.quantity - 1)} className="w-11 rounded-s-md border border-line bg-white text-xl" aria-label={t.order.less}>
              −
            </button>
            <input
              ref={qtyRef}
              inputMode="numeric"
              value={e.line.quantity}
              onChange={(ev) => setQty(Number(ev.target.value.replace(/\D/g, "")))}
              className="num w-full min-w-0 border-y border-line bg-white text-center text-lg"
              aria-label={t.order.quantity}
              data-testid="qty"
            />
            <button onClick={() => setQty(e.line.quantity + 1)} className="w-11 rounded-e-md border border-line bg-white text-xl" aria-label={t.order.more}>
              +
            </button>
          </div>
        </div>
        <label>
          <span className="text-xs text-ink-2">{t.order.discount}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={e.line.discountInput}
            onChange={(ev) => onChange((l) => ({ ...l, discountInput: ev.target.value }))}
            className="num mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-lg"
            data-testid="discount"
          />
        </label>
      </div>

      {isOwner &&
        (editingPrice ? (
          <label className="block">
            <span className="text-xs text-ink-2">{t.order.price} (USD)</span>
            <input
              inputMode="decimal"
              value={e.line.priceInput ?? ""}
              placeholder={e.product ? String(e.product.price_usd_cents / 100) : ""}
              onChange={(ev) => onChange((l) => ({ ...l, priceInput: ev.target.value }))}
              className="num mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
            />
          </label>
        ) : (
          <button onClick={() => setEditingPrice(true)} className="text-sm text-brand underline">
            {t.order.overridePrice}
          </button>
        ))}

      {e.error && (
        <p className="text-sm text-red-ink font-medium" role="alert">
          {e.error === "discount-too-big" ? t.order.discountTooBig : t.order.discountInvalid}
        </p>
      )}

      {e.result && (
        <dl className="grid grid-cols-3 gap-2 text-sm num">
          <div>
            <dt className="text-xs text-ink-2">{t.order.lineValue}</dt>
            <dd data-testid="line-value">{formatUsd(e.result.lineValueCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">{t.order.discount.replace(" (USD)", "")}</dt>
            <dd>
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${approved ? "bg-ok text-white" : badgeStyle[tier]}`} data-testid="discount-badge">
                {formatPercent(e.result.discountBp)} · {approved ? t.order.tier.approved : t.order.tier[tier]}
              </span>
            </dd>
          </div>
          <div className="text-end">
            <dt className="text-xs text-ink-2">{t.order.lineTotal}</dt>
            <dd className="font-semibold" data-testid="line-total">
              {formatUsd(e.result.lineTotalCents)}
            </dd>
          </div>
        </dl>
      )}

      {tier === "blocked" && (
        <div className="rounded-md bg-white/70 border border-red-edge p-3 space-y-2" data-testid="approval">
          {e.approval === "approved" ? (
            <p className="text-sm font-semibold text-ok">✓ {t.order.approved}</p>
          ) : e.approval === "pending" ? (
            <p className="text-sm font-medium text-red-ink">⏳ {t.order.waitingApproval}</p>
          ) : (
            <>
              <p className="text-sm text-red-ink font-medium">
                {e.approval === "rejected"
                  ? t.order.rejected
                  : e.approval === "stale"
                    ? t.order.changedAfterApproval
                    : t.order.blockedExplain(props.redMaxText)}
              </p>
              <button
                onClick={props.onRequestApproval}
                disabled={props.busy || !props.online || !props.canRequest}
                className="w-full rounded-md border-2 border-red-edge bg-white px-3 py-2 font-semibold text-red-ink disabled:opacity-50"
                data-testid="request-approval"
              >
                {props.busy ? t.order.asking : isOwner ? t.order.approveNow : t.order.askApproval}
              </button>
              {!props.online && <p className="text-xs text-ink-2">{t.order.needsConnection}</p>}
              {!props.canRequest && <p className="text-xs text-ink-2">{t.order.reasons.customer}</p>}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-edge bg-red-tint text-red-ink"
      : tone === "warn"
        ? "border-warn bg-white text-ink"
        : "border-brand-2 bg-white text-ink";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}
