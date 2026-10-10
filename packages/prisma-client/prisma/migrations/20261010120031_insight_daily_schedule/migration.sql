-- The daily insights run (modules/insight): one row per project, person and board, holding
-- how that person's last run on the board ended. A read model folded from the
-- `insight_daily_schedule` aggregate's events, rebuildable by replaying the event log.
-- `state`, `hour`, `timezone`, `maxInsights` and `lastRunRenewed` are written by later slices
-- (the schedule and renewal); they are created here so the table is not altered for them.
-- Re-runnable on purpose: every statement is a no-op on a database that already applied it.
CREATE TABLE IF NOT EXISTS "InsightDailyScheduleProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "boardKind" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "boardName" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'undecided',
  "hour" INTEGER,
  "timezone" TEXT,
  "maxInsights" INTEGER,
  "lastRunId" TEXT,
  "lastRunAt" DOUBLE PRECISION,
  "lastRunOutcome" TEXT,
  "lastRunReason" TEXT,
  "lastRunFiled" INTEGER,
  "lastRunRenewed" INTEGER,
  "lastRunConversationId" TEXT,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "InsightDailyScheduleProjection_pkey" PRIMARY KEY ("id")
);

-- Every read names the project and the person, so the unique index serves them too. Named by
-- hand: the generated name is longer than the 63 bytes Postgres keeps.
CREATE UNIQUE INDEX IF NOT EXISTS "InsightDailySchedule_projectId_userId_board_key"
  ON "InsightDailyScheduleProjection" ("projectId", "userId", "boardKind", "boardId");

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe: the table is a read model, rebuilt by replaying the event log:
--   DROP TABLE "InsightDailyScheduleProjection";
