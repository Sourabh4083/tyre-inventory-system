import { beforeAll, describe, expect, it } from "vitest";
import { createProduct, findTyresBySize, listBrands, listProducts, listRimSizes, updateProduct } from "@/lib/services/products";
import { createBill, listBills } from "@/lib/services/billing";
import { saveOpenBill } from "@/lib/services/open-bills";
import { billCreateSchema, openBillSchema, productCreateSchema } from "@/lib/validation/schemas";
import { prisma } from "@/lib/db";
import { createCategoryRow, seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let carId: string;
let truckId: string;
let tubesId: string;

function tyre(overrides: Record<string, unknown>) {
  return productCreateSchema.parse({ name: "Tyre", categoryId: carId, startingQuantity: 0, ...overrides });
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  carId = (await createCategoryRow("Car & Jeep Tyres", true)).id;
  truckId = (await createCategoryRow("Truck & Bus Tyres", true)).id;
  tubesId = (await createCategoryRow("Tubes & Flaps", false)).id;
});

describe("tyre details on products", () => {
  it("needs a size in a tyre category, but not for tubes", async () => {
    await expect(createProduct(tyre({ name: "No size" }), owner)).rejects.toMatchObject({ field: "tyreSize" });
    const tube = await createProduct(tyre({ name: "Tube 90/90-12", categoryId: tubesId }), owner);
    expect(tube.tyreSize).toBeNull();
    expect(tube.categoryIsTyre).toBe(false);
  });

  it("tidies the size and reads rim, radial/bias and ply rating from it", async () => {
    const p = await createProduct(tyre({ name: "185/65 R15 JK Tyre UX Royale TL", tyreSize: "185/65r15", brand: "JK Tyre", pattern: "UX Royale", tubeType: "TL", vehicleType: "CAR_JEEP", startingQuantity: 4, sellingPrice: "5950" }), owner);
    expect(p).toMatchObject({ tyreSize: "185/65 R15", rimInch: "15", construction: "RADIAL", tubeType: "TL", vehicleType: "CAR_JEEP", brand: "JK Tyre", categoryIsTyre: true });

    const truck = await createProduct(tyre({ name: "10.00-20 Jet R Miles", categoryId: truckId, tyreSize: "10.00 - 20 16PR", brand: "JK Tyre", tubeType: "TTF", fitment: "ALL", nsdMm: "16.5" }), owner);
    expect(truck).toMatchObject({ tyreSize: "10.00-20", rimInch: "20", construction: "BIAS", plyRating: 16, nsdMm: "16.5", fitment: "ALL" });
  });

  it("keeps a radial/bias or ply rating that was picked by hand", async () => {
    const p = await createProduct(tyre({ name: "Picked by hand", categoryId: truckId, tyreSize: "10.00-20 16PR", construction: "RADIAL", plyRating: "18" }), owner);
    expect(p).toMatchObject({ construction: "RADIAL", plyRating: 18 });
  });

  it("lets the manager edit tyre details", async () => {
    const p = await createProduct(tyre({ name: "145/80 R12 Taximax", tyreSize: "145/80 R12", pattern: "Taximax" }), owner);
    const edited = await updateProduct(p.id, productCreateSchema.omit({ startingQuantity: true }).parse({ name: p.name, categoryId: carId, tyreSize: "145/80 R12", pattern: "Taximax", tubeType: "TL", fitment: "ALL" }), manager);
    expect(edited).toMatchObject({ tubeType: "TL", fitment: "ALL" });
  });

  it("refuses a material code that another product already has", async () => {
    await createProduct(tyre({ name: "Coded A", tyreSize: "175/65 R14", materialCode: "abc123" }), owner);
    await expect(createProduct(tyre({ name: "Coded B", tyreSize: "175/65 R14", materialCode: "ABC123" }), owner)).rejects.toMatchObject({ field: "materialCode" });
  });
});

