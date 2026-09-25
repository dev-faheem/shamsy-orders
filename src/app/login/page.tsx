"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
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
    <main className="min-h-dvh bg-panel flex flex-col">
      <header className="bg-brand border-b-4 border-gold px-4 py-4">
        <Logo />
      </header>
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <form onSubmit={signIn} className="w-full max-w-sm bg-white rounded-lg border border-line p-5 space-y-4">
          <h1 className="text-xl font-semibold text-brand">{t.login.title}</h1>
          <label className="block">
            <span className="text-sm text-ink-2">{t.login.email}</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-3"
            />
          </label>
          <label className="block">
            <span className="text-sm text-ink-2">{t.login.password}</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-3"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-ink">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-brand text-white py-3 font-semibold disabled:opacity-60"
          >
            {busy ? t.login.busy : t.login.submit}
          </button>

          <div className="pt-2 border-t border-line">
            <p className="text-sm text-ink-2 mb-2">{t.login.demo}</p>
            <div className="grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                  className="text-start rounded-md border border-line px-3 py-2 text-sm hover:bg-panel"
                >
                  <span className="font-medium">{d.label}</span>
                  <span className="block text-ink-2">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
