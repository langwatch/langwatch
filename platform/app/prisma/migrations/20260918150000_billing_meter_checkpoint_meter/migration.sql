-- IRREVERSIBLE: Prisma migrations are forward-only, and this one cannot be
-- undone without losing data. Reverting by hand means dropping the three-column
-- unique index, deleting every row whose "meter" is not
-- 'langwatch_billable_events', recreating
-- "BillingMeterCheckpoint_organizationId_billingMonth_key", then dropping the
-- "meter" column. That delete throws away the Instant Evals meter's running
-- totals, which is what decides where the next Stripe report starts, so it is
-- not scripted here.

-- A second Stripe meter (Instant Evals, in ten-thousandths of a dollar) needs
-- its own running total per organization and month, so the checkpoint is
-- keyed by the meter it tracks. Existing rows are the billable events meter's.
ALTER TABLE "BillingMeterCheckpoint"
  ADD COLUMN "meter" TEXT NOT NULL DEFAULT 'langwatch_billable_events';

DROP INDEX IF EXISTS "BillingMeterCheckpoint_organizationId_billingMonth_key";

CREATE UNIQUE INDEX "BillingMeterCheckpoint_organizationId_billingMonth_meter_key"
  ON "BillingMeterCheckpoint"("organizationId", "billingMonth", "meter");
