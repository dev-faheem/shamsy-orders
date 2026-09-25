import Link from "next/link";
import { formatPercent, formatRate, formatSdg, formatUsd, type DiscountTier } from "@/lib/money";
import { supabaseServer } from "@/lib/supabase/server";
import { t } from "@/i18n/en";

interface OrderLine {
  line_no: number;
  product_name: string;
  unit_price_usd_cents: number;
  catalogue_price_usd_cents: number;
  quantity: number;
  line_value_usd_cents: number;
  discount_usd_cents: number;
  discount_bp: number;
  discount_tier: DiscountTier;
  line_total_usd_cents: number;
  approved_by: string | null;
}

const badge: Record<DiscountTier, string> = {
  none: "bg-panel text-ink-2",
  sand: "bg-sand-edge text-white",
  red: "bg-red-edge text-white",
  blocked: "bg-red-ink text-white",
};

/** Shows the order exactly as stored: its own rate, its own prices, its own totals. Nothing is recalculated. */
export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: order }, { data: settings }] = await Promise.all([
    supabase.rpc("order_json", { p_order_id: id }),
    supabase.from("settings").select("day_rate_sdg_per_usd").single(),
  ]);

  if (!order) return <p className="rounded-md border border-line bg-white p-4">{t.view.notFound}</p>;

  const approverIds = [...new Set((order.lines as OrderLine[]).map((l) => l.approved_by).filter(Boolean))] as string[];
  const { data: approvers } = approverIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", approverIds)
    : { data: [] as { id: string; full_name: string }[] };

  const created = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at));

  return (
    <div className="space-y-4">
      {saved && (
        <p role="status" className="rounded-md border border-ok bg-white px-3 py-2 text-sm font-medium text-ok">
          ✓ {t.view.savedTitle(order.order_number)}
        </p>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand" data-testid="order-number">
          {t.view.title(order.order_number)}
        </h1>
        <Link href="/orders/new" className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white">
          {t.view.newOrder}
        </Link>
      </div>

      <section className="rounded-lg border border-line bg-white p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-2">{t.view.customer}</dt>
            <dd className="font-medium">
              {order.customer_name} — {order.customer_city}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">{t.view.adviser}</dt>
            <dd>{order.adviser_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">{t.view.date}</dt>
            <dd>{created}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">{t.view.rate}</dt>
            <dd className="num font-semibold" data-testid="stored-rate">
              {formatRate(order.rate_sdg_per_usd)}
            </dd>
          </div>
        </dl>
        {settings && settings.day_rate_sdg_per_usd !== order.rate_sdg_per_usd && (
          <p className="mt-3 text-xs text-ink-2" data-testid="rate-differs">
            {t.view.todayRate(formatRate(settings.day_rate_sdg_per_usd))}
          </p>
        )}
      </section>

      <section className="space-y-2">
        {(order.lines as OrderLine[]).map((l) => (
          <article key={l.line_no} className="rounded-lg border border-line bg-white p-4 text-sm">
            <div className="flex justify-between gap-2">
              <h2 className="font-semibold">{l.product_name}</h2>
              <span className="num font-semibold">{formatUsd(l.line_total_usd_cents)}</span>
            </div>
            <p className="num text-ink-2">
              {l.quantity} × {formatUsd(l.unit_price_usd_cents)} = {formatUsd(l.line_value_usd_cents)}
              {l.discount_usd_cents > 0 && <> − {formatUsd(l.discount_usd_cents)}</>}
            </p>
            {l.discount_tier !== "none" && (
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${l.approved_by ? "bg-ok text-white" : badge[l.discount_tier]}`}>
                  {formatPercent(l.discount_bp)} · {l.approved_by ? t.order.tier.approved : t.order.tier[l.discount_tier]}
                </span>
                {l.approved_by && (
                  <span className="text-xs text-ok">
                    ✓ {t.view.approvedBy(approvers?.find((a) => a.id === l.approved_by)?.full_name ?? "")}
                  </span>
                )}
              </p>
            )}
          </article>
        ))}
      </section>

      <section className="rounded-lg border-2 border-gold bg-white p-4 flex items-end justify-between">
        <div>
          <div className="text-xs text-ink-2">{t.order.totals}</div>
          <div className="num text-2xl font-bold text-brand" data-testid="stored-total-usd">
            {formatUsd(order.total_usd_cents)}
          </div>
        </div>
        <div className="text-end">
          <div className="num text-lg font-semibold" data-testid="stored-total-sdg">
            {formatSdg(order.total_sdg_piastres)}
          </div>
          <div className="num text-xs text-ink-2">{t.order.atRate(formatRate(order.rate_sdg_per_usd))}</div>
        </div>
      </section>
    </div>
  );
}
