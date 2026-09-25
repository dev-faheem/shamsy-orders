import Link from "next/link";
import { Notice } from "@/components/notice";
import { PageBody, PageHeader, Panel } from "@/components/page-header";
import { badgeCls, badgeStyle, buttonCls } from "@/components/styles";
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
  approved_by_name: string | null;
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-line py-1.5 text-[13px] last:border-b-0">
      <span className="text-ink-2">{label}</span>
      <span className="text-end font-semibold" data-testid={testId}>
        {children}
      </span>
    </div>
  );
}

/** Shows the order exactly as stored: its own rate, its own prices, its own totals. Nothing is recalculated. */
export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: order }, { data: settings }] = await Promise.all([
    supabase.rpc("order_json", { p_order_id: id }),
    supabase.from("settings").select("day_rate_sdg_per_usd").single(),
  ]);

  if (!order) {
    return (
      <>
        <PageHeader title={t.list.title} rate={settings?.day_rate_sdg_per_usd} />
        <PageBody>
          <Notice tone="warn">{t.view.notFound}</Notice>
        </PageBody>
      </>
    );
  }

  const lines = order.lines as OrderLine[];
  const created = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at));

  return (
    <>
      <PageHeader
        title={t.view.title(order.order_number)}
        titleTestId="order-number"
        rate={settings?.day_rate_sdg_per_usd}
        action={
          <Link href="/orders/new" className={`${buttonCls} px-3 py-1.5 text-[13px]`}>
            {t.view.newOrder}
          </Link>
        }
      />
      <PageBody className="space-y-4 lg:space-y-6">
        {saved && <Notice tone="ok">✓ {t.view.savedTitle(order.order_number)}</Notice>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
          <Panel title={t.view.linesTitle}>
            <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-panel text-ink-2">
                    <th className="border-b border-line px-3 py-2.5 text-start font-semibold">{t.view.product}</th>
                    <th className="border-b border-line px-3 py-2.5 text-end font-semibold">{t.view.discount}</th>
                    <th className="border-b border-line px-3 py-2.5 text-end font-semibold">{t.view.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.line_no} className="align-top">
                      <td className="border-b border-line px-3 py-3">
                        <strong>{l.product_name}</strong>
                        <div className="num text-ink-2">
                          {l.quantity} × {formatUsd(l.unit_price_usd_cents)} = {formatUsd(l.line_value_usd_cents)}
                        </div>
                        {l.approved_by && <div className="text-xs font-semibold text-ok-ink">✓ {t.view.approvedBy(l.approved_by_name ?? "")}</div>}
                      </td>
                      <td className="num border-b border-line px-3 py-3 text-end">
                        {l.discount_usd_cents > 0 ? (
                          <>
                            <div>−{formatUsd(l.discount_usd_cents)}</div>
                            <span className={`${badgeCls} mt-0.5 ${badgeStyle[l.approved_by ? "approved" : l.discount_tier]}`}>
                              {formatPercent(l.discount_bp)} · {l.approved_by ? t.order.tier.approved : t.order.tier[l.discount_tier]}
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-2">—</span>
                        )}
                      </td>
                      <td className="num border-b border-line px-3 py-3 text-end font-bold">{formatUsd(l.line_total_usd_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="space-y-4 lg:space-y-6">
            <section className="rounded-[4px] border border-line border-t-[3px] border-t-gold bg-white p-4">
              <h2 className="proto-h2">{t.order.totals}</h2>
              <div className="flex items-baseline justify-between gap-3 border-y border-ink py-2">
                <span className="text-[13px] font-bold uppercase tracking-[0.5px] text-ink-2">USD</span>
                <span className="num text-2xl font-bold text-brand" data-testid="stored-total-usd">
                  {formatUsd(order.total_usd_cents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-[13px] font-bold uppercase tracking-[0.5px] text-ink-2">SDG</span>
                <span className="num text-lg font-bold" data-testid="stored-total-sdg">
                  {formatSdg(order.total_sdg_piastres)}
                </span>
              </div>
              <p className="num text-end text-xs text-ink-2">{t.order.atRate(formatRate(order.rate_sdg_per_usd))}</p>
            </section>

            <section className="rounded-[4px] border border-line border-t-[3px] border-t-brand-2 bg-white p-4">
              <h2 className="proto-h2">{t.view.details}</h2>
              <Row label={t.view.customer}>
                {order.customer_name} — {order.customer_city}
              </Row>
              <Row label={t.view.adviser}>{order.adviser_name}</Row>
              <Row label={t.view.date}>{created}</Row>
              <Row label={t.view.rate} testId="stored-rate">
                <span className="num">{formatRate(order.rate_sdg_per_usd)}</span>
              </Row>
              {settings && settings.day_rate_sdg_per_usd !== order.rate_sdg_per_usd && (
                <p className="mt-3 rounded-[4px] border border-s-4 border-gold-l border-s-gold bg-white px-3 py-2 text-xs text-ink-2" data-testid="rate-differs">
                  {t.view.todayRate(formatRate(settings.day_rate_sdg_per_usd))}
                </p>
              )}
            </section>
          </div>
        </div>
      </PageBody>
    </>
  );
}
