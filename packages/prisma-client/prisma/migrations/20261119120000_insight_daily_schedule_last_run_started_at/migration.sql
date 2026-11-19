-- When the last run of a daily insights schedule started (modules/insight, ADR-004), so Run now
-- tells a run that started after the request from a lost run that settled late. The column is
-- nullable, so an image that does not know it keeps reading and writing the table. Nothing is
-- backfilled: a row folded before this migration names no start until its next run settles.
-- Re-runnable on purpose: the statement is a no-op on a database that already applied it.
ALTER TABLE "InsightDailyScheduleProjection"
  ADD COLUMN IF NOT EXISTS "lastRunStartedAt" DOUBLE PRECISION;

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the column: the table is a read model, rebuilt by
-- replaying the event log.
