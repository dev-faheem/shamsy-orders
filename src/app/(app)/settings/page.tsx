import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Notice } from "@/components/notice";
import { PageBody, PageHeader, Panel } from "@/components/page-header";
import { buttonCls, inputCls, secondaryButtonCls } from "@/components/styles";
import { formatPercent, formatRate, formatUsd, parseRate, parseUsdToCents } from "@/lib/money";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { t } from "@/i18n/en";

async function saveRates(formData: FormData) {
  "use server";
  const day = parseRate(String(formData.get("day") ?? ""));
  const min = parseRate(String(formData.get("min") ?? ""));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_rates", { p_day_rate: day, p_min_rate: min });
  redirect(`/settings?${error ? `error=${encodeURIComponent(error.message)}` : "ok=rates"}`);
}

async function savePrice(formData: FormData) {
  "use server";
  const cents = parseUsdToCents(String(formData.get("price") ?? ""));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_product_price", {
    p_product_id: String(formData.get("id")),
    p_price_usd_cents: cents,
  });
  revalidatePath("/orders/new");
  redirect(`/settings?${error ? `error=${encodeURIComponent(error.message)}` : "ok=price"}`);
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  const supabase = await supabaseServer();

  if (profile.role !== "owner") {
    return (
      <>
        <PageHeader title={t.settings.title} />
        <PageBody>
          <Notice tone="warn">{t.settings.ownerOnly}</Notice>
        </PageBody>
      </>
    );
  }

  const { ok, error } = await searchParams;
  const [{ data: s }, { data: products }, { data: history }] = await Promise.all([
    supabase.from("settings").select("*").single(),
    supabase.from("products").select("id, name, price_usd_cents").order("sort_order"),
    supabase
      .from("audit_log")
      .select("id, table_name, action, old_row, new_row, changed_at")
      .order("changed_at", { ascending: false })
      .limit(8),
  ]);
  if (!s) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader title={t.settings.title} rate={s.day_rate_sdg_per_usd} />
      <PageBody className="space-y-4 lg:space-y-6">
        {ok && <Notice tone="ok">✓ {ok === "rates" ? t.settings.ratesSaved : t.settings.priceSaved}</Notice>}
        {error && <Notice tone="error">{String(error)}</Notice>}

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
          <Panel title={t.settings.rates}>
            <form action={saveRates} className="space-y-3 rounded-[4px] border border-line border-t-[3px] border-t-gold bg-white p-4">
              <label className="block">
                <span className="text-[13px] font-semibold">{t.settings.dayRate}</span>
                <input name="day" inputMode="numeric" defaultValue={formatRate(s.day_rate_sdg_per_usd)} className={`${inputCls} num mt-1 font-semibold`} data-testid="day-rate" />
              </label>
              <label className="block">
                <span className="text-[13px] font-semibold">{t.settings.minRate}</span>
                <input name="min" inputMode="numeric" defaultValue={formatRate(s.min_rate_sdg_per_usd)} className={`${inputCls} num mt-1 font-semibold`} data-testid="min-rate" />
              </label>
              <p className="text-xs text-ink-2">
                {t.settings.thresholds(formatPercent(s.discount_sand_max_bp), formatPercent(s.discount_red_max_bp))}
              </p>
              <button className={buttonCls} data-testid="save-rates">
                {t.settings.saveRates}
              </button>
            </form>
          </Panel>

          <Panel title={t.settings.prices}>
            <div className="divide-y divide-line rounded-[4px] border border-line border-t-[3px] border-t-brand-2 bg-white">
              {products?.map((p) => (
                <form key={p.id} action={savePrice} className="flex items-end gap-2 p-3">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                    <input name="price" inputMode="decimal" defaultValue={(p.price_usd_cents / 100).toFixed(2)} className={`${inputCls} num mt-1 py-2`} />
                  </label>
                  <button className={`${secondaryButtonCls} px-3 py-2`}>{t.settings.savePrice}</button>
                </form>
              ))}
            </div>
          </Panel>
        </div>

        {history && history.length > 0 && (
          <Panel title={t.settings.history}>
            <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="num whitespace-nowrap border-b border-line px-3 py-2 text-ink-2">{fmt.format(new Date(h.changed_at))}</td>
                      <td className="num border-b border-line px-3 py-2">
                        {h.table_name === "settings" && h.new_row
                          ? t.settings.rateChange(formatRate(h.new_row.day_rate_sdg_per_usd), formatRate(h.new_row.min_rate_sdg_per_usd))
                          : h.table_name === "products" && h.new_row
                            ? `${h.new_row.name}: ${h.old_row ? `${formatUsd(h.old_row.price_usd_cents)} → ` : ""}${formatUsd(h.new_row.price_usd_cents)}`
                            : `${h.table_name} · ${h.action}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
