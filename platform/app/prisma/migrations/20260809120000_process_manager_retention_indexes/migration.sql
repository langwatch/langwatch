-- Indexes for the process-manager retention sweep.
--
-- The sweep reaps by AGE across every process name, which is the one shape
-- neither table could answer. Both existing indexes lead on a column the sweep
-- cannot name:
--
--   ProcessManagerOutbox("status", "nextAttemptAt", "leasedUntil")
--     Leads on status, which is fine for `status='dead'` (a rare value) but
--     useless for `status='dispatched'`: in production 99.98% of outbox rows
--     are dispatched, so that predicate selects almost the whole table and the
--     planner reads the heap anyway. The sweep's real selectivity is in
--     `dispatchedAt`, which the index does not carry at all.
--
--   ProcessManagerInbox("processName", "projectId", "processKey", "consumedAt")
--     Leads on processName. The sweep deliberately has no processName
--     predicate — reaping by predicate rather than per registered process is
--     what makes it cover the process managers nobody registered a prune for.
--     With the leading column unbound this index cannot be ranged at all.
--
-- The dispatched index is PARTIAL. A plain index on "dispatchedAt" would carry
-- an entry for every row in the table, most of which the sweep never looks at,
-- and would be write amplification on the highest-volume insert path in the
-- system. Restricted to dispatched rows it indexes exactly the reap set.
-- Prisma's schema language cannot express a partial index, so this is raw SQL
-- (same reason and precedent as the EmailSuppression partial index). It keeps
-- the name Prisma would generate for the plain `@@index([dispatchedAt])` the
-- schema declares, so the schema stays the source of truth for "this column is
-- indexed" and no drift is reported for a predicate Prisma cannot model.
--
-- No index is added for the dead family. `dead` is a rare status (95 rows out
-- of 473k in production), so the existing (status, ...) index is already
-- selective enough for it, and a second partial index would cost writes to
-- save nothing.
--
-- LOCKING. Both statements take a SHARE lock on their table for the duration
-- of the build, which blocks INSERT while it runs, on the two highest-volume
-- insert paths in the system. `CREATE INDEX CONCURRENTLY` would avoid that but
-- cannot run inside the transaction Prisma applies a migration in, and this
-- migration is applied automatically on pod start (`prisma migrate deploy`,
-- unless SKIP_PRISMA_MIGRATE is set), so it cannot assume an operator is
-- watching.
--
-- Each build is therefore wrapped in its own timeout-guarded block:
--
--   lock_timeout      caps how long we WAIT for the SHARE lock. Without it, a
--                     build queued behind one long-running transaction parks in
--                     the lock queue and every INSERT arriving after it queues
--                     behind US, which turns a slow query into a write outage.
--   statement_timeout caps how long we HOLD it. A build over a near-empty heap
--                     finishes in milliseconds; one over a large backlog aborts
--                     instead of stalling ingestion.
--
-- On timeout the block logs a warning and the deploy continues WITHOUT the
-- index. That is the correct trade: the sweep still works without it (it just
-- scans instead of ranging), whereas a blocked deploy stops everything. Finish
-- the job out of band, which is also the path to take if this migration is ever
-- replayed against a large table:
--
--   1. Run the purge: dev/docs/runbooks/process-manager-table-purge.md
--   2. CREATE INDEX CONCURRENTLY, same names, from a psql session.
--
-- `IF NOT EXISTS` makes both orders work: an index already built by hand is
-- adopted rather than conflicted with.

-- CreateIndex
DO $$
BEGIN
  SET LOCAL lock_timeout = '3s';
  SET LOCAL statement_timeout = '60s';
  CREATE INDEX IF NOT EXISTS "ProcessManagerOutbox_dispatchedAt_idx"
    ON "ProcessManagerOutbox"("dispatchedAt")
    WHERE "status" = 'dispatched';
EXCEPTION
  WHEN lock_not_available OR query_canceled THEN
    RAISE WARNING 'Skipped ProcessManagerOutbox_dispatchedAt_idx: could not build it within the deploy timeout. Purge the backlog, then CREATE INDEX CONCURRENTLY by hand.';
END $$;

-- CreateIndex
DO $$
BEGIN
  SET LOCAL lock_timeout = '3s';
  SET LOCAL statement_timeout = '60s';
  CREATE INDEX IF NOT EXISTS "ProcessManagerInbox_consumedAt_idx"
    ON "ProcessManagerInbox"("consumedAt");
EXCEPTION
  WHEN lock_not_available OR query_canceled THEN
    RAISE WARNING 'Skipped ProcessManagerInbox_consumedAt_idx: could not build it within the deploy timeout. Purge the backlog, then CREATE INDEX CONCURRENTLY by hand.';
END $$;

-- Down (manual): reverses this migration; run only to roll back.
--   DROP INDEX "ProcessManagerOutbox_dispatchedAt_idx";
--   DROP INDEX "ProcessManagerInbox_consumedAt_idx";
