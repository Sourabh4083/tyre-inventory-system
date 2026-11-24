import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { PriceListImport } from "@/components/app/price-list-import";

export const metadata: Metadata = { title: "Import price list" };

export default async function PriceListImportPage() {
  const user = await requirePermissionPage("product.price.edit");
  if (user.role !== "OWNER") redirect("/dashboard?denied=1");
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/pricing" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Prices &amp; Margins
      </Link>
      <PageHeader
        title="Import price list"
        description="Upload the JK Tyre price list (.xlsx). You see every change first; nothing is saved until you press Import."
      />
      <PriceListImport currencySymbol={settings.currencySymbol} />
    </div>
  );
}
