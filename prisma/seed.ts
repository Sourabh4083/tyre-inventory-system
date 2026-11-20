/**
 * Seeds demo accounts, business settings, tyre categories, the usual tyre-shop services and a
 * few sample tyres so a new install has something to bill. A real shop's stock is added from the
 * app (or, later, imported from the company price list).
 *
 * Sample prices come from the JK Tyre dealer price list (Oct 2026): cost = invoice value per tyre,
 * selling price = MSRP / MOP per tyre where the list gives one.
 *
 * Safe to re-run: categories, services and products are matched by name and never duplicated.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "Owner@Tyre2026!";
const MANAGER_PASSWORD = process.env.SEED_MANAGER_PASSWORD ?? "Manager@Tyre2026!";

const CATEGORIES = [
  "Car & Jeep Tyres",
  "Two-Wheeler Tyres",
  "Three-Wheeler Tyres",
  "LCV / SCV Tyres",
  "Truck & Bus Tyres",
  "Tractor Tyres",
  "Tubes & Flaps",
  "Other",
];

const SERVICES: { name: string; price: number }[] = [
  { name: "Tyre fitting (per tyre)", price: 100 },
  { name: "Wheel alignment", price: 500 },
  { name: "Wheel balancing (per wheel)", price: 100 },
  { name: "Puncture repair (tubeless)", price: 150 },
  { name: "Nitrogen filling (per tyre)", price: 50 },
  { name: "Tube change", price: 100 },
];

type SeedProduct = { name: string; category: string; cost: number; price: number | null; quantity: number };

const PRODUCTS: SeedProduct[] = [
  { name: "145/70 R12 Ultima Hi-Life TL", category: "Car & Jeep Tyres", cost: 2571, price: 2950, quantity: 4 },
  { name: "145/80 R12 Taximax TL", category: "Car & Jeep Tyres", cost: 2794, price: 3200, quantity: 6 },
  { name: "155/65 R12 Ultima LXT TL", category: "Car & Jeep Tyres", cost: 3363, price: 3850, quantity: 2 },
  { name: "165/80 R14 UX Royale Puncture Guard", category: "Car & Jeep Tyres", cost: 4485, price: 5150, quantity: 3 },
  { name: "185/65 R15 UX Royale TL", category: "Car & Jeep Tyres", cost: 5194, price: 5950, quantity: 8 },
  { name: "185/65 R15 Taximax TL", category: "Car & Jeep Tyres", cost: 5197, price: 6000, quantity: 0 },
  { name: "225/60 R17 UX Royale TL", category: "Car & Jeep Tyres", cost: 9407, price: 10800, quantity: 2 },
  { name: "265/65 R17 Ranger H/T TL", category: "Car & Jeep Tyres", cost: 11657, price: 13400, quantity: 1 },
  { name: "100/90-17 Blaze BR31 Rear TL", category: "Two-Wheeler Tyres", cost: 1882, price: null, quantity: 5 },
  { name: "90/100-10 Blaze BA21 Scooter TL", category: "Two-Wheeler Tyres", cost: 1010, price: null, quantity: 6 },
  { name: "4.00-8 Jumbo XR E-Rickshaw TL", category: "Three-Wheeler Tyres", cost: 1286, price: null, quantity: 4 },
  { name: "7.00R15 Steel King 12PR", category: "LCV / SCV Tyres", cost: 8951, price: 9225, quantity: 2 },
  { name: "10.00R20 16PR JUH5", category: "Truck & Bus Tyres", cost: 25108, price: 26000, quantity: 2 },
  { name: "12.4-28 12PR Shresth Plus", category: "Tractor Tyres", cost: 17127, price: 18155, quantity: 1 },
];

async function main() {
  console.log("Seeding...");

  await prisma.businessSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", businessName: "Tyre Shop", currencyCode: "INR", currencySymbol: "₹", lowStockThreshold: 4 },
  });

  for (const [i, name] of CATEGORIES.entries()) {
    await prisma.category.upsert({ where: { name }, update: { sortOrder: i }, create: { name, sortOrder: i } });
  }
  const categories = await prisma.category.findMany();
  const categoryId = (name: string) => categories.find((c) => c.name === name)?.id ?? categories.find((c) => c.name === "Other")!.id;

  for (const [i, s] of SERVICES.entries()) {
    await prisma.service.upsert({ where: { name: s.name }, update: {}, create: { name: s.name, price: s.price.toFixed(2), sortOrder: i } });
  }

  const owner = await prisma.user.upsert({
    where: { email: "owner@tyreshop.local" },
    update: {},
    create: { name: "Owner", email: "owner@tyreshop.local", passwordHash: await hashPassword(OWNER_PASSWORD), role: "OWNER" },
  });
  const manager = await prisma.user.upsert({
    where: { email: "manager@tyreshop.local" },
    update: {},
    create: { name: "Manager", email: "manager@tyreshop.local", passwordHash: await hashPassword(MANAGER_PASSWORD), role: "MANAGER" },
  });
  console.log(`Users ready: ${owner.email} (OWNER), ${manager.email} (MANAGER)`);

  let created = 0;
  for (const p of PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { name: { equals: p.name, mode: "insensitive" } } });
    if (existing) continue;
    await prisma.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('product_number_seq') AS n`;
      const product = await tx.product.create({
        data: {
          productNumber: `PRD-${String(Number(n)).padStart(6, "0")}`,
          name: p.name,
          categoryId: categoryId(p.category),
          costPrice: p.cost.toFixed(2),
          sellingPrice: p.price === null ? null : p.price.toFixed(2),
          quantity: p.quantity,
          unit: "PIECE",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      if (p.quantity > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "INITIAL_STOCK",
            quantityChange: p.quantity,
            previousQuantity: 0,
            newQuantity: p.quantity,
            note: "Opening stock",
            performedById: owner.id,
          },
        });
      }
    });
    created++;
  }
  console.log(`Products: ${created} created, ${PRODUCTS.length - created} already existed`);

  console.log(`Done. ${await prisma.product.count()} products, ${await prisma.service.count()} services in database.`);
  console.log("\nDemo credentials:");
  console.log(`  Owner:   owner@tyreshop.local / ${OWNER_PASSWORD}`);
  console.log(`  Manager: manager@tyreshop.local / ${MANAGER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
