-- AlterEnum
ALTER TYPE "PlanTypes" ADD VALUE 'GROWTH_SEAT_EVENT';

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('TIERED', 'SEAT_EVENT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "pricingModel" "PricingModel" NOT NULL DEFAULT 'TIERED';
