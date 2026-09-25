import { t } from "@/i18n/en";

/** Shown at once when switching screens, so a tap never feels ignored on a slow connection. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label={t.order.loading}>
      <div className="border-b border-line bg-white px-4 py-3 lg:px-6 lg:py-4">
        <div className="mx-auto h-7 max-w-[1200px] animate-pulse">
          <div className="h-7 w-40 rounded-[3px] bg-line" />
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-4 lg:p-6">
        {[112, 88, 88].map((h, i) => (
          <div key={i} className="animate-pulse rounded-[4px] border border-line bg-panel p-4" style={{ height: h }}>
            <div className="h-3 w-32 rounded-[3px] bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
