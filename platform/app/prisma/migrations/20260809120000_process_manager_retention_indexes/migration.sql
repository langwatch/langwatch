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
-- of the build, which blocks INSERT while it runs. That is why the one-time
-- purge in dev/docs/runbooks/process-manager-table-purge.md runs FIRST: over a
-- near-empty heap these builds are near-instant, whereas over the pre-purge
-- 2.8M inbox rows the same build would hold the lock long enough to back up
-- automation ingestion. If this migration is ever replayed against a large
-- table, use CREATE INDEX CONCURRENTLY by hand instead, which cannot run
-- inside the migration transaction.

-- CreateIndex
CREATE INDEX "ProcessManagerOutbox_dispatchedAt_idx"
  ON "ProcessManagerOutbox"("dispatchedAt")
  WHERE "status" = 'dispatched';

-- CreateIndex
CREATE INDEX "ProcessManagerInbox_consumedAt_idx"
  ON "ProcessManagerInbox"("consumedAt");

-- Down (manual): reverses this migration; run only to roll back.
--   DROP INDEX "ProcessManagerOutbox_dispatchedAt_idx";
--   DROP INDEX "ProcessManagerInbox_consumedAt_idx";
