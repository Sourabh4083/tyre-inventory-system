import { cache } from "react";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Fitment, MovementType, ProductStatus, Role, TubeType, TyreConstruction, Unit, VehicleType } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { getSettings } from "@/lib/services/settings";
import { recordAudit } from "@/lib/services/audit";
import { effectiveThreshold, getStockStatus, type StockStatus } from "@/lib/stock-status";
import { MANAGER_EDITABLE_PRODUCT_FIELDS } from "@/lib/permissions";
import { PAGE_SIZE } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";
import type { z } from "zod";
import type { productCreateSchema, productPricesSchema, productUpdateSchema } from "@/lib/validation/schemas";
import { fromPaise, toPaise } from "@/lib/money";
import { parseTyreSize, sizeSearchKey } from "@/lib/tyre";
import { costForProfit, recordPriceChanges } from "@/lib/services/prices";

/* ---------- DTOs (serialisable for client components) ---------- */

export type ProductDTO = {
  id: string;
  productNumber: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string;
  categoryName: string;
  description: string | null;
  /** Purchase price. Owner only, like the company prices below. */
  costPrice: string | null;
  sellingPrice: string | null;
  ndp: string | null;
  nlc: string | null;
  msrp: string | null;
  quantity: number;
  lowStockThreshold: number | null;
  effectiveThreshold: number;
  stockStatus: StockStatus;
  unit: Unit;
  location: string | null;
  notes: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
  /** Its category holds tyres, so it needs a tyre size. */
  categoryIsTyre: boolean;
  tyreSize: string | null;
  brand: string | null;
  pattern: string | null;
  rimInch: string | null;
  vehicleType: VehicleType | null;
  construction: TyreConstruction | null;
  tubeType: TubeType | null;
  fitment: Fitment | null;
  plyRating: number | null;
  nsdMm: string | null;
  materialCode: string | null;
};

export type MovementDTO = {
  id: string;
  productId: string;
  productName: string;
  productNumber: string;
  type: MovementType;
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  unitCost: string | null;
  note: string | null;
  performedById: string;
  performedByName: string;
  performedByRole: string;
  /** Set when the movement came from a bill; null for manual stock changes. */
  billId: string | null;
  /** Set when the movement booked in a product order delivery. */
  purchaseOrderId: string | null;
  orderNumber: string | null;
  createdAt: string;
};

