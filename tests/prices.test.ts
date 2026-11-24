import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct, productForViewer, updateProductPrices } from "@/lib/services/products";
import { createBill } from "@/lib/services/billing";
import { listPriceChanges } from "@/lib/services/prices";
import { billCreateSchema, productCreateSchema, productPricesSchema } from "@/lib/validation/schemas";
import { createCategoryRow, seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = (await createCategoryRow("Tubes", false)).id;
});

const product = (name: string) =>
  createProduct(productCreateSchema.parse({ name, categoryId, startingQuantity: 10, sellingPrice: "1000", costPrice: "800" }), owner);

const sell = (productId: string) =>
  createBill(billCreateSchema.parse({ items: [{ kind: "PRODUCT", productId, quantity: 1, unitPrice: "1000" }], paymentMethod: "CASH" }), manager);

describe("company prices and price history", () => {
  it("counts profit from NLC when it is known, otherwise from the purchase price", async () => {
    const a = await product("Tube A");
    const b = await product("Tube B");
    await updateProductPrices(b.id, productPricesSchema.parse({ sellingPrice: "1000", costPrice: "800", nlc: "760" }), owner);

    await sell(a.id);
    await sell(b.id);
    const items = await prisma.billItem.findMany({ where: { productId: { in: [a.id, b.id] } } });
    expect(items.find((i) => i.productId === a.id)?.unitCost?.toString()).toBe("800");
    expect(items.find((i) => i.productId === b.id)?.unitCost?.toString()).toBe("760");
  });

  it("keeps a history row for every price the owner changes", async () => {
    const p = await product("Tube C");
    await updateProductPrices(p.id, productPricesSchema.parse({ sellingPrice: "1100", costPrice: "800", ndp: "850", nlc: "780", msrp: "1200" }), owner);
    const rows = (await listPriceChanges(p.id)).map((h) => [h.field, h.oldValue, h.newValue, h.source].join(" "));
    expect(rows.sort()).toEqual(
      [
        "MSRP  1200 MANUAL",
        "NDP  850 MANUAL",
        "NLC  780 MANUAL",
        "PURCHASE  800 MANUAL", // from creating the product
        "SELLING 1000 1100 MANUAL",
        "SELLING  1000 MANUAL", // from creating the product
      ].sort(),
    );
    // Saving the same prices again adds nothing.
    await updateProductPrices(p.id, productPricesSchema.parse({ sellingPrice: "1100.00", costPrice: "800", ndp: "850", nlc: "780", msrp: "1200" }), owner);
    expect(await listPriceChanges(p.id)).toHaveLength(6);
  });

  it("hides company prices from the manager and refuses their changes", async () => {
    const p = await product("Tube D");
    await updateProductPrices(p.id, productPricesSchema.parse({ sellingPrice: "1000", costPrice: "800", ndp: "850", nlc: "780", msrp: "1200" }), owner);
    const seen = productForViewer((await getProduct(p.id))!, "MANAGER");
    expect(seen).toMatchObject({ costPrice: null, ndp: null, nlc: null, msrp: null, sellingPrice: "1000" });
    await expect(updateProductPrices(p.id, productPricesSchema.parse({ sellingPrice: "1", nlc: "1" }), manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
