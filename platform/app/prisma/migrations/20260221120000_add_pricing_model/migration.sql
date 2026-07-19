-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "PricingModel" AS ENUM ('TIERED', 'SEAT_EVENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "pricingModel" "PricingModel" NOT NULL DEFAULT 'TIERED';
