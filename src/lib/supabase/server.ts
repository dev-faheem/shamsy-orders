import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Supabase client acting as the signed-in user (from the session cookie). RLS applies. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes them.
        }
      },
    },
  });
}

/** Supabase client acting as the caller of an API request that sends `Authorization: Bearer <jwt>`. */
export function supabaseForBearer(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Profile {
  id: string;
  tenant_id: string;
  full_name: string;
  role: "owner" | "marketing" | "adviser" | "warehouse";
  order_prefix: string;
}

/** The signed-in user's profile, or null. Verifies the JWT rather than trusting the cookie. */
export async function currentProfile(): Promise<Profile | null> {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("id, tenant_id, full_name, role, order_prefix").eq("id", userId).single();
  return (data as Profile) ?? null;
}
