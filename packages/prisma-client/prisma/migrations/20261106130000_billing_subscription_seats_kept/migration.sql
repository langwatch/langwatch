-- Seats a lowered Growth subscription keeps until its billing period ends, and the seat line
-- quantity owed to Stripe after a refused rollback (specs/licensing/seat-rotation.feature).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "seatsKept" INTEGER, ADD COLUMN IF NOT EXISTS "seatsKeptUntil" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatRepairQuantity" INTEGER, ADD COLUMN IF NOT EXISTS "seatRepairSince" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "seatRepairAttempts" INTEGER, ADD COLUMN IF NOT EXISTS "seatRepairFlaggedAt" TIMESTAMP(3);
