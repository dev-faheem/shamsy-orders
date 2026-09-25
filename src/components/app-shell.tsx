"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./logo";
import { clearOfflineCaches } from "./service-worker";
import { useOutbox } from "./use-outbox";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { t } from "@/i18n/en";
import type { Profile } from "@/lib/supabase/server";

/** Icons in the prototype's style: 24px viewBox, 2px round strokes. */
const icons = {
  newOrder: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </>
  ),
  orders: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </>
  ),
  approvals: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  signOut: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
};

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] shrink-0 fill-none stroke-current stroke-2 opacity-90 [stroke-linecap:round] [stroke-linejoin:round]">
      {icons[name]}
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Pending discount approvals, for the owner's menu badge. */
function usePendingApprovals(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const { count: n } = await supabaseBrowser()
        .from("discount_approvals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (alive && typeof n === "number") setCount(n);
    };
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return count;
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { items, online } = useOutbox(profile.id);
  const pending = items.filter((i) => i.status === "pending").length;
  const isOwner = profile.role === "owner";
  const approvals = usePendingApprovals(isOwner);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    await clearOfflineCaches();
    router.replace("/login");
    router.refresh();
  }

  const isActive = (href: string) =>
    href === "/orders" ? pathname === "/orders" || /^\/orders\/(?!new)/.test(pathname) : pathname === href;

  const item = (href: string, label: string, icon: keyof typeof icons, badge?: number) => (
    <Link
      key={href}
      href={href}
      onClick={() => setOpen(false)}
      aria-current={isActive(href) ? "page" : undefined}
      className={`flex items-center gap-3 border-s-[3px] px-4 py-2.5 text-[13px] transition-colors ${
        isActive(href)
          ? "border-gold bg-brand-2 font-semibold text-white"
          : "border-transparent font-medium text-white/85 hover:bg-brand-2 hover:text-white"
      }`}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {badge ? (
        <span className="ms-auto rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-brand" aria-label={t.nav.waiting(badge)}>
          {badge}
        </span>
      ) : null}
    </Link>
  );

  const section = (title: string) => (
    <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[1px] text-gold-l opacity-80">{title}</div>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="z-30 flex shrink-0 flex-col bg-brand text-white lg:sticky lg:top-0 lg:h-dvh lg:w-[250px] lg:border-e lg:border-brand-2">
        <div className="flex items-center gap-3 border-b-4 border-gold px-4 py-3 lg:p-4">
          <Link href="/orders/new" className="min-w-0 grow" onClick={() => setOpen(false)}>
            <Logo className="w-[170px] lg:w-full" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="main-menu"
            aria-label={open ? t.nav.closeMenu : t.nav.openMenu}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded border border-white/25 lg:hidden"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px] fill-none stroke-current stroke-2 [stroke-linecap:round]">
              {open ? (
                <>
                  <line x1="5" y1="5" x2="19" y2="19" />
                  <line x1="19" y1="5" x2="5" y2="19" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
            {!open && approvals > 0 && <span className="absolute -end-1 -top-1 h-3 w-3 rounded-full border-2 border-brand bg-gold" />}
          </button>
        </div>

        <div id="main-menu" className={`${open ? "flex" : "hidden"} grow flex-col lg:flex`}>
          <nav className="grow overflow-y-auto py-2 lg:py-4" aria-label={t.nav.label}>
            {section(t.nav.sales)}
            {item("/orders/new", t.nav.newOrder, "newOrder")}
            {item("/orders", t.nav.orders, "orders")}
            {isOwner && section(t.nav.control)}
            {isOwner && item("/approvals", t.nav.approvals, "approvals", approvals)}
          </nav>

          <div className="border-t border-brand-2 bg-black/15 py-3">
            {isOwner && item("/settings", t.nav.settings, "settings")}
            <div className="mt-1 flex items-center gap-2.5 px-4 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-[13px] font-bold text-brand" aria-hidden="true">
                {initials(profile.full_name) || "?"}
              </div>
              <div className="min-w-0 grow">
                <div className="truncate text-[13px] font-semibold">{profile.full_name}</div>
                <div className="truncate text-[11px] text-white/60">{t.roles[profile.role]}</div>
              </div>
              <button
                onClick={signOut}
                className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-white/75 hover:bg-brand-2 hover:text-white"
              >
                <Icon name="signOut" />
                {t.app.signOut}
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 grow flex-col">
        {(!online || pending > 0) && (
          <div role="status" className="border-b border-warn bg-[#fdf2e9] px-4 py-2 text-center text-[13px] font-semibold text-[#8a4a0f]">
            ● {online ? t.app.online : t.app.offline}
            {pending > 0 && ` · ${t.app.waitingToSync(pending)}`}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
