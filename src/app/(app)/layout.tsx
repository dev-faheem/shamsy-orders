import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { currentProfile } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  return (
    <AppShell profile={profile}>
      <main className="flex-1 bg-white">{children}</main>
    </AppShell>
  );
}
