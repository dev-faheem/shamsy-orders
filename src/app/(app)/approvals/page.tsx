import { redirect } from "next/navigation";
import { ApprovalsList } from "@/components/approvals-list";
import { Notice } from "@/components/notice";
import { PageBody, PageHeader } from "@/components/page-header";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { t } from "@/i18n/en";

export default async function ApprovalsPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  const { data: settings } = await (await supabaseServer()).from("settings").select("day_rate_sdg_per_usd").single();
  return (
    <>
      <PageHeader title={t.approvals.title} rate={settings?.day_rate_sdg_per_usd} />
      <PageBody>{profile.role !== "owner" ? <Notice tone="warn">{t.approvals.ownerOnly}</Notice> : <ApprovalsList />}</PageBody>
    </>
  );
}
