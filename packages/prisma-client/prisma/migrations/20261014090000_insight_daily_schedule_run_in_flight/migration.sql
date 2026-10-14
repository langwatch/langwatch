-- The run of a daily insights schedule that started and has not settled (modules/insight,
-- ADR-004): its run id, its Langy conversation and when it started, so Run now can open the
-- run in Langy. The columns are nullable, so an image that does not know them keeps reading
-- and writing the table. A row folded before this migration names no run in flight; nothing
-- is backfilled, and a run that starts after it fills the columns.
-- Re-runnable on purpose: the statement is a no-op on a database that already applied it.
ALTER TABLE "InsightDailyScheduleProjection"
  ADD COLUMN IF NOT EXISTS "runInFlightId" TEXT,
  ADD COLUMN IF NOT EXISTS "runInFlightConversationId" TEXT,
  ADD COLUMN IF NOT EXISTS "runInFlightStartedAt" DOUBLE PRECISION;

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the columns: the table is a read model, rebuilt by
-- replaying the event log.
