-- Nurturing's own trace counts as peer folds (ARCHITECTURE §9), owned by nurturing: one row per
-- project, UTC day of append time and source. `spans` rows are folded from trace's span_received (a
-- customer root span is one trace), `failures` rows from trace's lw.trace.trace_failed. Each fold
-- owns its rows, applied event ids and projection version; readers sum a day's sources. A
-- projection replay rebuilds the rows from trace's log. Replaces "NurturingProjectTraceDay", which
-- stays in place, unread; dropping it is an operator step.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key, as for NurturingProjectTraceDay.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectTraceDayCount";

CREATE TABLE IF NOT EXISTS "NurturingProjectTraceDayCount" (
    "projectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "traceCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastTraceAt" TIMESTAMP(3),
    "lastFailedTraceAt" TIMESTAMP(3),
    "appliedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectionVersion" TEXT NOT NULL,

    CONSTRAINT "NurturingProjectTraceDayCount_pkey" PRIMARY KEY ("projectId", "day", "source")
);

CREATE INDEX IF NOT EXISTS "NurturingProjectTraceDayCount_day_idx" ON "NurturingProjectTraceDayCount"("day");
