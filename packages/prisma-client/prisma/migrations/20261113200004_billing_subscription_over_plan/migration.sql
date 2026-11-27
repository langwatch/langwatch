-- IRREVERSIBLE: adds nullable columns to "Subscription".
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- The over-plan mark (specs/billing/over-plan-trace-withholding.feature): set when an organization
-- falls to Free holding more members than Free allows, ended when that no longer holds.
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "overPlanSince" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "overPlanEndedAt" TIMESTAMP(3);
