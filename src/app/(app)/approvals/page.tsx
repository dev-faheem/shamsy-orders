import { redirect } from "next/navigation";
import { ApprovalsList } from "@/components/approvals-list";
import { currentProfile } from "@/lib/supabase/server";
import { t } from "@/i18n/en";

export default async function ApprovalsPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") return <p className="rounded-md border border-line bg-white p-4">{t.approvals.ownerOnly}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-brand">{t.approvals.title}</h1>
      <ApprovalsList />
    </div>
  );
}
