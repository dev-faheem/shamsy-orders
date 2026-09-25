import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
  if (profile.role !== "owner") return <p className="rounded-md border border-line bg-white p-4">{t.settings.ownerOnly}</p>;

  const { ok, error } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: s }, { data: products }, { data: history }] = await Promise.all([
    supabase.from("settings").select("*").single(),
    supabase.from("products").select("id, name, price_usd_cents").order("sort_order"),
    supabase.from("audit_log").select("id, table_name, action, old_row, new_row, changed_at").order("changed_at", { ascending: false }).limit(8),
  ]);
  if (!s) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-brand">{t.settings.title}</h1>
      {ok && (
        <p role="status" className="rounded-md border border-ok bg-white px-3 py-2 text-sm text-ok">
          ✓ {ok === "rates" ? t.settings.ratesSaved : t.settings.priceSaved}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-red-edge bg-red-tint px-3 py-2 text-sm text-red-ink">
          {String(error)}
        </p>
      )}

      <form action={saveRates} className="rounded-lg border border-line bg-white p-4 space-y-3">
        <h2 className="font-semibold">{t.settings.rates}</h2>
        <label className="block">
          <span className="text-sm">{t.settings.dayRate}</span>
          <input name="day" inputMode="numeric" defaultValue={formatRate(s.day_rate_sdg_per_usd)} className="num mt-1 w-full rounded-md border border-line px-3 py-3" data-testid="day-rate" />
        </label>
        <label className="block">
          <span className="text-sm">{t.settings.minRate}</span>
          <input name="min" inputMode="numeric" defaultValue={formatRate(s.min_rate_sdg_per_usd)} className="num mt-1 w-full rounded-md border border-line px-3 py-3" data-testid="min-rate" />
        </label>
        <p className="text-xs text-ink-2">
          {t.settings.thresholds(formatPercent(s.discount_sand_max_bp), formatPercent(s.discount_red_max_bp))}
        </p>
        <button className="rounded-md bg-brand px-4 py-3 font-semibold text-white" data-testid="save-rates">
          {t.settings.saveRates}
        </button>
      </form>

      <section className="rounded-lg border border-line bg-white p-4 space-y-3">
        <h2 className="font-semibold">{t.settings.prices}</h2>
        {products?.map((p) => (
          <form key={p.id} action={savePrice} className="flex items-end gap-2">
            <input type="hidden" name="id" value={p.id} />
            <label className="flex-1">
              <span className="text-sm">{p.name}</span>
              <input name="price" inputMode="decimal" defaultValue={(p.price_usd_cents / 100).toFixed(2)} className="num mt-1 w-full rounded-md border border-line px-3 py-2" />
            </label>
            <button className="rounded-md border border-brand px-3 py-2 text-brand">{t.settings.savePrice}</button>
          </form>
        ))}
      </section>

      {history && history.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="mb-2 font-semibold">{t.settings.history}</h2>
          <ul className="space-y-1 text-xs text-ink-2 num">
            {history.map((h) => (
              <li key={h.id}>
                {fmt.format(new Date(h.changed_at))} · {h.table_name} · {h.action}
                {h.table_name === "settings" && h.old_row && h.new_row && (
                  <> · rate {formatRate(h.old_row.day_rate_sdg_per_usd)} → {formatRate(h.new_row.day_rate_sdg_per_usd)}, min {formatRate(h.old_row.min_rate_sdg_per_usd)} → {formatRate(h.new_row.min_rate_sdg_per_usd)}</>
                )}
                {h.table_name === "products" && h.old_row && h.new_row && (
                  <> · {h.new_row.name}: {formatUsd(h.old_row.price_usd_cents)} → {formatUsd(h.new_row.price_usd_cents)}</>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
