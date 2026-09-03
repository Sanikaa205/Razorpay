-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "buyerSessionId" TEXT,
ADD COLUMN     "buyerType" TEXT NOT NULL DEFAULT 'ai_agent';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stockDeducted" BOOLEAN NOT NULL DEFAULT false;
