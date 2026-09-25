import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingOrders } from "@/components/pending-orders";
import { formatRate, formatSdg, formatUsd } from "@/lib/money";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { t } from "@/i18n/en";

const PAGE_SIZE = 25;

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const supabase = await supabaseServer();
  const { data: orders, count } = await supabase
    .from("orders")
    .select("id, order_number, rate_sdg_per_usd, total_usd_cents, total_sdg_piastres, created_at, customers(name, city)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const hasOlder = (count ?? 0) > (page + 1) * PAGE_SIZE;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-brand">{t.list.title}</h1>
      <PendingOrders userId={profile.id} />
      {!orders?.length && <p className="text-ink-2">{t.list.empty}</p>}
      <ul className="space-y-2">
        {orders?.map((o) => {
          const c = o.customers as unknown as { name: string; city: string } | null;
          return (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="block rounded-lg border border-line bg-white p-4 hover:border-brand-2">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{o.order_number}</span>
                  <span className="num font-semibold">{formatUsd(o.total_usd_cents)}</span>
                </div>
                <div className="flex justify-between gap-2 text-sm text-ink-2">
                  <span>
                    {c?.name} — {c?.city}
                  </span>
                  <span className="num">{formatSdg(o.total_sdg_piastres)}</span>
                </div>
                <div className="flex justify-between gap-2 text-xs text-ink-2 num">
                  <span>{fmt.format(new Date(o.created_at))}</span>
                  <span>@ {formatRate(o.rate_sdg_per_usd)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {(page > 0 || hasOlder) && (
        <nav className="flex justify-between text-sm">
          {page > 0 ? <Link href={`/orders?page=${page - 1}`} className="underline">← {t.list.prev}</Link> : <span />}
          {hasOlder && <Link href={`/orders?page=${page + 1}`} className="underline">{t.list.next} →</Link>}
        </nav>
      )}
    </div>
  );
}
