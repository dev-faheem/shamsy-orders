import { formatRate } from "@/lib/money";
import { t } from "@/i18n/en";

/** The prototype's white page header: title on the left, today's rate on the right. */
export function PageHeader({
  title,
  rate,
  action,
  titleTestId,
}: {
  title: string;
  rate?: number | null;
  action?: React.ReactNode;
  titleTestId?: string;
}) {
  return (
    <header className="border-b border-line bg-white px-4 py-3 lg:px-6 lg:py-4">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink" data-testid={titleTestId}>
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {rate ? (
            <div className="flex items-center gap-2 rounded-[3px] border border-line bg-panel px-3 py-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
              <span>
                {t.header.todayRate} <strong className="num">{formatRate(rate)} SDG / USD</strong>
              </span>
            </div>
          ) : null}
          {action}
        </div>
      </div>
    </header>
  );
}

/** The content column under the page header. */
export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-4 py-4 lg:p-6 ${className}`}>{children}</div>;
}

export function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[4px] border border-line bg-panel p-4 lg:p-5 ${className}`}>
      {title && <h2 className="proto-h2">{title}</h2>}
      {children}
    </section>
  );
}
