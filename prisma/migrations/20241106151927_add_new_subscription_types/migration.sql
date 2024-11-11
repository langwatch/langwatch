-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanTypes" ADD VALUE 'LAUNCH';
ALTER TYPE "PlanTypes" ADD VALUE 'ACCELERATE';
ALTER TYPE "PlanTypes" ADD VALUE 'LAUNCH_ANNUAL';
ALTER TYPE "PlanTypes" ADD VALUE 'ACCELERATE_ANNUAL';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "maxRetentionDays" INTEGER,
ADD COLUMN     "maxWorkflows" INTEGER;
