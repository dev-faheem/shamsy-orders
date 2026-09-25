"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice } from "./notice";
import { PageBody, PageHeader, Panel } from "./page-header";
import { useCatalog } from "./use-catalog";
import { useOnline } from "./use-online";
import { useOutboxItems } from "./use-outbox";
import { badgeCls, badgeStyle, inputCls } from "./styles";
import { evaluateDraft, type Draft, type DraftLine, type EvaluatedLine } from "@/lib/order-draft";
import { formatPercent, formatRate, formatSdg, formatUsd, parseRate, type DiscountTier } from "@/lib/money";
import { announceOutboxChange, outboxFor, postOrder } from "@/lib/send-order";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { t } from "@/i18n/en";
import type { Profile } from "@/lib/supabase/server";

// The line turns sand or red (brief §15). Colours from the prototype's badges and signal cards.
const tierStyle: Record<DiscountTier, string> = {
  none: "bg-white border-line border-s-line",
  sand: "bg-sand-tint border-[#f1dfa0] border-s-sand-edge",
  red: "bg-red-tint border-[#f3c9c5] border-s-red-edge",
  blocked: "bg-red-tint border-red-edge border-s-red-edge",
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
  // The order this screen queued while offline, so the notice can follow it until it is sent.
  const [queuedRef, setQueuedRef] = useState<string | null>(null);
  const outboxItems = useOutboxItems(profile.id);

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

  if (!catalog || !evaluation) {
    return (
      <>
        <PageHeader title={t.order.title} />
        <PageBody>
          {source === "missing" ? <Notice tone="warn">{t.order.catalogueMissing}</Notice> : <p className="text-ink-2">{t.order.loading}</p>}
        </PageBody>
      </>
    );
  }

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
    const key = crypto.randomUUID();
    update((d) => ({ ...d, lines: [...d.lines, { key, productId, quantity: 1, discountInput: "" }] }));
    // Bring the new line into view; on a phone it is usually below the product buttons.
    requestAnimationFrame(() =>
      document.getElementById(`line-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
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
    setQueuedRef(null);
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
    setRateNotice(null);
    if (result.kind === "saved") {
      router.push(`/orders/${(result.order as { id: string }).id}?saved=1`);
    } else {
      setQueuedRef(evaluation.payload.client_ref);
    }
  }

  const reasonText = evaluation.blockers.map((b) => t.order.reasons[b]).join(", ");
  const queuedItem = queuedRef ? outboxItems.find((i) => i.payload.client_ref === queuedRef) : undefined;
  const queued = queuedRef ? { status: queuedItem?.status ?? "sent", error: queuedItem?.error } : null;

  const startOver = (draft.lines.length > 0 || draft.customerId) && (
    <button
      onClick={() => {
        if (draft.lines.length > 0 && !window.confirm(t.order.confirmClear)) return;
        setDraft(newDraft());
        setRestored(false);
        setMessage(null);
        setRateNotice(null);
        setQueuedRef(null);
      }}
      className="rounded-[3px] border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:border-ink-2 hover:text-ink"
    >
      {t.order.clear}
    </button>
  );

  return (
    <>
      <PageHeader title={t.order.title} rate={catalog.settings.day_rate_sdg_per_usd} action={startOver} />
      <PageBody className="pb-44 lg:pb-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
          <div className="space-y-4 lg:space-y-6">
            {source === "cache" && <Notice tone="warn">{t.order.catalogueOffline}</Notice>}
            {restored && <Notice tone="info">{t.order.draftRestored}</Notice>}
            {message && <Notice tone={message.kind === "error" ? "error" : "info"}>{message.text}</Notice>}
            {queued && (
              <Notice tone={queued.status === "failed" ? "error" : queued.status === "pending" ? "info" : "ok"}>
                {queued.status === "failed"
                  ? t.order.queuedRefused(queued.error?.message ?? "")
                  : queued.status === "pending"
                    ? t.order.queued
                    : t.order.queuedSent}
              </Notice>
            )}

            <Panel title={t.order.sectionDealer}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[13px] font-semibold">{t.order.customer}</span>
                  <select
                    value={draft.customerId}
                    onChange={(e) => update((d) => ({ ...d, customerId: e.target.value }))}
                    className={`${inputCls} mt-1`}
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
                  <span className="text-[13px] font-semibold">{t.order.rate}</span>
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
                    className={`${inputCls} num mt-1 text-lg font-semibold ${
                      rateOk ? "" : "border-2 border-red-edge bg-red-tint focus:border-red-edge focus:ring-red-edge/20"
                    }`}
                  />
                  <span
                    id="rate-help"
                    className={`mt-1 block text-[13px] ${rateOk && !rateNotice ? "text-ink-2" : "font-semibold text-red-ink"}`}
                    role={rateOk ? undefined : "alert"}
                  >
                    {rateError ?? rateNotice ?? t.order.rateHint(minText)}
                  </span>
                </label>
              </div>
            </Panel>

            <Panel title={t.order.addProduct}>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {catalog.products.map((p) => {
                  const [model, spec] = p.name.split(" — ");
                  return (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p.id)}
                      disabled={!rateOk}
                      className="rounded-[4px] border border-line border-t-[3px] border-t-brand-2 bg-white px-3 py-2.5 text-start transition-colors hover:border-brand active:bg-panel disabled:opacity-50"
                      data-testid={`add-${p.sku}`}
                    >
                      <span className="block font-bold leading-snug">＋ {model}</span>
                      {spec && <span className="block text-xs text-ink-2">{spec}</span>}
                      <span className="num mt-1 block font-bold text-brand">{formatUsd(p.price_usd_cents)}</span>
                    </button>
                  );
                })}
              </div>
              {!rateOk && <p className="mt-2 text-[13px] font-semibold text-red-ink">{t.order.addBlockedByRate}</p>}
            </Panel>

            <Panel title={t.order.sectionLines(evaluation.lines.length)}>
              <section className="space-y-3" aria-label={t.order.sectionLinesLabel}>
                {evaluation.lines.length === 0 && <p className="text-[13px] text-ink-2">{t.order.noLines}</p>}
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
            </Panel>
          </div>

          {/* Totals: a bar fixed to the bottom on a phone, a sticky card beside the lines on a laptop. */}
          <aside
            aria-label={t.order.totals}
            className="fixed inset-x-0 bottom-0 z-20 border-t-[3px] border-gold bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.08)] lg:sticky lg:top-6 lg:rounded-[4px] lg:border lg:border-t-[3px] lg:border-line lg:border-t-gold lg:shadow-none"
          >
            <div className="mx-auto max-w-[1200px] space-y-2 px-4 py-2.5 lg:p-4">
              <h2 className="proto-h2 hidden lg:block">{t.order.totals}</h2>
              {/* Phone: dollars and pounds side by side in one row. Laptop: the prototype's highlight rows. */}
              <div className="grid grid-cols-[auto_1fr] items-end gap-x-3 lg:block">
                <div className="lg:flex lg:items-baseline lg:justify-between lg:border-y lg:border-ink lg:py-2">
                  <span className="block text-[11px] font-bold uppercase tracking-[0.5px] text-ink-2 lg:inline lg:text-[13px]">USD</span>
                  <span className="num block text-2xl leading-tight font-bold text-brand" data-testid="total-usd">
                    {evaluation.totals ? formatUsd(evaluation.totals.usdCents) : "—"}
                  </span>
                </div>
                <div className="text-end lg:flex lg:flex-wrap lg:items-baseline lg:justify-between lg:pt-2">
                  <span className="hidden text-[13px] font-bold uppercase tracking-[0.5px] text-ink-2 lg:inline">SDG</span>
                  <span className="num block text-base leading-tight font-bold lg:text-lg" data-testid="total-sdg">
                    {evaluation.totals && rateOk ? formatSdg(evaluation.totals.sdgPiastres) : "—"}
                  </span>
                  <span className={`num block text-xs lg:mt-1 lg:w-full lg:text-end ${rateOk ? "text-ink-2" : "font-semibold text-red-ink"}`}>
                    {rateOk && evaluation.rate.ok ? t.order.atRate(formatRate(evaluation.rate.value)) : rateError}
                  </span>
                </div>
              </div>
              <button
                onClick={save}
                disabled={!evaluation.payload || saving}
                className="w-full rounded-[3px] bg-brand py-2.5 text-base font-semibold text-white transition-colors hover:bg-brand-2 disabled:bg-[#b8c1c7] lg:py-3"
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
          </aside>
        </div>
      </PageBody>
    </>
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
  // While typing, the field may be empty ("" → "12"); the line keeps its last valid quantity.
  const [qtyText, setQtyText] = useState<string | null>(null);
  const setQty = (q: number) => {
    setQtyText(null);
    onChange((l) => ({ ...l, quantity: Math.max(1, Math.min(100000, Math.floor(q) || 1)) }));
  };
  const overridden = e.unitPriceCents !== undefined && e.product && e.unitPriceCents !== e.product.price_usd_cents;

  return (
    <article
      className={`space-y-3 rounded-[4px] border border-s-4 p-3 sm:p-4 ${e.error ? "border-red-edge border-s-red-edge bg-white" : tierStyle[tier]}`}
      id={`line-${e.line.key}`}
      data-testid={`line-${props.index + 1}`}
      data-tier={e.error ? "error" : tier}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">{e.product?.name ?? "—"}</h3>
          <p className="num text-[13px] text-ink-2">
            {!overridden && <LockIcon />}
            {overridden ? t.order.overrideActive(formatUsd(e.product!.price_usd_cents)) : t.order.priceLocked} ·{" "}
            <strong className="text-ink">{e.unitPriceCents !== undefined ? formatUsd(e.unitPriceCents) : "—"}</strong>
          </p>
        </div>
        <button
          onClick={props.onRemove}
          className="shrink-0 rounded-[3px] px-2 py-1 text-[13px] text-ink-2 underline hover:text-ink"
          aria-label={`${t.order.remove} ${e.product?.name ?? ""}`}
        >
          {t.order.remove}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-xs font-semibold text-ink-2">{t.order.quantity}</span>
          <div className="mt-1 flex items-stretch">
            <button onClick={() => setQty(e.line.quantity - 1)} className="w-11 shrink-0 rounded-s-[3px] border border-line bg-white text-xl hover:bg-panel" aria-label={t.order.less}>
              −
            </button>
            <input
              inputMode="numeric"
              value={qtyText ?? String(e.line.quantity)}
              onChange={(ev) => {
                const digits = ev.target.value.replace(/\D/g, "").slice(0, 6);
                setQtyText(digits);
                if (Number(digits) >= 1) onChange((l) => ({ ...l, quantity: Math.min(100000, Number(digits)) }));
              }}
              onBlur={() => setQtyText(null)}
              onFocus={(ev) => ev.target.select()}
              className="num w-full min-w-0 border-y border-line bg-white text-center text-lg font-semibold outline-none focus:bg-panel"
              aria-label={t.order.quantity}
              data-testid="qty"
            />
            <button onClick={() => setQty(e.line.quantity + 1)} className="w-11 shrink-0 rounded-e-[3px] border border-line bg-white text-xl hover:bg-panel" aria-label={t.order.more}>
              +
            </button>
          </div>
        </div>
        <label>
          <span className="text-xs font-semibold text-ink-2">{t.order.discount}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={e.line.discountInput}
            onChange={(ev) => onChange((l) => ({ ...l, discountInput: ev.target.value }))}
            className={`${inputCls} num mt-1 py-2 text-lg font-semibold`}
            data-testid="discount"
          />
        </label>
      </div>

      {isOwner &&
        (editingPrice ? (
          <label className="block">
            <span className="text-xs font-semibold text-ink-2">{t.order.price} (USD)</span>
            <input
              inputMode="decimal"
              value={e.line.priceInput ?? ""}
              placeholder={e.product ? String(e.product.price_usd_cents / 100) : ""}
              onChange={(ev) => onChange((l) => ({ ...l, priceInput: ev.target.value }))}
              className={`${inputCls} num mt-1 py-2`}
            />
          </label>
        ) : (
          <button onClick={() => setEditingPrice(true)} className="text-[13px] font-semibold text-brand underline">
            {t.order.overridePrice}
          </button>
        ))}

      {e.error && (
        <p className="text-[13px] font-semibold text-red-ink" role="alert">
          {e.error === "discount-too-big" ? t.order.discountTooBig : t.order.discountInvalid}
        </p>
      )}

      {e.result && (
        <dl className="num grid grid-cols-3 gap-2 border-t border-dashed border-line pt-2 text-[13px]">
          <div>
            <dt className="text-xs text-ink-2">{t.order.lineValue}</dt>
            <dd className="font-semibold" data-testid="line-value">
              {formatUsd(e.result.lineValueCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">{t.order.discountShort}</dt>
            <dd>
              <span
                className={`${badgeCls} ${badgeStyle[approved ? "approved" : tier]}`}
                data-testid="discount-badge"
              >
                {formatPercent(e.result.discountBp)} · {approved ? t.order.tier.approved : t.order.tier[tier]}
              </span>
            </dd>
          </div>
          <div className="text-end">
            <dt className="text-xs text-ink-2">{t.order.lineTotal}</dt>
            <dd className="text-[15px] font-bold" data-testid="line-total">
              {formatUsd(e.result.lineTotalCents)}
            </dd>
          </div>
        </dl>
      )}

      {tier === "blocked" && (
        <div className="space-y-2 rounded-[4px] border border-s-4 border-line border-s-urgent bg-white p-3" data-testid="approval">
          {e.approval === "approved" ? (
            <p className="text-[13px] font-bold text-ok-ink">✓ {t.order.approved}</p>
          ) : e.approval === "pending" ? (
            <p className="text-[13px] font-semibold text-red-ink">⏳ {t.order.waitingApproval}</p>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-red-ink">
                {e.approval === "rejected"
                  ? t.order.rejected
                  : e.approval === "stale"
                    ? t.order.changedAfterApproval
                    : t.order.blockedExplain(props.redMaxText)}
              </p>
              <button
                onClick={props.onRequestApproval}
                disabled={props.busy || !props.online || !props.canRequest}
                className="w-full rounded-[3px] bg-brand px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-2 disabled:opacity-50"
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

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="me-1 inline-block h-3.5 w-3.5 -translate-y-px fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
