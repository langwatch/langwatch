-- Why a daily insights schedule is off, and how many scheduled days in a row its run was
-- skipped (modules/insight, ADR-004). The system turns a schedule off when its board is gone,
-- when its person left the organisation, when its project is archived, or after 7 skipped
-- days; `offReason` keeps which, for the person and the operator. `consecutiveSkips` and
-- `skipStreakSlot` are that count and the slot of the newest run counted. The columns are
-- nullable or defaulted, so an image that does not know them keeps reading and writing the
-- table. A row folded before this migration holds no reason and a count of 0; nothing is
-- backfilled here, and replaying the daily schedule projection fills the columns.
-- Re-runnable on purpose: the statement is a no-op on a database that already applied it.
ALTER TABLE "InsightDailyScheduleProjection"
  ADD COLUMN IF NOT EXISTS "offReason" TEXT,
  ADD COLUMN IF NOT EXISTS "consecutiveSkips" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skipStreakSlot" DOUBLE PRECISION;

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the columns: the table is a read model, rebuilt by
-- replaying the event log.
