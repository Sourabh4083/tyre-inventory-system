import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PriceChangeSource, PriceField } from "@/generated/prisma/enums";
import { samePrice } from "@/lib/prices";

export { PRICE_FIELD_LABEL, costForProfit, samePrice } from "@/lib/prices";

type Money = { toString(): string } | string | number | null | undefined;
type Tx = Prisma.TransactionClient;

/** The product columns behind each kind of price. */
export const PRICE_COLUMNS = {
  NDP: "ndp",
  PURCHASE: "costPrice",
  NLC: "nlc",
  MSRP: "msrp",
  SELLING: "sellingPrice",
} as const satisfies Record<PriceField, string>;

export type PriceColumn = (typeof PRICE_COLUMNS)[PriceField];
export type PriceValues = Partial<Record<PriceColumn, Money>>;

/**
 * Writes one history row for each price in `after` that differs from `before`.
 * Prices missing from `after` are left out (not changed).
 */
export async function recordPriceChanges(
  tx: Tx,
  input: { productId: string; before: PriceValues; after: PriceValues; source: PriceChangeSource; actorId: string | null; note?: string | null },
): Promise<number> {
  const rows: Prisma.ProductPriceChangeCreateManyInput[] = [];
  for (const [field, column] of Object.entries(PRICE_COLUMNS) as [PriceField, PriceColumn][]) {
    if (!(column in input.after)) continue;
    const oldValue = input.before[column] ?? null;
    const newValue = input.after[column] ?? null;
    if (samePrice(oldValue, newValue)) continue;
    rows.push({
      productId: input.productId,
      field,
      oldValue: oldValue === null ? null : oldValue.toString(),
      newValue: newValue === null ? null : newValue.toString(),
      source: input.source,
      note: input.note ?? null,
      changedById: input.actorId,
    });
  }
  if (rows.length) await tx.productPriceChange.createMany({ data: rows });
  return rows.length;
}

export type PriceChangeDTO = {
  id: string;
  field: PriceField;
  oldValue: string | null;
  newValue: string | null;
  source: PriceChangeSource;
  note: string | null;
  changedByName: string | null;
  createdAt: string;
};

/** Owner only: the newest price changes of one product. */
export async function listPriceChanges(productId: string, take = 50): Promise<PriceChangeDTO[]> {
  const rows = await prisma.productPriceChange.findMany({
    where: { productId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    include: { changedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    oldValue: r.oldValue?.toString() ?? null,
    newValue: r.newValue?.toString() ?? null,
    source: r.source,
    note: r.note,
    changedByName: r.changedBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
