-- Nurturing's own trace counts, owned by nurturing, from trace's span_received (ARCHITECTURE §9):
-- a root span is one trace, as trace's rollup counts it, with its error status. One row per
-- project and UTC day of append time, its counts incremented in place by one upsert per batch of
-- the day's root spans; a redelivered batch may count twice. The per-email Customer.io traits sum
-- an organization's last 30 days, and the sync deletes older days.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: a deleted project's rows are never read again, and age out.
-- Not rebuilt by a projection replay: the rows are written by a subscriber, not a fold.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectTraceDay";

CREATE TABLE IF NOT EXISTS "NurturingProjectTraceDay" (
    "projectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "traceCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastTraceAt" TIMESTAMP(3),
    "lastFailedTraceAt" TIMESTAMP(3),

    CONSTRAINT "NurturingProjectTraceDay_pkey" PRIMARY KEY ("projectId", "day")
);
