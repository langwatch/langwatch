-- The seat quantity the last finished seat change set the seat line to; the seat line repair
-- reconciles a late Stripe write to it (specs/licensing/seat-rotation.feature).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "seatLineQuantity" INTEGER;
