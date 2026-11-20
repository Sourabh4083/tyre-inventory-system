import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { BillDTO } from "@/lib/services/billing";
import type { BusinessSettingsData } from "@/lib/services/settings";
import { addressLines, formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_LABEL, amountsByMethod, paymentMethodsLabel } from "@/components/app/bill-badges";

// Noto Sans has the ₹ sign, which the PDF standard fonts lack. Listed in next.config.ts
// (outputFileTracingIncludes) so the files ship with the deployed route.
const FONT_DIR = path.join(process.cwd(), "src/assets/fonts");

const WIDTH = 300; // points: a receipt-shaped page, readable on a phone
const MARGIN = 20;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);

type Line =
  | { kind: "text"; text: string; size: number; bold?: boolean; muted?: boolean; align?: "left" | "center" }
  | { kind: "pair"; left: string; right: string; size: number; bold?: boolean }
  | { kind: "rule" }
  | { kind: "gap"; size: number };

/** Splits text into lines that fit `maxWidth` at `size`. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** The same content as the on-screen receipt (BillReceipt), as a PDF file for the customer to keep. */
export async function renderBillPdf(bill: BillDTO, settings: BusinessSettingsData): Promise<Uint8Array> {
  const { businessName, currencySymbol: sym } = settings;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(FONT_DIR, "NotoSans-Regular.ttf")),
    readFile(path.join(FONT_DIR, "NotoSans-Bold.ttf")),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(`${businessName} – ${bill.billNumber}`);
  doc.setAuthor(businessName);

  const due = Number(bill.balanceDue) > 0;
  const inner = WIDTH - MARGIN * 2;
  const lines: Line[] = [];
  for (const t of wrap(businessName, bold, 15, inner)) lines.push({ kind: "text", text: t, size: 15, bold: true, align: "center" });
  for (const a of addressLines(settings.shopAddress)) for (const t of wrap(a, regular, 8.5, inner)) lines.push({ kind: "text", text: t, size: 8.5, align: "center" });
  if (settings.shopPhone) lines.push({ kind: "text", text: `Phone: ${settings.shopPhone}`, size: 8.5, bold: true, align: "center" });
  lines.push({ kind: "gap", size: 3 });
  lines.push({ kind: "text", text: "BILL / RECEIPT", size: 8, muted: true, align: "center" }, { kind: "rule" });
  lines.push({ kind: "pair", left: "Bill no.", right: bill.billNumber, size: 9 });
  lines.push({ kind: "pair", left: "Date", right: formatDateTime(bill.createdAt), size: 9 });
  if (bill.customerName) lines.push({ kind: "pair", left: "Customer", right: bill.customerName, size: 9 });
  if (bill.customerPhone) lines.push({ kind: "pair", left: bill.customerName ? "" : "Customer", right: bill.customerPhone, size: 9 });
  lines.push({ kind: "rule" });
  for (const i of bill.items) {
    const label = `${i.name}${i.kind === "SERVICE" ? " (service)" : ""}`;
    const qty = `${i.quantity} × ${formatMoney(i.unitPrice, sym)}`;
    const nameLines = wrap(label, regular, 9, inner - 70);
    lines.push({ kind: "pair", left: nameLines[0], right: formatMoney(i.lineTotal, sym), size: 9 });
    for (const extra of nameLines.slice(1)) lines.push({ kind: "text", text: extra, size: 9 });
    if (i.quantity > 1) lines.push({ kind: "text", text: qty, size: 8, muted: true });
    lines.push({ kind: "gap", size: 2 });
  }
  lines.push({ kind: "rule" });
  lines.push({ kind: "pair", left: "Subtotal", right: formatMoney(bill.subtotal, sym), size: 9 });
  if (Number(bill.discount) > 0) lines.push({ kind: "pair", left: "Discount", right: `− ${formatMoney(bill.discount, sym)}`, size: 9 });
  lines.push({ kind: "pair", left: "Total", right: formatMoney(bill.total, sym), size: 12, bold: true });
  if (due) {
    lines.push({ kind: "pair", left: `Paid${bill.payments.length ? ` (${paymentMethodsLabel(bill.payments)})` : ""}`, right: formatMoney(bill.amountPaid, sym), size: 9 });
    lines.push({ kind: "pair", left: "Balance due", right: formatMoney(bill.balanceDue, sym), size: 10, bold: true });
  } else {
    const byMethod = amountsByMethod(bill.payments);
    if (byMethod.length > 1) for (const p of byMethod) lines.push({ kind: "pair", left: `Paid by ${PAYMENT_LABEL[p.method]}`, right: formatMoney(p.amount, sym), size: 9 });
    else if (bill.payments.length) lines.push({ kind: "pair", left: "Paid by", right: paymentMethodsLabel(bill.payments), size: 9 });
  }
  lines.push({ kind: "rule" });
  lines.push({ kind: "text", text: "Thank you for visiting! Please come again.", size: 9, bold: true, align: "center" });
  if (settings.onlineShopUrl) {
    lines.push({ kind: "gap", size: 4 });
    lines.push({ kind: "text", text: "Visit us online:", size: 8, muted: true, align: "center" });
    for (const t of wrap(settings.onlineShopUrl, regular, 8, inner)) lines.push({ kind: "text", text: t, size: 8, align: "center" });
  }

  const heightOf = (l: Line) => (l.kind === "rule" ? 12 : l.kind === "gap" ? l.size : l.size * 1.55);
  const height = MARGIN * 2 + lines.reduce((n, l) => n + heightOf(l), 0);
  const page = doc.addPage([WIDTH, height]);
  let y = height - MARGIN;
  for (const l of lines) {
    const h = heightOf(l);
    if (l.kind === "rule") {
      page.drawLine({ start: { x: MARGIN, y: y - h / 2 }, end: { x: WIDTH - MARGIN, y: y - h / 2 }, thickness: 0.6, color: MUTED });
    } else if (l.kind === "text") {
      const font = l.bold ? bold : regular;
      const x = l.align === "center" ? (WIDTH - font.widthOfTextAtSize(l.text, l.size)) / 2 : MARGIN;
      page.drawText(l.text, { x, y: y - l.size, size: l.size, font, color: l.muted ? MUTED : INK });
    } else if (l.kind === "pair") {
      const font = l.bold ? bold : regular;
      page.drawText(l.left, { x: MARGIN, y: y - l.size, size: l.size, font, color: l.bold ? INK : MUTED });
      page.drawText(l.right, { x: WIDTH - MARGIN - font.widthOfTextAtSize(l.right, l.size), y: y - l.size, size: l.size, font, color: INK });
    }
    y -= h;
  }
  return doc.save();
}
