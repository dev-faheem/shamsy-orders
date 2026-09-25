"use client";

import { useRouter } from "next/navigation";
import { Panel } from "./page-header";
import { useOutbox } from "./use-outbox";
import { announceOutboxChange, outboxFor, syncNow } from "@/lib/send-order";
import { t } from "@/i18n/en";

/** Orders stored on this phone that the server has not accepted yet. */
export function PendingOrders({ userId }: { userId: string }) {
  const router = useRouter();
  const { items } = useOutbox(userId);
  if (items.length === 0) return null;

  return (
    <Panel title={t.list.pendingTitle}>
      <ul className="space-y-2">
        {items.map((i) => (
          <li
            key={i.payload.client_ref}
            className={`rounded-[4px] border border-s-4 border-line bg-white p-3 text-[13px] ${i.status === "failed" ? "border-s-urgent" : "border-s-warn"}`}
          >
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{i.summary}</span>
              <span className={i.status === "failed" ? "font-bold text-red-ink" : "font-bold text-[#8a4a0f]"}>
                {i.status === "failed" ? t.list.failed : t.list.pending}
              </span>
            </div>
            {i.error && <p className="mt-1 text-red-ink">{i.error.message}</p>}
            <div className="mt-2 flex gap-3 font-semibold text-brand">
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
    </Panel>
  );
}
