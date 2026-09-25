import Link from "next/link";
import { redirect } from "next/navigation";
import { PageBody, PageHeader, Panel } from "@/components/page-header";
import { PendingOrders } from "@/components/pending-orders";
import { buttonCls } from "@/components/styles";
import { formatRate, formatSdg, formatUsd } from "@/lib/money";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { t } from "@/i18n/en";

const PAGE_SIZE = 25;

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const supabase = await supabaseServer();
  const [{ data: orders, count }, { data: settings }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, rate_sdg_per_usd, total_usd_cents, total_sdg_piastres, created_at, customers(name, city)", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    supabase.from("settings").select("day_rate_sdg_per_usd").single(),
  ]);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const hasOlder = (count ?? 0) > (page + 1) * PAGE_SIZE;

  return (
    <>
      <PageHeader
        title={t.list.title}
        rate={settings?.day_rate_sdg_per_usd}
        action={
          <Link href="/orders/new" className={`${buttonCls} px-3 py-1.5 text-[13px]`}>
            {t.nav.newOrder}
          </Link>
        }
      />
      <PageBody className="space-y-4 lg:space-y-6">
        <PendingOrders userId={profile.id} />
        <Panel title={t.list.recent(count ?? 0)}>
          {!orders?.length ? (
            <p className="text-[13px] text-ink-2">{t.list.empty}</p>
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-panel text-ink-2">
                    <th className="border-b border-line px-3 py-2.5 text-start font-semibold">{t.list.order}</th>
                    <th className="border-b border-line px-3 py-2.5 text-start font-semibold">{t.list.dealer}</th>
                    <th className="border-b border-line px-3 py-2.5 text-end font-semibold">{t.list.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const c = o.customers as unknown as { name: string; city: string } | null;
                    return (
                      <tr key={o.id} className="align-top hover:bg-[#fafbfb]">
                        <td className="border-b border-line px-3 py-3">
                          <Link href={`/orders/${o.id}`} className="font-bold text-brand underline-offset-2 hover:underline">
                            {o.order_number}
                          </Link>
                          <div className="num text-xs text-ink-2">{fmt.format(new Date(o.created_at))}</div>
                        </td>
                        <td className="border-b border-line px-3 py-3">
                          <Link href={`/orders/${o.id}`} className="block">
                            <strong>{c?.name}</strong>
                            <div className="text-xs text-ink-2">{c?.city}</div>
                          </Link>
                        </td>
                        <td className="num border-b border-line px-3 py-3 text-end">
                          <div className="whitespace-nowrap font-bold">{formatUsd(o.total_usd_cents)}</div>
                          <div className="whitespace-nowrap text-xs text-ink-2">{formatSdg(o.total_sdg_piastres)}</div>
                          <div className="whitespace-nowrap text-[11px] text-ink-2">@ {formatRate(o.rate_sdg_per_usd)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(page > 0 || hasOlder) && (
            <nav className="mt-3 flex justify-between text-[13px] font-semibold">
              {page > 0 ? (
                <Link href={`/orders?page=${page - 1}`} className="text-brand underline">
                  ← {t.list.prev}
                </Link>
              ) : (
                <span />
              )}
              {hasOlder && (
                <Link href={`/orders?page=${page + 1}`} className="text-brand underline">
                  {t.list.next} →
                </Link>
              )}
            </nav>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
