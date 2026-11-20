import { cache } from "react";
import { prisma } from "@/lib/db";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/stock-status";

export type BusinessSettingsData = {
  businessName: string;
  currencyCode: string;
  currencySymbol: string;
  lowStockThreshold: number;
  /** Printed under the shop name on bills, one line per address line. */
  shopAddress: string;
  shopPhone: string;
  /** Website or online shop shown on bills and in the WhatsApp message; null when the shop has none. */
  onlineShopUrl: string | null;
  /** Filled in on new tyres; the dealer's main brand. */
  defaultTyreBrand: string;
};

const DEFAULTS: BusinessSettingsData = {
  businessName: "Tyre Shop",
  currencyCode: "INR",
  currencySymbol: "₹",
  lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
  shopAddress: "",
  shopPhone: "",
  onlineShopUrl: null,
  defaultTyreBrand: "JK Tyre",
};

/**
 * Returns the single settings row, creating it with defaults on first use.
 * Deduplicated per request: the layout, page and services all read it.
 */
export const getSettings = cache(async (): Promise<BusinessSettingsData> => {
  const row =
    (await prisma.businessSettings.findUnique({ where: { id: "default" } })) ??
    (await prisma.businessSettings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", ...DEFAULTS },
    }));
  return {
    businessName: row.businessName,
    currencyCode: row.currencyCode,
    currencySymbol: row.currencySymbol,
    lowStockThreshold: row.lowStockThreshold,
    shopAddress: row.shopAddress,
    shopPhone: row.shopPhone,
    onlineShopUrl: row.onlineShopUrl,
    defaultTyreBrand: row.defaultTyreBrand,
  };
});

export async function updateSettings(data: BusinessSettingsData, actorId: string) {
  const before = await getSettings();
  const row = await prisma.businessSettings.update({ where: { id: "default" }, data });
  await prisma.auditLog.create({
    data: {
      action: "SETTINGS_UPDATED",
      entityType: "BusinessSettings",
      entityId: "default",
      summary: `Business settings updated (low stock threshold ${before.lowStockThreshold} → ${row.lowStockThreshold})`,
      metadata: { before, after: data },
      actorId,
    },
  });
  return row;
}

/** The shop's owners (partners), or an empty list until they are typed in Settings. */
export async function getOwnerNames(): Promise<string[]> {
  await getSettings(); // makes sure the settings row exists
  const row = await prisma.businessSettings.findUnique({ where: { id: "default" }, select: { ownerNames: true } });
  return row?.ownerNames ?? [];
}

export async function setOwnerNames(names: string[], actorId: string) {
  const before = await getOwnerNames();
  await prisma.businessSettings.update({ where: { id: "default" }, data: { ownerNames: names } });
  await prisma.auditLog.create({
    data: {
      action: "SETTINGS_UPDATED",
      entityType: "BusinessSettings",
      entityId: "default",
      summary: `Owners set to ${names.length ? names.join(" and ") : "none"}`,
      metadata: { before, after: names },
      actorId,
    },
  });
}
