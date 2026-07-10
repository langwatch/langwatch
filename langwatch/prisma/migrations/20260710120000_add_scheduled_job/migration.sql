-- ScheduledJob: the generic calendar-scheduling primitive (ADR-042 Phase 1).
--
-- See dev/docs/adr/042-scheduled-reports-automation-kind.md section 4. One
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

-- To roll back, uncomment and run manually:
-- DROP TABLE "ScheduledJob";
