-- A second Stripe meter (Instant Evals, in ten-thousandths of a dollar) needs
-- its own running total per organization and month, so the checkpoint is
-- keyed by the meter it tracks. Existing rows are the billable events meter's.
ALTER TABLE "BillingMeterCheckpoint"
  ADD COLUMN "meter" TEXT NOT NULL DEFAULT 'langwatch_billable_events';

DROP INDEX IF EXISTS "BillingMeterCheckpoint_organizationId_billingMonth_key";

CREATE UNIQUE INDEX "BillingMeterCheckpoint_organizationId_billingMonth_meter_key"
  ON "BillingMeterCheckpoint"("organizationId", "billingMonth", "meter");
