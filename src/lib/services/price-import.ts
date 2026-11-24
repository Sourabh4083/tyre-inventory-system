import { prisma } from "@/lib/db";
import type { Fitment, PriceField, TubeType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/services/audit";
import { nextProductNumber } from "@/lib/services/products";
import { PRICE_COLUMNS, recordPriceChanges, samePrice, type PriceColumn } from "@/lib/services/prices";
import { PRICE_LIST_BRAND, readJkPriceList, type PriceListProblem, type PriceListRow } from "@/lib/price-list/jk";
import { buildTyreName, parseTyreSize } from "@/lib/tyre";

/**
 * Importing the company price list: each row finds its product (or is added as a new
 * tyre with no stock), and the prices that changed are saved with a history entry.
 * Nothing is saved by the preview; the import itself can be run again safely.
 */

export type PriceChangeLine = { field: PriceField; oldValue: string | null; newValue: string };

export type ImportUpdate = { line: number; productId: string; productName: string; changes: PriceChangeLine[] };
export type ImportCreate = { line: number; name: string; vehicleType: PriceListRow["vehicleType"]; ndp: string | null; nlc: string | null; msrp: string | null };

export type ImportPreview = {
  fileName: string;
  rowsRead: number;
  ocrFixes: number;
  updates: ImportUpdate[];
  creates: ImportCreate[];
  unchanged: number;
  /** Rows that couldn't be read, or that fit more than one product; they are skipped. */
  skipped: PriceListProblem[];
};

export type ImportResult = { updated: number; created: number; unchanged: number; skipped: number };

type ProductLite = {
  id: string;
  name: string;
  priceListKey: string | null;
  materialCode: string | null;
  sizeKey: string | null;
  pattern: string | null;
  brand: string | null;
  plyRating: number | null;
  tubeType: TubeType | null;
  fitment: Fitment | null;
  ndp: { toString(): string } | null;
  costPrice: { toString(): string } | null;
  nlc: { toString(): string } | null;
  msrp: { toString(): string } | null;
  sellingPrice: { toString(): string } | null;
};

type Planned =
  | { kind: "update"; row: PriceListRow; product: ProductLite; after: Partial<Record<PriceColumn, string>>; changes: PriceChangeLine[]; setKey: boolean; setCode: boolean }
  | { kind: "same"; row: PriceListRow; product: ProductLite; setKey: boolean; setCode: boolean }
  | { kind: "create"; row: PriceListRow };

const normPattern = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9+]+/g, " ").trim();
const productSelect = {
  id: true,
  name: true,
  priceListKey: true,
  materialCode: true,
  sizeKey: true,
  pattern: true,
  brand: true,
  plyRating: true,
  tubeType: true,
  fitment: true,
  ndp: true,
  costPrice: true,
  nlc: true,
  msrp: true,
  sellingPrice: true,
} as const;

/** The list's prices for a row, by product column. Prices the list leaves blank are not touched. */
function listPrices(row: PriceListRow, product: ProductLite | null): Partial<Record<PriceColumn, string>> {
  const out: Partial<Record<PriceColumn, string>> = {};
  if (row.ndp) out.ndp = row.ndp;
  if (row.purchase) out.costPrice = row.purchase;
  if (row.nlc) out.nlc = row.nlc;
  if (row.msrp) out.msrp = row.msrp;
  // MSRP only fills a selling price that is still empty; the shop's own price is never replaced.
  if (row.msrp && !product?.sellingPrice) out.sellingPrice = row.msrp;
  return out;
}