export const productInclude = {
  category: { select: { name: true, isTyre: true } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function toProductDTO(p: ProductRow, globalThreshold: number): ProductDTO {
  const threshold = effectiveThreshold(p.lowStockThreshold, globalThreshold);
  return {
    id: p.id,
    productNumber: p.productNumber,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    description: p.description,
    costPrice: p.costPrice ? p.costPrice.toString() : null,
    sellingPrice: p.sellingPrice ? p.sellingPrice.toString() : null,
    ndp: p.ndp?.toString() ?? null,
    nlc: p.nlc?.toString() ?? null,
    msrp: p.msrp?.toString() ?? null,
    quantity: p.quantity,
    lowStockThreshold: p.lowStockThreshold,
    effectiveThreshold: threshold,
    stockStatus: getStockStatus(p.quantity, threshold),
    unit: p.unit,
    location: p.location,
    notes: p.notes,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    createdByName: p.createdBy?.name ?? null,
    updatedByName: p.updatedBy?.name ?? null,
    categoryIsTyre: p.category.isTyre,
    tyreSize: p.tyreSize,
    brand: p.brand,
    pattern: p.pattern,
    rimInch: p.rimInch ? p.rimInch.toString() : null,
    vehicleType: p.vehicleType,
    construction: p.construction,
    tubeType: p.tubeType,
    fitment: p.fitment,
    plyRating: p.plyRating,
    nsdMm: p.nsdMm ? p.nsdMm.toString() : null,
    materialCode: p.materialCode,
  };
}

export const movementInclude = {
  product: { select: { name: true, productNumber: true } },
  performedBy: { select: { name: true, role: true } },
  purchaseOrder: { select: { orderNumber: true } },
} satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

export function toMovementDTO(m: MovementRow): MovementDTO {
  return {
    id: m.id,
    productId: m.productId,
    productName: m.product.name,
    productNumber: m.product.productNumber,
    type: m.type,
    quantityChange: m.quantityChange,
    previousQuantity: m.previousQuantity,
    newQuantity: m.newQuantity,
    unitCost: m.unitCost ? m.unitCost.toString() : null,
    note: m.note,
    performedById: m.performedById,
    performedByName: m.performedBy.name,
    performedByRole: m.performedBy.role,
    billId: m.billId,
    purchaseOrderId: m.purchaseOrderId,
    orderNumber: m.purchaseOrder?.orderNumber ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

/* ---------- Viewer redaction ---------- */

/**
 * Cost information is owner-only. Every DTO that leaves the server for a page or
 * client component must pass through these so a manager's browser never receives it.
 */
export function productForViewer(dto: ProductDTO, role: Role): ProductDTO {
  return role === "OWNER" ? dto : { ...dto, costPrice: null, ndp: null, nlc: null, msrp: null };
}

export function productsForViewer(list: ProductDTO[], role: Role): ProductDTO[] {
  return role === "OWNER" ? list : list.map((p) => productForViewer(p, role));
}

export function movementForViewer(dto: MovementDTO, role: Role): MovementDTO {
  return role === "OWNER" ? dto : { ...dto, unitCost: null };
}

export function movementsForViewer(list: MovementDTO[], role: Role): MovementDTO[] {
  return role === "OWNER" ? list : list.map((m) => movementForViewer(m, role));
}

/* ---------- Helpers ---------- */

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function uniqueError(err: Prisma.PrismaClientKnownRequestError): AppError {
  // Depending on the driver adapter, the violated columns are in meta.target or the constraint name.
  const t = JSON.stringify(err.meta ?? {}) + (err.message ?? "");
  if (t.includes("barcode")) return new AppError("This barcode is already used by another product.", "CONFLICT");
  if (t.includes("sku")) return new AppError("This SKU is already used by another product.", "CONFLICT");
  if (t.includes("materialCode")) return new AppError("This material code is already used by another product.", "CONFLICT", "materialCode");
  return new AppError("A product with these details already exists.", "CONFLICT");
}

export async function nextProductNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('product_number_seq') AS n`;
  const n = Number(rows[0].n);
  return `PRD-${String(n).padStart(6, "0")}`;
}

/**
 * Active products that are LOW (1..threshold) or OUT (0), honouring per-product
 * overrides: the effective threshold is COALESCE("lowStockThreshold", global).
 */
function stockStatusWhere(status: StockStatus, globalThreshold: number): Prisma.ProductWhereInput {
  const own = prisma.product.fields.lowStockThreshold;
  if (status === "OUT_OF_STOCK") return { status: "ACTIVE", quantity: { lte: 0 } };
  if (status === "LOW_STOCK") {
    return {
      status: "ACTIVE",
      quantity: { gte: 1 },
      OR: [{ lowStockThreshold: null, quantity: { lte: globalThreshold } }, { quantity: { lte: own } }],
    };
  }
  return {
    status: "ACTIVE",
    OR: [{ lowStockThreshold: null, quantity: { gt: globalThreshold } }, { quantity: { gt: own } }],
  };
}

/* ---------- Queries ---------- */

export type ProductSort = "name" | "quantity" | "price" | "updated";

export type ListProductsParams = {
  search?: string;
  categoryId?: string;
  stockStatus?: StockStatus;
  sort?: ProductSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  vehicleType?: VehicleType;
  brand?: string;
  rimInch?: number;
  tubeType?: TubeType;
  fitment?: Fitment;
};

export async function listProducts(params: ListProductsParams = {}) {
  const settings = await getSettings();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const search = params.search?.trim() ?? "";
  // "185/65 r15", "1856515" and "185 65 15" all find the same tyres.
  const sizeKey = search ? sizeSearchKey(search) : null;
  // A size typed at the counter with no sort picked: show what can be sold first (see sizeOrder).
  const counterOrder = Boolean(sizeKey) && !params.sort;

  const where: Prisma.ProductWhereInput = {};
  if (params.archivedOnly) where.status = "ARCHIVED";
  else if (!params.includeArchived) where.status = "ACTIVE";
  if (params.categoryId) where.categoryId = params.categoryId;
  if (params.stockStatus) where.AND = [stockStatusWhere(params.stockStatus, settings.lowStockThreshold)];
  if (params.vehicleType) where.vehicleType = params.vehicleType;
  if (params.brand) where.brand = { equals: params.brand, mode: "insensitive" };
  if (params.rimInch != null) where.rimInch = params.rimInch;
  if (params.tubeType) where.tubeType = params.tubeType;
  if (params.fitment) where.fitment = params.fitment;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search } },
      { productNumber: { contains: search, mode: "insensitive" } },
      { materialCode: { contains: search, mode: "insensitive" } },
      ...(sizeKey ? [{ sizeKey: { startsWith: sizeKey } }] : []),
    ];
  }

  const dir = params.dir ?? (params.sort === "updated" ? "desc" : "asc");
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    params.sort === "quantity"
      ? [{ quantity: dir }, { name: "asc" }]
      : params.sort === "price"
        ? [{ sellingPrice: { sort: dir, nulls: "last" } }, { name: "asc" }]
        : params.sort === "updated"
          ? [{ updatedAt: dir }]
          : [{ name: dir }];

  let items: ProductDTO[];
  let total: number;
  if (counterOrder) {
    // A size matches a handful of tyres, so they are ordered here and then paged.
    const rows = await prisma.product.findMany({ where, orderBy: [{ name: "asc" }], include: productInclude, take: 1000 });
    const all = rows.map((p) => toProductDTO(p, settings.lowStockThreshold)).sort(sizeOrder(sizeKey!));
    total = all.length;
    items = all.slice((page - 1) * pageSize, page * pageSize);
  } else {
    const [rows, count] = await Promise.all([
      prisma.product.findMany({ where, orderBy, include: productInclude, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.product.count({ where }),
    ]);
    items = rows.map((p) => toProductDTO(p, settings.lowStockThreshold));
    total = count;
  }

  // Exact barcode / SKU match always floats to the top so scanner input lands on the right product.
  if (search) {
    const lower = search.toLowerCase();
    items = [...items].sort((a, b) => {
      const ea = a.barcode === search || a.sku?.toLowerCase() === lower ? 0 : 1;
      const eb = b.barcode === search || b.sku?.toLowerCase() === lower ? 0 : 1;
      return ea - eb;
    });
  }

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Order for a size search at the counter: the exact size first, the same sizes together,
 * then in stock before out of stock, then cheapest first. Products without a size go last.
 */
function sizeOrder(key: string) {
  const digits = (p: ProductDTO) => (p.tyreSize ? p.tyreSize.replace(/\D/g, "") : null);
  const price = (p: ProductDTO) => (p.sellingPrice == null ? Number.POSITIVE_INFINITY : Number(p.sellingPrice));
  return (a: ProductDTO, b: ProductDTO) => {
    const ka = digits(a);
    const kb = digits(b);
    return (
      Number(kb === key) - Number(ka === key) ||
      Number(kb !== null) - Number(ka !== null) ||
      (ka ?? "").localeCompare(kb ?? "") ||
      Number(b.quantity > 0) - Number(a.quantity > 0) ||
      price(a) - price(b) ||
      a.name.localeCompare(b.name)
    );
  };
}

/** Deduplicated per request (generateMetadata and the page both read it). */
export const getProduct = cache(async (id: string): Promise<ProductDTO | null> => {
  const [settings, row] = await Promise.all([
    getSettings(),
    prisma.product.findUnique({ where: { id }, include: productInclude }),
  ]);
  return row ? toProductDTO(row, settings.lowStockThreshold) : null;
});

/** Exact barcode lookup (used by scanner). Also accepts SKU or product number as a fallback. */
export async function findProductByCode(code: string): Promise<ProductDTO | null> {
  const value = code.trim();
  if (!value) return null;
  const settings = await getSettings();
  const row =
    (await prisma.product.findFirst({ where: { barcode: value }, include: productInclude })) ??
    (await prisma.product.findFirst({
      where: {
        OR: [
          { materialCode: { equals: value, mode: "insensitive" } },
          { sku: { equals: value, mode: "insensitive" } },
          { productNumber: { equals: value, mode: "insensitive" } },
        ],
      },
      include: productInclude,
    }));
  return row ? toProductDTO(row, settings.lowStockThreshold) : null;
}

export async function listCategories() {
  return prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isTyre: true } });
}

/** Brands in use, for the product filter. */
export async function listBrands(): Promise<string[]> {
  const rows = await prisma.product.findMany({ where: { status: "ACTIVE", brand: { not: null } }, distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } });
  return rows.map((r) => r.brand!).filter(Boolean);
}

/** Rim sizes in use, for the product filter. */
export async function listRimSizes(): Promise<number[]> {
  const rows = await prisma.product.findMany({ where: { status: "ACTIVE", rimInch: { not: null } }, distinct: ["rimInch"], select: { rimInch: true }, orderBy: { rimInch: "asc" } });
  return rows.map((r) => Number(r.rimInch));
}

/* ---------- Mutations ---------- */

type CreateInput = z.output<typeof productCreateSchema>;
type UpdateInput = z.output<typeof productUpdateSchema>;

/**
 * The tyre columns to save: the size is tidied and keyed for search, and rim size,
 * radial/bias and ply rating are read from it when they were not picked.
 * A tyre category needs a size; tubes, flaps and other items don't.
 */
function tyreData(input: Pick<CreateInput, "tyreSize" | "brand" | "pattern" | "vehicleType" | "construction" | "tubeType" | "fitment" | "plyRating" | "nsdMm" | "materialCode">, category: { isTyre: boolean }) {
  const parsed = parseTyreSize(input.tyreSize);
  if (category.isTyre && !parsed) throw new AppError("Enter the tyre size, e.g. 185/65 R15.", "VALIDATION", "tyreSize");
  return {
    tyreSize: parsed?.size ?? null,
    sizeKey: parsed?.key || null,
    rimInch: parsed?.rimInch ?? null,
    construction: input.construction ?? parsed?.construction ?? null,
    plyRating: input.plyRating ?? parsed?.plyRating ?? null,
    brand: input.brand,
    pattern: input.pattern,
    vehicleType: input.vehicleType,
    tubeType: input.tubeType,
    fitment: input.fitment,
    nsdMm: input.nsdMm,
    materialCode: input.materialCode,
  };
}

export async function createProduct(input: CreateInput, actor: SessionUser): Promise<ProductDTO> {
  const settings = await getSettings();
  // Prices are owner-only: a manager's product is created without them.
  if (actor.role !== "OWNER") input = { ...input, costPrice: null, sellingPrice: null };
  try {
    const created = await prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new AppError("Selected category does not exist.");
      const tyre = tyreData(input, category);
      const productNumber = await nextProductNumber(tx);
      const product = await tx.product.create({
        data: {
          productNumber,
          name: input.name,
          categoryId: input.categoryId,
          sku: input.sku,
          barcode: input.barcode,
          description: input.description,
          costPrice: input.costPrice,
          sellingPrice: input.sellingPrice,
          quantity: input.startingQuantity,
          lowStockThreshold: input.lowStockThreshold,
          unit: input.unit,
          location: input.location,
          notes: input.notes,
          ...tyre,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: productInclude,
      });
      await recordPriceChanges(tx, {
        productId: product.id,
        before: {},
        after: { costPrice: input.costPrice, sellingPrice: input.sellingPrice },
        source: "MANUAL",
        actorId: actor.id,
      });
      if (input.startingQuantity > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "INITIAL_STOCK",
            quantityChange: input.startingQuantity,
            previousQuantity: 0,
            newQuantity: input.startingQuantity,
            unitCost: input.costPrice,
            note: "Starting quantity",
            performedById: actor.id,
          },
        });
      }
      await recordAudit(tx, {
        action: "PRODUCT_CREATED",
        entityType: "Product",
        entityId: product.id,
        summary: `Created product ${product.productNumber} "${product.name}" with starting quantity ${input.startingQuantity}`,
        actorId: actor.id,
      });
      return product;
    });
    return toProductDTO(created, settings.lowStockThreshold);
  } catch (err) {
    if (isUniqueViolation(err)) throw uniqueError(err);
    throw err;
  }
}

export async function updateProduct(id: string, input: UpdateInput, actor: SessionUser): Promise<ProductDTO> {
  const settings = await getSettings();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
      if (existing.status === "ARCHIVED" && actor.role !== "OWNER") {
        throw new AppError("Archived products can only be edited by the owner.", "FORBIDDEN");
      }
      const category = await tx.category.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new AppError("Selected category does not exist.");
      const tyre = tyreData(input, category);

      const data: Prisma.ProductUncheckedUpdateInput = {
        name: input.name,
        categoryId: input.categoryId,
        sku: input.sku,
        barcode: input.barcode,
        description: input.description,
        costPrice: input.costPrice,
        sellingPrice: input.sellingPrice,
        unit: input.unit,
        location: input.location,
        notes: input.notes,
        lowStockThreshold: input.lowStockThreshold,
        ...tyre,
        updatedById: actor.id,
      };

      // Managers may only edit basic product information.
      if (actor.role !== "OWNER") {
        for (const key of Object.keys(data)) {
          if (key !== "updatedById" && !MANAGER_EDITABLE_PRODUCT_FIELDS.has(key)) {
            delete (data as Record<string, unknown>)[key];
          }
        }
      }

      const changed: string[] = [];
      for (const [key, value] of Object.entries(data)) {
        if (key === "updatedById") continue;
        const before = existing[key as keyof typeof existing];
        const beforeStr = before instanceof Prisma.Decimal ? before.toString() : (before ?? null);
        const afterStr = value ?? null;
        if (String(beforeStr ?? "") !== String(afterStr ?? "")) changed.push(key);
      }

      const product = await tx.product.update({ where: { id }, data, include: productInclude });
      if (actor.role === "OWNER") {
        await recordPriceChanges(tx, {
          productId: id,
          before: existing,
          after: { costPrice: input.costPrice, sellingPrice: input.sellingPrice },
          source: "MANUAL",
          actorId: actor.id,
        });
      }
      await recordAudit(tx, {
        action: "PRODUCT_UPDATED",
        entityType: "Product",
        entityId: id,
        summary: `Edited product ${product.productNumber} "${product.name}"${changed.length ? ` (${changed.join(", ")})` : ""}`,
        metadata: { changedFields: changed },
        actorId: actor.id,
      });
      return product;
    });
    return toProductDTO(updated, settings.lowStockThreshold);
  } catch (err) {
    if (isUniqueViolation(err)) throw uniqueError(err);
    throw err;
  }
}

type PricesInput = z.output<typeof productPricesSchema>;

/** Owner only: change cost / selling price from the Prices & Margins page. */
export async function updateProductPrices(id: string, input: PricesInput, actor: SessionUser): Promise<ProductDTO> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can change prices.", "FORBIDDEN");
  const settings = await getSettings();
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
    const prices = { costPrice: input.costPrice, sellingPrice: input.sellingPrice, ndp: input.ndp, nlc: input.nlc, msrp: input.msrp };
    const product = await tx.product.update({
      where: { id },
      data: { ...prices, updatedById: actor.id },
      include: productInclude,
    });
    const changed = await recordPriceChanges(tx, { productId: id, before: existing, after: prices, source: "MANUAL", actorId: actor.id });
    if (changed) {
      await recordAudit(tx, {
        action: "PRODUCT_UPDATED",
        entityType: "Product",
        entityId: id,
        summary: `Changed prices of ${product.productNumber} "${product.name}"`,
        metadata: prices,
        actorId: actor.id,
      });
    }
    return product;
  });
  return toProductDTO(updated, settings.lowStockThreshold);
}

export type PricingSummary = {
  products: number;
  missingCost: number;
  missingSelling: number;
  belowCost: number;
  stockAtCost: string;
  stockAtSelling: string;
  potentialProfit: string;
};

/** Owner only: totals for the Prices & Margins page (active products). */
export async function getPricingSummary(): Promise<PricingSummary> {
  const rows = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    select: { quantity: true, costPrice: true, nlc: true, sellingPrice: true },
  });
  let missingCost = 0;
  let missingSelling = 0;
  let belowCost = 0;
  let atCost = 0;
  let atSelling = 0;
  for (const r of rows) {
    const c = costForProfit(r);
    const cost = c === null ? null : toPaise(c);
    const selling = r.sellingPrice ? toPaise(r.sellingPrice.toString()) : null;
    if (cost === null) missingCost++;
    if (selling === null) missingSelling++;
    if (cost !== null && selling !== null && selling < cost) belowCost++;
    const qty = Math.max(0, r.quantity);
    if (cost !== null) atCost += cost * qty;
    if (selling !== null) atSelling += selling * qty;
  }
  return {
    products: rows.length,
    missingCost,
    missingSelling,
    belowCost,
    stockAtCost: fromPaise(atCost),
    stockAtSelling: fromPaise(atSelling),
    potentialProfit: fromPaise(atSelling - atCost),
  };
}

export async function setProductStatus(id: string, status: ProductStatus, actor: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
    const product = await tx.product.update({ where: { id }, data: { status, updatedById: actor.id } });
    await recordAudit(tx, {
      action: status === "ARCHIVED" ? "PRODUCT_ARCHIVED" : "PRODUCT_RESTORED",
      entityType: "Product",
      entityId: id,
      summary: `${status === "ARCHIVED" ? "Archived" : "Restored"} product ${product.productNumber} "${product.name}"`,
      actorId: actor.id,
    });
    return product;
  });
}

/**
 * Permanently deletes a product and its stock movements (owner only).
 * The audit log keeps a record of the deletion, including a snapshot of the product.
 */
export async function deleteProduct(id: string, actor: SessionUser) {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can delete products.", "FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id }, include: { category: true } });
    if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
    const movementCount = await tx.stockMovement.count({ where: { productId: id } });
    await tx.stockMovement.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });
    await recordAudit(tx, {
      action: "PRODUCT_DELETED",
      entityType: "Product",
      entityId: id,
      summary: `Deleted product ${existing.productNumber} "${existing.name}" (quantity ${existing.quantity}, ${movementCount} stock movements removed)`,
      actorId: actor.id,
      metadata: {
        productNumber: existing.productNumber,
        name: existing.name,
        sku: existing.sku,
        barcode: existing.barcode,
        category: existing.category.name,
        quantity: existing.quantity,
        status: existing.status,
        movementCount,
      },
    });
    return { productNumber: existing.productNumber, name: existing.name };
  });
}

export async function createCategory(name: string, actor: SessionUser, isTyre = true) {
  const existing = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) throw new AppError("A category with this name already exists.", "CONFLICT");
  const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.category.create({ data: { name, isTyre, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await recordAudit(prisma, {
    action: "CATEGORY_CREATED",
    entityType: "Category",
    entityId: category.id,
    summary: `Created ${isTyre ? "tyre " : ""}category "${category.name}"`,
    actorId: actor.id,
  });
  return category;
}

/** Tyre categories need a tyre size on new and edited products; existing products are left as they are. */
export async function setCategoryIsTyre(id: string, isTyre: boolean, actor: SessionUser) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new AppError("Category not found.", "NOT_FOUND");
  const category = await prisma.category.update({ where: { id }, data: { isTyre } });
  await recordAudit(prisma, {
    action: "CATEGORY_UPDATED",
    entityType: "Category",
    entityId: id,
    summary: `"${category.name}" is ${isTyre ? "now a tyre category" : "no longer a tyre category"}`,
    actorId: actor.id,
  });
  return category;
}
