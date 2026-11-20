-- Categories become product types (Tyres, Tubes, Flaps, ...); the vehicle a tyre fits is its own
-- "vehicleType" column. Folds the earlier vehicle-named tyre categories into one "Tyres" category.
-- Does nothing on a database that never had those names.

-- 0. A tyre with no vehicle keeps what its old category said before it moves.
UPDATE "Product" p SET "vehicleType" = CASE c."name"
    WHEN 'Car & Jeep Tyres' THEN 'CAR_JEEP'::"VehicleType"
    WHEN 'Two-Wheeler Tyres' THEN 'TWO_WHEELER'::"VehicleType"
    WHEN 'Three-Wheeler Tyres' THEN 'THREE_WHEELER'::"VehicleType"
    WHEN 'LCV / SCV Tyres' THEN 'LCV_SCV'::"VehicleType"
    WHEN 'Truck & Bus Tyres' THEN 'TRUCK_BUS'::"VehicleType"
    WHEN 'Tractor Tyres' THEN 'TRACTOR'::"VehicleType"
  END
FROM "Category" c
WHERE c."id" = p."categoryId" AND p."vehicleType" IS NULL
  AND c."name" IN ('Car & Jeep Tyres', 'Two-Wheeler Tyres', 'Three-Wheeler Tyres', 'LCV / SCV Tyres', 'Truck & Bus Tyres', 'Tractor Tyres');

-- 1. "Car & Jeep Tyres" becomes "Tyres" (unless a "Tyres" category already exists).
UPDATE "Category" SET "name" = 'Tyres', "isTyre" = true, "sortOrder" = 0
WHERE "name" = 'Car & Jeep Tyres'
  AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "name" = 'Tyres');

-- 2. Products in the other vehicle-named tyre categories move into "Tyres".
UPDATE "Product" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "name" = 'Tyres')
WHERE EXISTS (SELECT 1 FROM "Category" WHERE "name" = 'Tyres')
  AND "categoryId" IN (
    SELECT "id" FROM "Category"
    WHERE "name" IN ('Car & Jeep Tyres', 'Two-Wheeler Tyres', 'Three-Wheeler Tyres', 'LCV / SCV Tyres', 'Truck & Bus Tyres', 'Tractor Tyres')
  );

-- 3. The emptied vehicle-named categories go (only when nothing is left in them).
DELETE FROM "Category" c
WHERE c."name" IN ('Car & Jeep Tyres', 'Two-Wheeler Tyres', 'Three-Wheeler Tyres', 'LCV / SCV Tyres', 'Truck & Bus Tyres', 'Tractor Tyres')
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."categoryId" = c."id");

-- 4. "Tubes & Flaps" becomes "Tubes" ("Flaps" gets its own category from the seed or Settings).
UPDATE "Category" SET "name" = 'Tubes', "isTyre" = false
WHERE "name" = 'Tubes & Flaps'
  AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "name" = 'Tubes');
