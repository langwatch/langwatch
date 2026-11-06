-- Seats a lowered Growth subscription keeps until its billing period ends (specs/licensing/seat-rotation.feature).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "seatsKept" INTEGER, ADD COLUMN IF NOT EXISTS "seatsKeptUntil" TIMESTAMP(3);
