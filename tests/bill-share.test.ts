import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cancelBill, createBill, getOrCreateShareLink, getShareLinkExpiry, getSharedBill, turnOffShareLink } from "@/lib/services/billing";
import { buildBillWhatsappMessage } from "@/lib/bill-message";
import { renderBillPdf } from "@/lib/bill-pdf";
import { maskPhone } from "@/lib/phone";
import { SHARE_LINK_DAYS } from "@/lib/constants";
import type { BusinessSettingsData } from "@/lib/services/settings";
import { billCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;

const DAY = 24 * 60 * 60 * 1000;

function makeBill(overrides: Record<string, unknown> = {}) {
  return createBill(
    billCreateSchema.parse({
      items: [
        { kind: "SERVICE", name: "Wheel alignment", quantity: 1, unitPrice: "300" },
        { kind: "SERVICE", name: "Wheel balancing", quantity: 1, unitPrice: "800" },
      ],
      customerName: "Priya",
      customerPhone: "98765 43210",
      paymentMethod: "UPI",
      notes: "Front tyres rotated",
      ...overrides,
    }),
    manager,
  );
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
});

describe("bill link sent on WhatsApp", () => {
  it("is made on first send, reused while valid, and renewed once expired", async () => {
    const bill = await makeBill();
    const now = new Date();
    const first = await getOrCreateShareLink(bill.id, manager, now);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Date(first.expiresAt).getTime() - now.getTime()).toBe(SHARE_LINK_DAYS * DAY);

    const again = await getOrCreateShareLink(bill.id, manager, new Date(now.getTime() + 5 * DAY));
    expect(again).toEqual(first);

    const later = await getOrCreateShareLink(bill.id, manager, new Date(now.getTime() + SHARE_LINK_DAYS * DAY + 1000));
    expect(later.token).not.toBe(first.token);
    expect(await getSharedBill(first.token)).toBeNull();

    const audits = await prisma.auditLog.count({ where: { entityId: bill.id, action: "BILL_SHARED" } });
    expect(audits).toBe(2);
  });

  it("shows only receipt details: phone masked, notes and staff ids dropped", async () => {
    const bill = await makeBill();
    const { token } = await getOrCreateShareLink(bill.id, manager);
    const shared = await getSharedBill(token);
    expect(shared).not.toBeNull();
    expect(shared!.billNumber).toBe(bill.billNumber);
    expect(shared!.total).toBe("1100.00");
    expect(shared!.customerPhone).toBe("98XXXXX210");
    expect(shared!.notes).toBeNull();
    expect(shared!.id).toBe("");
    expect(shared!.payments.every((p) => p.createdById === "" && p.createdByName === "")).toBe(true);
  });

  it("stops working after 10 days, for a wrong code, when turned off, and when the bill is cancelled", async () => {
    const bill = await makeBill();
    const { token, expiresAt } = await getOrCreateShareLink(bill.id, manager);
    expect(await getSharedBill(token, new Date(new Date(expiresAt).getTime() + 1))).toBeNull();
    expect(await getSharedBill("not-a-real-code")).toBeNull();
    expect(await getSharedBill("")).toBeNull();

    expect(await getShareLinkExpiry(bill.id)).toBe(expiresAt);
    await turnOffShareLink(bill.id, owner);
    expect(await getSharedBill(token)).toBeNull();
    expect(await getShareLinkExpiry(bill.id)).toBeNull();

    const other = await makeBill();
    const link = await getOrCreateShareLink(other.id, manager);
    await cancelBill({ billId: other.id, reason: "Entered twice" }, owner);
    expect(await getSharedBill(link.token)).toBeNull();
  });

  it("refuses bills without a phone and cancelled bills; only the owner turns a link off", async () => {
    const noPhone = await makeBill({ customerName: undefined, customerPhone: undefined });
    await expect(getOrCreateShareLink(noPhone.id, manager)).rejects.toThrow(/no customer phone/);

    const cancelled = await makeBill();
    await cancelBill({ billId: cancelled.id, reason: "Mistake" }, owner);
    await expect(getOrCreateShareLink(cancelled.id, manager)).rejects.toThrow(/cancelled/);

    const bill = await makeBill();
    await getOrCreateShareLink(bill.id, manager);
    await expect(turnOffShareLink(bill.id, manager)).rejects.toThrow(/Only the owner/);
  });
});

describe("WhatsApp message", () => {
  it("has the shop name, items, total, payment, bill link and website", async () => {
    const bill = await makeBill();
    const msg = buildBillWhatsappMessage(bill, "https://example.test/b/abc", "Sharma Tyres & Wheel Care", "₹", "https://sharmatyres.example");
    expect(msg).toContain("Hi Priya, thank you for visiting *Sharma Tyres & Wheel Care*!");
    expect(msg).toContain(`\n*Bill No:* ${bill.billNumber}`);
    // Emoji, and symbols phones draw as emoji (♥ ✔), turn into � boxes through wa.me.
    expect([...msg].filter((c) => c.codePointAt(0)! > 0xffff || "♥✔".includes(c))).toEqual([]);
    expect(msg).toContain("• Wheel balancing – ₹800");
    expect(msg).toContain("*Total: ₹1,100* (Paid by UPI)");
    expect(msg).toContain("https://example.test/b/abc");
    expect(msg).toContain("https://sharmatyres.example");
    expect(msg).not.toContain("Balance due");
  });

  it("leaves out the website line when the shop has none", async () => {
    const bill = await makeBill();
    const msg = buildBillWhatsappMessage(bill, "https://example.test/b/abc", "Sharma Tyres", "₹", null);
    expect(msg).not.toContain("Visit us online");
  });

  it("shows what is still owed on a pay-later bill", async () => {
    const bill = await makeBill({ paymentMethod: "CASH", payLater: true, paidNow: "500" });
    const msg = buildBillWhatsappMessage(bill, "https://example.test/b/abc", "Sharma Tyres", "₹");
    expect(msg).toContain("*Total: ₹1,100*\n");
    expect(msg).toContain("*Balance due: ₹600*");
  });
});

describe("bill PDF", () => {
  const settings: BusinessSettingsData = {
    businessName: "Sharma Tyres & Wheel Care",
    currencyCode: "INR",
    currencySymbol: "₹",
    lowStockThreshold: 4,
    shopAddress: "Shop 4, Ring Road\nRaipur, Chhattisgarh",
    shopPhone: "98765 00000",
    onlineShopUrl: null,
    defaultTyreBrand: "JK Tyre",
  };

  it("renders a PDF with the rupee sign", async () => {
    const bill = await makeBill();
    const shared = (await getSharedBill((await getOrCreateShareLink(bill.id, manager)).token))!;
    const pdf = await renderBillPdf(shared, settings);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders without an address, phone or website", async () => {
    const bill = await makeBill();
    const pdf = await renderBillPdf(bill, { ...settings, shopAddress: "", shopPhone: "", onlineShopUrl: null });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("maskPhone", () => {
  it("keeps the first two and last three digits", () => {
    expect(maskPhone("+91 98765-43210")).toBe("98XXXXX210");
    expect(maskPhone("12")).toBe("XXXXX");
  });
});