function plan(rows: PriceListRow[], products: ProductLite[]): { planned: Planned[]; skipped: PriceListProblem[] } {
  const byKey = new Map<string, ProductLite>();
  const byCode = new Map<string, ProductLite>();
  const bySize = new Map<string, ProductLite[]>();
  for (const p of products) {
    if (p.priceListKey) byKey.set(p.priceListKey, p);
    if (p.materialCode) byCode.set(p.materialCode.toUpperCase(), p);
    if (p.sizeKey) bySize.set(p.sizeKey, [...(bySize.get(p.sizeKey) ?? []), p]);
  }

  // A product the shop added by hand is found by size + pattern; ply, tube type and fitment
  // must agree where both sides have them. Only a product of this brand (or no brand) counts.
  const found: { row: PriceListRow; product: ProductLite | null; how: "key" | "code" | "details" | "none"; ambiguous?: boolean }[] = rows.map((row) => {
    const byListKey = byKey.get(row.key);
    if (byListKey) return { row, product: byListKey, how: "key" };
    const coded = row.materialCode ? byCode.get(row.materialCode.toUpperCase()) : undefined;
    if (coded) return { row, product: coded, how: "code" };
    const pattern = normPattern(row.pattern);
    const fits = (bySize.get(row.sizeKey) ?? []).filter(
      (p) =>
        !p.priceListKey && // already tied to another row of the list
        normPattern(p.pattern) === pattern &&
        (!p.brand || /\bJK\b/i.test(p.brand)) &&
        (p.plyRating == null || row.plyRating == null || p.plyRating === row.plyRating) &&
        (p.tubeType == null || row.tubeType == null || p.tubeType === row.tubeType) &&
        (p.fitment == null || row.fitment == null || p.fitment === "ALL" || row.fitment === "ALL" || p.fitment === row.fitment),
    );
    if (fits.length === 1) return { row, product: fits[0], how: "details" };
    return { row, product: null, how: "none", ambiguous: fits.length > 1 };
  });

  // One product found by its details for two rows (e.g. tubeless and tube type) is unclear.
  const claims = new Map<string, number[]>();
  for (const f of found) if (f.how === "details") claims.set(f.product!.id, [...(claims.get(f.product!.id) ?? []), f.row.line]);

  const planned: Planned[] = [];
  const skipped: PriceListProblem[] = [];
  const codesTaken = new Set(byCode.keys());
  for (const f of found) {
    const { row } = f;
    const text = `${row.size} ${row.pattern}${row.plyRating ? ` ${row.plyRating}PR` : ""}${row.tubeType ? ` ${row.tubeType}` : ""}`;
    if (f.ambiguous) {
      skipped.push({ line: row.line, text, reason: "More than one product in the shop fits this row. Add the company code to the right product, then import again." });
      continue;
    }
    if (f.how === "details" && claims.get(f.product!.id)!.length > 1) {
      const others = claims.get(f.product!.id)!.filter((l) => l !== row.line);
      skipped.push({ line: row.line, text, reason: `"${f.product!.name}" fits this row and row ${others.join(", ")}. Set its tube type or ply rating, then import again.` });
      continue;
    }
    if (!f.product) {
      planned.push({ kind: "create", row });
      continue;
    }
    const product = f.product;
    const setKey = product.priceListKey !== row.key;
    const setCode = Boolean(row.materialCode && !product.materialCode && !codesTaken.has(row.materialCode.toUpperCase()));
    const after = listPrices(row, product);
    const changes: PriceChangeLine[] = [];
    for (const [field, column] of Object.entries(PRICE_COLUMNS) as [PriceField, PriceColumn][]) {
      const next = after[column];
      if (next === undefined || samePrice(product[column], next)) continue;
      changes.push({ field, oldValue: product[column]?.toString() ?? null, newValue: next });
    }
    planned.push(changes.length ? { kind: "update", row, product, after, changes, setKey, setCode } : { kind: "same", row, product, setKey, setCode });
  }
  return { planned, skipped };
}

function newName(row: PriceListRow) {
  return buildTyreName({ tyreSize: row.size, brand: PRICE_LIST_BRAND, pattern: row.pattern, plyRating: row.plyRating, tubeType: row.tubeType });
}

async function load(data: Uint8Array) {
  let parsed;
  try {
    parsed = readJkPriceList(data);
  } catch {
    throw new AppError("This file could not be opened. Upload the price list as an .xlsx file.");
  }
  if (!parsed.rows.length) throw new AppError("No tyres were found in this file. Is it the JK price list?");
  const products = await prisma.product.findMany({ select: productSelect });
  return { parsed, ...plan(parsed.rows, products) };
}

