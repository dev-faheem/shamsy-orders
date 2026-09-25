import { redirect } from "next/navigation";
import { OrderScreenLoader } from "@/components/order-screen-loader";
import { currentProfile } from "@/lib/supabase/server";

export default async function NewOrderPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  return <OrderScreenLoader profile={profile} />;
}
