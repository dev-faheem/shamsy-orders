import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { currentProfile } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  return (
    <>
      <AppHeader profile={profile} />
      <main className="flex-1 bg-panel">
        <div className="max-w-3xl mx-auto px-4 py-4">{children}</div>
      </main>
    </>
  );
}
