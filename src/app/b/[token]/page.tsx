import type { Metadata } from "next";
import { Download, Globe } from "lucide-react";
import { getSettings } from "@/lib/services/settings";
import { getSharedBill } from "@/lib/services/billing";
import { BillReceipt } from "@/components/app/bill-receipt";
import { Button } from "@/components/ui/button";

/**
 * The bill a customer opens from the WhatsApp message. No login: the secret code in
 * the address is the key, and it stops working after SHARE_LINK_DAYS. Kept out of
 * search engines and never says whether a wrong code belongs to a real bill.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: { absolute: `Your bill · ${settings.businessName}` },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function SharedBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [settings, bill] = await Promise.all([getSettings(), getSharedBill(token)]);
  const website = settings.onlineShopUrl ? (
    <Button size="lg" variant="outline" className="h-12 w-full" render={<a href={settings.onlineShopUrl} target="_blank" rel="noreferrer" />}>
      <Globe /> Visit us online
    </Button>
  ) : null;

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-4 py-8">
      {bill ? (
        <>
          <BillReceipt bill={bill} settings={settings} />
          <div className="flex flex-col gap-2 print:hidden">
            <Button size="lg" className="h-12" render={<a href={`/b/${encodeURIComponent(token)}/pdf`} download />}>
              <Download /> Download PDF
            </Button>
            {website}
          </div>
        </>
      ) : (
        <div className="space-y-5 rounded-2xl border bg-card p-6 text-center shadow-xs">
          <h1 className="font-heading text-xl font-semibold">{settings.businessName}</h1>
          <p className="text-sm text-muted-foreground">
            This bill link has expired.{" "}
            {settings.shopPhone ? (
              <>
                Please call the shop on{" "}
                <a href={`tel:${settings.shopPhone}`} className="font-medium text-foreground underline underline-offset-2">
                  {settings.shopPhone}
                </a>{" "}
                for a copy of your bill.
              </>
            ) : (
              "Please contact the shop for a copy of your bill."
            )}
          </p>
          {website}
        </div>
      )}
    </main>
  );
}
