/*
  Warnings:

  - You are about to drop the column `needsService` on the `Category` table. All the data in the column will be lost.
  - You are about to drop the column `cycleStart` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `kind` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `sourceBillId` on the `Enquiry` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Enquiry" DROP CONSTRAINT "Enquiry_sourceBillId_fkey";

-- DropIndex
DROP INDEX "Enquiry_kind_phoneKey_status_idx";

-- DropIndex
DROP INDEX "Enquiry_sourceBillId_idx";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "needsService";

-- AlterTable
ALTER TABLE "Enquiry" DROP COLUMN "cycleStart",
DROP COLUMN "kind",
DROP COLUMN "sourceBillId";

-- DropEnum
DROP TYPE "EnquiryKind";

-- CreateIndex
CREATE INDEX "Enquiry_phoneKey_status_idx" ON "Enquiry"("phoneKey", "status");
