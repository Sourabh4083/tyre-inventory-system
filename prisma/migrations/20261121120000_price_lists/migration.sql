-- CreateEnum
CREATE TYPE "PriceField" AS ENUM ('NDP', 'PURCHASE', 'NLC', 'MSRP', 'SELLING');

-- CreateEnum
CREATE TYPE "PriceChangeSource" AS ENUM ('MANUAL', 'PRICE_LIST', 'ORDER');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "msrp" DECIMAL(12,2),
ADD COLUMN     "ndp" DECIMAL(12,2),
ADD COLUMN     "nlc" DECIMAL(12,2),
ADD COLUMN     "priceListKey" TEXT;

-- CreateTable
CREATE TABLE "ProductPriceChange" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" "PriceField" NOT NULL,
    "oldValue" DECIMAL(12,2),
    "newValue" DECIMAL(12,2),
    "source" "PriceChangeSource" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPriceChange_productId_createdAt_idx" ON "ProductPriceChange"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_priceListKey_key" ON "Product"("priceListKey");

-- AddForeignKey
ALTER TABLE "ProductPriceChange" ADD CONSTRAINT "ProductPriceChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceChange" ADD CONSTRAINT "ProductPriceChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

