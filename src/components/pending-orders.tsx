"use client";

import { useRouter } from "next/navigation";
import { useOutbox } from "./use-outbox";
import { announceOutboxChange, outboxFor, syncNow } from "@/lib/send-order";
import { t } from "@/i18n/en";

/** Orders stored on this phone that the server has not accepted yet. */
export function PendingOrders({ userId }: { userId: string }) {
  const router = useRouter();
  const { items } = useOutbox(userId);
  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border-2 border-warn bg-white p-4 space-y-2">
      <h2 className="font-semibold">{t.list.pendingTitle}</h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.payload.client_ref} className="rounded-md border border-line p-3 text-sm">
            <div className="flex justify-between gap-2">
              <span>{i.summary}</span>
              <span className={i.status === "failed" ? "text-red-ink font-medium" : "text-warn font-medium"}>
                {i.status === "failed" ? t.list.failed : t.list.pending}
              </span>
            </div>
            {i.error && <p className="mt-1 text-red-ink">{i.error.message}</p>}
            <div className="mt-2 flex gap-3">
              {i.status === "pending" && (
                <button
                  className="underline"
                  onClick={async () => {
                    await syncNow(userId);
                    router.refresh();
                  }}
                >
                  {t.list.retry}
                </button>
              )}
              {i.status === "failed" && (
                <button
                  className="underline"
                  onClick={() => {
                    outboxFor(userId).remove(i.payload.client_ref);
                    announceOutboxChange();
                  }}
                >
                  {t.list.dismiss}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
