-- A daily insights schedule's last run that started (modules/insight, ADR-004): its run id, its
-- Langy conversation and when it started, beside the last run that settled and how it ended, and
-- the newest run's id, and its and the last settled run's slot and start, which order runs so an
-- older run's late start or outcome leaves it.
-- Run now reads it as the run in flight until that run settles, and as the last run once it has.
-- A read model folded from the `insight_daily_schedule` aggregate's run events, one row per
-- schedule. Until a schedule's row here took an outcome, its last run is read from its run row.
-- A new table, so no release still serving reads or writes it; it starts empty, which reads as
-- no run in flight, and is not replayed: Run now is new, so no earlier run is in flight.
-- Re-runnable on purpose: the statement is a no-op on a database that already applied it.
CREATE TABLE IF NOT EXISTS "InsightRunInFlightProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "runId" TEXT,
  "conversationId" TEXT,
  "startedAt" DOUBLE PRECISION,
  "lastSettledRunId" TEXT,
  "lastRunAt" DOUBLE PRECISION,
  "lastRunOutcome" TEXT,
  "lastRunReason" TEXT,
  "lastRunFiled" INTEGER,
  "lastRunRenewed" INTEGER,
  "lastRunConversationId" TEXT,
  "newestRunId" TEXT,
  "newestRunSlot" DOUBLE PRECISION,
  "newestRunSince" DOUBLE PRECISION,
  "lastSettledRunSlot" DOUBLE PRECISION,
  "lastSettledRunSince" DOUBLE PRECISION,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "InsightRunInFlightProjection_pkey" PRIMARY KEY ("id")
);

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. A rollback
-- leaves the table, which the previous release ignores; a drop is an operator step.
