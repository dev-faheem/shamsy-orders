"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Notice } from "@/components/notice";
import { buttonCls, inputCls } from "@/components/styles";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { t } from "@/i18n/en";

// Invented demo accounts for the trial (see scripts/seed.ts). Not real people or data.
const DEMO = [
  { label: "Sana — sales adviser", email: "sana@shamsy.test", password: "sana-demo-2026" },
  { label: "Owner", email: "owner@shamsy.test", password: "owner-demo-2026" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(t.login.failed);
      return;
    }
    router.replace("/orders/new");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <header className="border-b-4 border-gold bg-brand px-4 py-3">
        <Logo className="w-[170px]" />
      </header>
      <div className="flex flex-1 items-start justify-center px-4 py-8 lg:items-center">
        <div className="w-full max-w-sm rounded-[4px] border border-line bg-panel p-5">
          <h1 className="mb-4 text-xl font-bold text-ink">{t.login.title}</h1>
          <form onSubmit={signIn} className="space-y-4 rounded-[4px] border border-line border-t-[3px] border-t-gold bg-white p-4">
            <label className="block">
              <span className="text-[13px] font-semibold">{t.login.email}</span>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold">{t.login.password}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} mt-1`}
              />
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <button type="submit" disabled={busy} className={`${buttonCls} w-full py-3 text-base`}>
              {busy ? t.login.busy : t.login.submit}
            </button>
          </form>

          <h2 className="proto-h2 mt-5">{t.login.demo}</h2>
          <div className="grid gap-2">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                }}
                className="rounded-[4px] border border-s-4 border-line border-s-brand-2 bg-white px-3 py-2 text-start text-[13px] hover:border-s-gold"
              >
                <span className="font-bold">{d.label}</span>
                <span className="block text-ink-2">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