describe("search by size", () => {
  beforeAll(async () => {
    await createProduct(tyre({ name: "185/65 R15 Taximax TL", tyreSize: "185/65 R15", brand: "JK Tyre", pattern: "Taximax", tubeType: "TL", startingQuantity: 0, sellingPrice: "6000" }), owner);
    await createProduct(tyre({ name: "185/65 R15 MRF ZVTV", tyreSize: "1856515", brand: "MRF", pattern: "ZVTV", tubeType: "TL", startingQuantity: 2, sellingPrice: "5800" }), owner);
    await createProduct(tyre({ name: "185/70 R14 Ultima", tyreSize: "185/70 R14", brand: "JK Tyre", startingQuantity: 1 }), owner);
  });

  it("finds the same tyres however the size is typed", async () => {
    for (const typed of ["185/65 R15", "185/65r15", "185 65 15", "1856515"]) {
      const names = (await listProducts({ search: typed })).items.map((p) => p.name).sort();
      expect(names, typed).toEqual(["185/65 R15 JK Tyre UX Royale TL", "185/65 R15 MRF ZVTV", "185/65 R15 Taximax TL"]);
    }
  });

  it("filters by vehicle, brand, rim, tube type and fitment", async () => {
    expect((await listProducts({ brand: "mrf" })).items.map((p) => p.name)).toEqual(["185/65 R15 MRF ZVTV"]);
    expect((await listProducts({ rimInch: 20 })).items.every((p) => p.rimInch === "20")).toBe(true);
    expect((await listProducts({ vehicleType: "CAR_JEEP" })).items.length).toBeGreaterThanOrEqual(1);
    expect((await listProducts({ tubeType: "TTF" })).items.map((p) => p.name)).toEqual(["10.00-20 Jet R Miles"]);
    expect((await listProducts({ fitment: "ALL", rimInch: 12 })).items.map((p) => p.name)).toEqual(["145/80 R12 Taximax"]);
    expect(await listBrands()).toEqual(["JK Tyre", "MRF"]);
    expect(await listRimSizes()).toEqual(expect.arrayContaining([12, 14, 15, 20]));
  });

  it("groups the Find by size screen by size, in stock and cheapest first", async () => {
    const groups = await findTyresBySize("185 65 15");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ size: "185/65 R15", totalQuantity: 6 });
    // In stock first, cheapest first among them (MRF 5800, UX Royale 5950); the out-of-stock Taximax last.
    expect(groups[0].products.map((p) => p.name)).toEqual(["185/65 R15 MRF ZVTV", "185/65 R15 JK Tyre UX Royale TL", "185/65 R15 Taximax TL"]);

    const wider = await findTyresBySize("185");
    expect(wider.map((g) => g.size)).toEqual(["185/65 R15", "185/70 R14"]);
    expect(await findTyresBySize("hello")).toEqual([]);
  });
});

describe("vehicle number on bills", () => {
  it("is tidied, saved, printed on the bill and found by search however it is typed", async () => {
    const bill = await createBill(
      billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Wheel alignment", quantity: 1, unitPrice: "500" }], vehicleNumber: "cg-04 ab 1234", paymentMethod: "CASH" }),
      manager,
    );
    expect(bill.vehicleNumber).toBe("CG 04 AB 1234");
    const row = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(row.vehicleKey).toBe("CG04AB1234");

    for (const typed of ["CG04AB1234", "cg 04 ab", "AB 1234"]) {
      expect((await listBills({ search: typed })).items.map((b) => b.id), typed).toContain(bill.id);
    }
  });

  it("is kept on an open bill", async () => {
    const employee = await prisma.employee.create({ data: { name: "Fitter Raju" } });
    const open = await saveOpenBill(
      openBillSchema.parse({ employeeIds: [employee.id], vehicleNumber: "mh12 ab 9999", items: [{ kind: "SERVICE", name: "Wheel balancing", quantity: 4, unitPrice: "100" }] }),
      manager,
    );
    expect(open.vehicleNumber).toBe("MH12 AB 9999");
  });
});
