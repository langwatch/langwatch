-- IRREVERSIBLE: adds nullable columns to "Subscription".
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- Seats a lowered Growth subscription keeps until its billing period ends, and the seat line
-- quantity owed to Stripe if a seat change stops after lifting the line (specs/licensing/seat-rotation.feature).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "seatsKept" INTEGER, ADD COLUMN IF NOT EXISTS "seatsKeptUntil" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatRepairQuantity" INTEGER, ADD COLUMN IF NOT EXISTS "seatRepairLiftedQuantity" INTEGER, ADD COLUMN IF NOT EXISTS "seatRepairSince" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatRepairAttempts" INTEGER, ADD COLUMN IF NOT EXISTS "seatRepairFlaggedAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatLineLeaseToken" TEXT, ADD COLUMN IF NOT EXISTS "seatLineLeaseUntil" TIMESTAMP(3);
