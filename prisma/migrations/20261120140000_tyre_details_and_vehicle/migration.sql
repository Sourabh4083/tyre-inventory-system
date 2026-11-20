-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR_JEEP', 'TWO_WHEELER', 'THREE_WHEELER', 'LCV_SCV', 'TRUCK_BUS', 'TRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "TyreConstruction" AS ENUM ('RADIAL', 'BIAS');

-- CreateEnum
CREATE TYPE "TubeType" AS ENUM ('TL', 'TT', 'TTF');

-- CreateEnum
CREATE TYPE "Fitment" AS ENUM ('FRONT', 'REAR', 'ALL');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "vehicleKey" TEXT,
ADD COLUMN     "vehicleNumber" TEXT;

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "defaultTyreBrand" TEXT NOT NULL DEFAULT 'JK Tyre';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isTyre" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "OpenBill" ADD COLUMN     "vehicleNumber" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "construction" "TyreConstruction",
ADD COLUMN     "fitment" "Fitment",
ADD COLUMN     "materialCode" TEXT,
ADD COLUMN     "nsdMm" DECIMAL(4,1),
ADD COLUMN     "pattern" TEXT,
ADD COLUMN     "plyRating" INTEGER,
ADD COLUMN     "rimInch" DECIMAL(4,1),
ADD COLUMN     "sizeKey" TEXT,
ADD COLUMN     "tubeType" "TubeType",
ADD COLUMN     "tyreSize" TEXT,
ADD COLUMN     "vehicleType" "VehicleType";

-- CreateIndex
CREATE INDEX "Bill_vehicleKey_idx" ON "Bill"("vehicleKey");

-- CreateIndex
CREATE UNIQUE INDEX "Product_materialCode_key" ON "Product"("materialCode");

-- CreateIndex
CREATE INDEX "Product_sizeKey_idx" ON "Product"("sizeKey");

-- CreateIndex
CREATE INDEX "Product_brand_idx" ON "Product"("brand");

-- CreateIndex
CREATE INDEX "Product_vehicleType_rimInch_idx" ON "Product"("vehicleType", "rimInch");

-- Tubes, flaps and other items have no tyre size.
UPDATE "Category" SET "isTyre" = false WHERE "name" IN ('Tubes & Flaps', 'Other');
