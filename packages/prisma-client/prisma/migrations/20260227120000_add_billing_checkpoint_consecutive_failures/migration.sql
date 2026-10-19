-- AlterTable
ALTER TABLE "BillingMeterCheckpoint" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
