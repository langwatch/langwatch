-- TriggerKind: the three automation kinds by trigger (ADR-042).
-- AUTOMATION = event-triggered, ALERT = condition/threshold-triggered,
-- REPORT = schedule-triggered. Existing rows are backfilled from the legacy
-- `customGraphId != null` heuristic (a custom-graph trigger is an alert).

-- CreateEnum
CREATE TYPE "TriggerKind" AS ENUM ('AUTOMATION', 'ALERT', 'REPORT');

-- AlterTable: add the column with a safe default so existing rows are valid.
ALTER TABLE "Trigger" ADD COLUMN "triggerKind" "TriggerKind" NOT NULL DEFAULT 'AUTOMATION';

-- Backfill: custom-graph triggers are alerts.
UPDATE "Trigger" SET "triggerKind" = 'ALERT' WHERE "customGraphId" IS NOT NULL;

-- To roll back, uncomment and run manually:
-- ALTER TABLE "Trigger" DROP COLUMN "triggerKind";
-- DROP TYPE "TriggerKind";
