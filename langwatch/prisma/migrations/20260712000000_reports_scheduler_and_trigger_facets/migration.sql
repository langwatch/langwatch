-- Reports scheduler + trigger facets. Consolidates the five migrations that
-- landed the schedule-triggered REPORT automation kind and the ADR-043 facet
-- columns on Trigger/TriggerSent. None of these shipped to production, so they
-- are squashed into one ordered migration. Sections:
--   1. ScheduledJob         — the generic calendar-scheduling primitive (ADR-044)
--   2. TriggerKind          — the three automation kinds by trigger (ADR-044)
--   3. Trigger.filterQuery  — the ADR-043 Subject facet
--   4. TriggerSent.openIncidentKey — atomic open-incident claim for graph alerts

-- 1. ScheduledJob: the generic calendar-scheduling primitive (ADR-044 Phase 1).
--
-- See dev/docs/adr/044-scheduled-reports-automation-kind.md section 4. One
-- durable Postgres row per scheduled thing is the SOURCE OF TRUTH AND the only
-- coordination layer -- NO Redis. An in-process, worker-only SchedulerService
-- loop (src/server/app-layer/scheduler/) reads MIN(nextRunAt) to sleep until
-- the soonest due job, scans `active AND nextRunAt <= now`, and atomically
-- CLAIMS each due row via a conditional
-- `UPDATE ... WHERE id = ? AND nextRunAt = ?` before firing its registered
-- handler. That conditional claim is the SOLE exactly-once mechanism: exactly
-- one of N racing workers wins each slot, so every worker can run the loop and
-- share firing load (no leader-lock needed). `targetType`/`targetId` keep the
-- table consumer-agnostic -- a scheduled report writes
-- ("reportTrigger", trigger.id); a future weekly rollup writes its own type.
--
-- `attempts`/`lastError` are retry bookkeeping: a handler failure used to lose
-- the slot because the claim advanced `nextRunAt` before the handler ran.
-- `attempts` bounds the retries and `lastError` keeps the failure observable.
-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastSlot" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- The due-scan: `WHERE active AND nextRunAt <= now` plus the MIN(nextRunAt)
-- the loop reads to pick its sleep target.
-- CreateIndex
CREATE INDEX "ScheduledJob_active_nextRunAt_idx" ON "ScheduledJob"("active", "nextRunAt");

-- Per-project lookup.
-- CreateIndex
CREATE INDEX "ScheduledJob_projectId_idx" ON "ScheduledJob"("projectId");

-- One schedule per target — makes upsertForTarget / the conditional claim a
-- clean update keyed on the target identity.
-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_targetType_targetId_key" ON "ScheduledJob"("targetType", "targetId");

-- 2. TriggerKind: the three automation kinds by trigger (ADR-044).
-- AUTOMATION = event-triggered, ALERT = condition/threshold-triggered,
-- REPORT = schedule-triggered. Existing rows are backfilled from the legacy
-- `customGraphId != null` heuristic (a custom-graph trigger is an alert).
-- CreateEnum
CREATE TYPE "TriggerKind" AS ENUM ('AUTOMATION', 'ALERT', 'REPORT');

-- AlterTable: add the column with a safe default so existing rows are valid.
ALTER TABLE "Trigger" ADD COLUMN "triggerKind" "TriggerKind" NOT NULL DEFAULT 'AUTOMATION';

-- Backfill: custom-graph triggers are alerts.
UPDATE "Trigger" SET "triggerKind" = 'ALERT' WHERE "customGraphId" IS NOT NULL;

-- 3. Trigger.filterQuery — ADR-043 Subject facet: the Traces-V2 liqe query
-- string a trace-subject automation is about. NULL = legacy `filters`-driven
-- trigger (unchanged). Nullable with no default, so existing rows stay legacy
-- and no backfill runs.
-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "filterQuery" TEXT;

-- 4. TriggerSent.openIncidentKey — atomic open-incident claim for graph alerts.
-- Holds the identity of the incident this row represents while it is firing,
-- and is cleared (NULL) on resolve. The single-column unique means at most one
-- OPEN incident can exist per identity — Postgres treats NULLs as distinct, so
-- any number of resolved rows coexist. `@@unique([triggerId, traceId])` cannot
-- guard graph alerts because their `traceId` is NULL.
-- AlterTable
ALTER TABLE "TriggerSent" ADD COLUMN "openIncidentKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TriggerSent_openIncidentKey_key" ON "TriggerSent"("openIncidentKey");

-- To roll back, uncomment and run manually:
-- DROP INDEX "TriggerSent_openIncidentKey_key";
-- ALTER TABLE "TriggerSent" DROP COLUMN "openIncidentKey";
-- ALTER TABLE "Trigger" DROP COLUMN "filterQuery";
-- ALTER TABLE "Trigger" DROP COLUMN "triggerKind";
-- DROP TYPE "TriggerKind";
-- DROP TABLE "ScheduledJob";
