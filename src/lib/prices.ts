import type { PriceField } from "@/generated/prisma/enums";
import { toPaise } from "@/lib/money";

/** Plain helpers about prices, safe to use in the browser. */

type Money = { toString(): string } | string | number | null | undefined;

export const PRICE_FIELD_LABEL: Record<PriceField, string> = {
  NDP: "NDP",
  PURCHASE: "Purchase price",
  NLC: "NLC",
  MSRP: "MSRP",
  SELLING: "Selling price",
};

function paise(v: Money): number | null {
  if (v === null || v === undefined || v === "") return null;
  return toPaise(v.toString());
}

/** Same amount, however it is written ("5194", "5194.00", a Decimal). */
export function samePrice(a: Money, b: Money): boolean {
  return paise(a) === paise(b);
}

/**
 * The cost a sale's profit is worked out from: the company's net landing cost when it is
 * known, otherwise what the shop paid for it.
 */
export function costForProfit(p: { nlc?: Money; costPrice?: Money }): string | null {
  const v = p.nlc ?? p.costPrice;
  return v === null || v === undefined ? null : v.toString();
}
