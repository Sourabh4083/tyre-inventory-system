import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { createProduct } from "@/lib/services/products";
import { importPriceList, previewPriceList } from "@/lib/services/price-import";
import { productCreateSchema } from "@/lib/validation/schemas";
import { createCategoryRow, seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let tyresId: string;

/** A small list in the same layout as the JK truck table. */
function listFile(rows: (string | number)[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["JK TYRE & INDUSTRIES LTD. TRUCK/BUS BIAS NET LANDING COST (NLC) | MSRP 30-09-2026"],
    ["S.No.", "Pattern", "Brand", "Size", "NDP (TTF)", "Invoice Value / Tyre", "NLC / Tyre", "MSRP / Pair"],
    ...rows,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Table 1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const OCT = listFile([
  [1, "Rib", "JET R MILES", "7.50-20 12PR", 9565, 10805, 10616, 22500],
  [2, "", "", "8.25-20 16PR", 11425, 12912, 12686, 26900],
  [3, "", "JET RIB STAR", "10.00-20 18PR", 15275, 17268, 16965, 35800],
]);

function tyre(overrides: Record<string, unknown>) {
  return productCreateSchema.parse({ name: "Tyre", categoryId: tyresId, startingQuantity: 0, ...overrides });
}

beforeEach(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  tyresId = (await createCategoryRow("Tyres", true)).id;
});

describe("price list import", () => {
  it("finds the shop's own tyre by size and pattern, and adds the rest with no stock", async () => {
    const own = await createProduct(
      tyre({ name: "7.50-20 Jet R Miles", tyreSize: "7.50-20", pattern: "Jet R Miles", brand: "JK Tyre", startingQuantity: 6, costPrice: "10000", sellingPrice: "12000" }),
      owner,
    );

    const preview = await previewPriceList(OCT, "Price List Oct-26.xlsx");
    expect(preview.updates).toEqual([expect.objectContaining({ productId: own.id })]);
    expect(preview.creates.map((c) => c.name)).toEqual(["8.25-20 JK Tyre JET R MILES 16PR TTF", "10.00-20 JK Tyre JET RIB STAR 18PR TTF"]);
    expect(await prisma.productPriceChange.count({ where: { source: "PRICE_LIST" } })).toBe(0); // the preview saves nothing

    const result = await importPriceList(OCT, "Price List Oct-26.xlsx", owner);
    expect(result).toEqual({ updated: 1, created: 2, unchanged: 0, skipped: 0 });

    const after = await prisma.product.findUniqueOrThrow({ where: { id: own.id } });
    // The shop's selling price stays; the company prices and the purchase price come in.
    expect(after).toMatchObject({ quantity: 6, priceListKey: "JK|75020|JET R MILES|12|TTF|" });
    expect(after.sellingPrice?.toString()).toBe("12000");
    expect(after.costPrice?.toString()).toBe("10805");
    expect(after.nlc?.toString()).toBe("10616");
    expect(after.msrp?.toString()).toBe("11250");

    const history = await prisma.productPriceChange.findMany({ where: { productId: own.id, source: "PRICE_LIST" }, orderBy: { field: "asc" } });
    expect(history.map((h) => [h.field, h.oldValue?.toString() ?? null, h.newValue?.toString(), h.note])).toEqual([
      ["NDP", null, "9565", "Price List Oct-26"],
      ["PURCHASE", "10000", "10805", "Price List Oct-26"],
      ["NLC", null, "10616", "Price List Oct-26"],
      ["MSRP", null, "11250", "Price List Oct-26"],
    ]);

    const added = await prisma.product.findFirstOrThrow({ where: { sizeKey: "82520" } });
    expect(added).toMatchObject({ quantity: 0, brand: "JK Tyre", pattern: "JET R MILES", plyRating: 16, tubeType: "TTF", vehicleType: "TRUCK_BUS", construction: "BIAS", categoryId: tyresId });
    // A new tyre's selling price starts at MSRP.
    expect(added.sellingPrice?.toString()).toBe("13450");
  });

  it("changes nothing when the same list is imported again", async () => {
    await importPriceList(OCT, "Price List Oct-26.xlsx", owner);
    const products = await prisma.product.count();
    const changes = await prisma.productPriceChange.count();

    const preview = await previewPriceList(OCT, "Price List Oct-26.xlsx");
    expect(preview).toMatchObject({ updates: [], creates: [], unchanged: 3 });
    expect(await importPriceList(OCT, "Price List Oct-26.xlsx", owner)).toEqual({ updated: 0, created: 0, unchanged: 3, skipped: 0 });
    expect(await prisma.product.count()).toBe(products);
    expect(await prisma.productPriceChange.count()).toBe(changes);
  });

  it("updates the same products from next month's list, found by their list key", async () => {
    await importPriceList(OCT, "Price List Oct-26.xlsx", owner);
    const nov = listFile([
      [1, "Rib", "JET R MILES", "7.50-20 12PR", 9700, 10950, 10760, 22800],
      [2, "", "", "8.25-20 16PR", 11425, 12912, 12686, 26900],
      [3, "", "JET RIB STAR", "10.00-20 18PR", 15275, 17268, 16965, 35800],
    ]);
    expect(await importPriceList(nov, "Price List Nov-26.xlsx", owner)).toEqual({ updated: 1, created: 0, unchanged: 2, skipped: 0 });
    const p = await prisma.product.findFirstOrThrow({ where: { sizeKey: "75020" } });
    expect(p.nlc?.toString()).toBe("10760");
    // MSRP moved, but the selling price filled at the first import is now the shop's own.
    expect(p.sellingPrice?.toString()).toBe("11250");
  });

  it("skips a row that more than one shop product fits", async () => {
    await createProduct(tyre({ name: "Jet R Miles A", tyreSize: "7.50-20", pattern: "JET R MILES" }), owner);
    await createProduct(tyre({ name: "Jet R Miles B", tyreSize: "7.50-20", pattern: "JET R MILES" }), owner);
    const preview = await previewPriceList(OCT, "x.xlsx");
    expect(preview.skipped).toEqual([expect.objectContaining({ line: 3, reason: expect.stringContaining("More than one product") })]);
    expect(preview.creates).toHaveLength(2);
  });

  it("does not tie one shop product to two rows of the list", async () => {
    // No ply rating: it fits both the 12PR and the 14PR row of the same size.
    await createProduct(tyre({ name: "7.50-20 Jet R Miles", tyreSize: "7.50-20", pattern: "JET R MILES" }), owner);
    const file = listFile([
      [1, "Rib", "JET R MILES", "7.50-20 12PR", 9565, 10805, 10616, 22500],
      [2, "", "", "7.50-20 14PR", 9735, 11000, 10807, 22900],
    ]);
    const preview = await previewPriceList(file, "x.xlsx");
    expect(preview.skipped.map((s) => s.line)).toEqual([3, 4]);
    expect(preview.updates).toHaveLength(0);
    expect(preview.creates).toHaveLength(0);
  });

  it("is for the owner only", async () => {
    await expect(importPriceList(OCT, "x.xlsx", manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("says so when the file is not a price list", async () => {
    await expect(previewPriceList(new TextEncoder().encode("hello"), "x.xlsx")).rejects.toThrow(/No tyres were found|could not be opened/);
  });
});
