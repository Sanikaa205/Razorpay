-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_merchantId_fkey";

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "merchantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
