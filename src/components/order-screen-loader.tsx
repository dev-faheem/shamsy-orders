"use client";

import dynamic from "next/dynamic";
import { t } from "@/i18n/en";

/** The order screen lives on the phone (draft, outbox, cached catalogue), so it renders in the browser only. */
export const OrderScreenLoader = dynamic(() => import("./order-screen").then((m) => m.OrderScreen), {
  ssr: false,
  loading: () => <p className="text-ink-2">{t.order.loading}</p>,
});
