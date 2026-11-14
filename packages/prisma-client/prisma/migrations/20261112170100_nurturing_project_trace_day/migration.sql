-- Nurturing's own trace counts per project and UTC day of append time, owned by nurturing:
-- traceCount from trace's span_received (a root span is one trace), errorCount from trace's
-- lw.trace.trace_failed (ARCHITECTURE §9). Each batch adds the traces it counted to the day's row; a
-- redelivered batch can count a trace twice (accepted, issue 9378). The
-- per-email Customer.io traits sum an organization's rows; rows are written only inside an
-- organization's trace counting window and dropped when it ends (the window-end sweep).
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: a deleted project's rows are never read again, and are dropped with the window.
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
