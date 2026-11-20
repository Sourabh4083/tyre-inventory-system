-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "onlineShopUrl" TEXT,
ADD COLUMN     "shopAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shopPhone" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "businessName" SET DEFAULT 'Tyre Shop';
