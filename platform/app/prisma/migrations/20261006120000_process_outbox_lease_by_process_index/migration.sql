-- Backs each process manager's outbox lease (PrismaProcessStore.leaseDueMessages):
-- WHERE "status" = 'pending' AND "processName" IN (...) AND "nextAttemptAt" <= now
-- ORDER BY "nextAttemptAt". The older (status, nextAttemptAt, leasedUntil) index
-- carries no processName, so every manager's poller walked every manager's due
-- rows. That index stays: retiring it is a later contract step.
--
-- Built CONCURRENTLY so outbox writes (every intent a process manager commits)
-- never wait on the build. That only works because this file holds exactly ONE
-- statement: prisma migrate deploy sends the file as one simple query, which
-- Postgres runs as an implicit transaction block only when it holds several
-- statements, and CONCURRENTLY fails there with 25001. Add nothing else to
-- this file.
--
-- The trap: a CONCURRENTLY build that FAILS leaves an INVALID index under this
-- name; IF NOT EXISTS then skips it on a re-run and the planner never uses it.
-- After a failed apply, check
--   SELECT indisvalid FROM pg_index WHERE indexrelid =
--     '"ProcessManagerOutbox_status_processName_nextAttemptAt_idx"'::regclass;
-- and DROP INDEX CONCURRENTLY it before `prisma migrate resolve --rolled-back`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerOutbox_status_processName_nextAttemptAt_idx"
  ON "ProcessManagerOutbox" ("status", "processName", "nextAttemptAt");

-- Down (manual rollback; uncomment and run). The index holds no row data of its
-- own; the lease falls back to the (status, nextAttemptAt, leasedUntil) index.
-- DROP INDEX CONCURRENTLY IF EXISTS "ProcessManagerOutbox_status_processName_nextAttemptAt_idx";
