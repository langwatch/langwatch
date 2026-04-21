-- AlterTable: Remove legacy evaluationsCredit column (never enforced at API level)
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "evaluationsCredit";