export async function previewPriceList(data: Uint8Array, fileName: string): Promise<ImportPreview> {
  const { parsed, planned, skipped } = await load(data);
  return {
    fileName,
    rowsRead: parsed.rows.length,
    ocrFixes: parsed.ocrFixes,
    updates: planned.flatMap((p) => (p.kind === "update" ? [{ line: p.row.line, productId: p.product.id, productName: p.product.name, changes: p.changes }] : [])),
    creates: planned.flatMap((p) =>
      p.kind === "create" ? [{ line: p.row.line, name: newName(p.row), vehicleType: p.row.vehicleType, ndp: p.row.ndp, nlc: p.row.nlc, msrp: p.row.msrp }] : [],
    ),
    unchanged: planned.filter((p) => p.kind === "same").length,
    skipped: [...parsed.problems, ...skipped].sort((a, b) => a.line - b.line),
  };
}

const BATCH = 40;

export async function importPriceList(data: Uint8Array, fileName: string, actor: SessionUser): Promise<ImportResult> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can import a price list.", "FORBIDDEN");
  const { parsed, planned, skipped } = await load(data);
  const note = fileName.replace(/\.xlsx?$/i, "");

  const needsCategory = planned.some((p) => p.kind === "create");
  const tyres = needsCategory ? await prisma.category.findFirst({ where: { isTyre: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) : null;
  if (needsCategory && !tyres) throw new AppError("Add a tyre category (Settings → Categories) before importing new tyres.");

  let updated = 0;
  let created = 0;
  let unchanged = 0;
  // Small batches keep each transaction short; running the import again finishes any batch that failed.
  for (let i = 0; i < planned.length; i += BATCH) {
    const batch = planned.slice(i, i + BATCH);
    await prisma.$transaction(
      async (tx) => {
        for (const p of batch) {
          if (p.kind === "create") {
            const { row } = p;
            const size = parseTyreSize(row.size);
            const prices = listPrices(row, null);
            const product = await tx.product.create({
              data: {
                productNumber: await nextProductNumber(tx),
                name: newName(row),
                categoryId: tyres!.id,
                unit: "PIECE",
                quantity: 0,
                brand: PRICE_LIST_BRAND,
                pattern: row.pattern,
                tyreSize: row.size,
                sizeKey: row.sizeKey,
                rimInch: size?.rimInch ?? null,
                construction: size?.construction ?? null,
                plyRating: row.plyRating,
                tubeType: row.tubeType,
                fitment: row.fitment,
                vehicleType: row.vehicleType,
                nsdMm: row.nsdMm,
                materialCode: row.materialCode,
                priceListKey: row.key,
                ...prices,
                createdById: actor.id,
                updatedById: actor.id,
              },
              select: { id: true },
            });
            await recordPriceChanges(tx, { productId: product.id, before: {}, after: prices, source: "PRICE_LIST", actorId: actor.id, note });
            created++;
            continue;
          }
          const extra = { ...(p.setKey ? { priceListKey: p.row.key } : {}), ...(p.setCode ? { materialCode: p.row.materialCode } : {}) };
          if (p.kind === "same") {
            if (Object.keys(extra).length) await tx.product.update({ where: { id: p.product.id }, data: extra });
            unchanged++;
            continue;
          }
          await tx.product.update({ where: { id: p.product.id }, data: { ...p.after, ...extra, updatedById: actor.id } });
          await recordPriceChanges(tx, { productId: p.product.id, before: p.product, after: p.after, source: "PRICE_LIST", actorId: actor.id, note });
          updated++;
        }
      },
      { timeout: 60_000 },
    );
  }

  await recordAudit(prisma, {
    action: "PRICE_LIST_IMPORTED",
    entityType: "PriceList",
    entityId: note,
    summary: `Imported price list ${note}: ${updated} updated, ${created} added, ${unchanged} unchanged, ${parsed.problems.length + skipped.length} skipped`,
    metadata: { fileName, updated, created, unchanged, skipped: parsed.problems.length + skipped.length },
    actorId: actor.id,
  });
  return { updated, created, unchanged, skipped: parsed.problems.length + skipped.length };
}
