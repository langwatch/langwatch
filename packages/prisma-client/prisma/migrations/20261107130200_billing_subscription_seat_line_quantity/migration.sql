-- IRREVERSIBLE: adds columns to "Subscription", nullable or with a constant default.
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- The seat quantity the last finished seat change set, and the Stripe seat line write recorded
-- ahead of each send for the seat line repair (specs/licensing/seat-rotation.feature).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "seatLineQuantity" INTEGER, ADD COLUMN IF NOT EXISTS "seatLineQuantityAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatLineWriteQuantities" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[], ADD COLUMN IF NOT EXISTS "seatLineWriteSince" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatLineWriteAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatLineWriteAttempts" INTEGER, ADD COLUMN IF NOT EXISTS "seatLineWriteFlaggedAt" TIMESTAMP(3);
