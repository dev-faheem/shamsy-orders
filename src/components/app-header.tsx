"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./logo";
import { clearOfflineCaches } from "./service-worker";
import { useOutbox } from "./use-outbox";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { t } from "@/i18n/en";
import type { Profile } from "@/lib/supabase/server";

export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const { items, online } = useOutbox(profile.id);
  const pending = items.filter((i) => i.status === "pending").length;

  const links = [
    { href: "/orders/new", label: t.nav.newOrder },
    { href: "/orders", label: t.nav.orders },
    ...(profile.role === "owner"
      ? [
          { href: "/approvals", label: t.nav.approvals },
          { href: "/settings", label: t.nav.settings },
        ]
      : []),
  ];

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    await clearOfflineCaches();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="bg-brand text-white border-b-4 border-gold sticky top-0 z-20">
      <div className="max-w-3xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <Logo />
        <div className="text-end text-xs leading-tight">
          <div className="font-medium">{profile.full_name}</div>
          <div className="text-gold-l">{t.roles[profile.role]}</div>
        </div>
      </div>
      <nav className="max-w-3xl mx-auto px-2 pb-2 flex items-center gap-1 overflow-x-auto text-sm">
        {links.map((l) => {
          const active = l.href === "/orders" ? pathname === "/orders" || /^\/orders\/(?!new)/.test(pathname) : pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded px-3 py-2 ${active ? "bg-brand-2 text-white font-semibold" : "text-white/80"}`}
            >
              {l.label}
            </Link>
          );
        })}
        <span className="flex-1" />
        <span
          className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${online ? "bg-white/10" : "bg-warn text-white"}`}
          role="status"
        >
          ● {online ? t.app.online : t.app.offline}
          {pending > 0 && ` · ${t.app.waitingToSync(pending)}`}
        </span>
        <button onClick={signOut} className="whitespace-nowrap rounded px-3 py-2 text-white/80">
          {t.app.signOut}
        </button>
      </nav>
    </header>
  );
}
