-- Backs the hourly process-manager retention sweep (PrismaProcessStore
-- deleteDispatchedOutboxBatch and deleteConsumedInboxBatch), which picks
-- expired rows by age across every process name:
--   outbox: WHERE "status" = 'dispatched' AND "dispatchedAt" < $before
--   inbox:  WHERE "consumedAt" < $before
-- No existing index leads on either age, so every sweep batch read the whole
-- table. These two indexes used to be an operator-only step in
-- dev/docs/runbooks/process-manager-table-purge.md. Production never ran it,
-- and on 2026-10-14 the sweep's reads hit the volume's IOPS ceiling. Shipping
-- them here means no install depends on that step.
--
-- The outbox index is partial: restricted to `dispatched` rows, it indexes
-- exactly the reap set and adds no write cost to pending rows on the hot
-- insert path. Prisma cannot express a partial index, so it lives only in this
-- SQL; the ProcessManagerOutbox schema comment is its home in the model.
--
-- IF NOT EXISTS is deliberate, as in 20261006120000_process_outbox_lease_by_process_index.
-- A deployment with real traffic should build both ahead of the release,
-- outside Prisma's transaction, where CONCURRENTLY can run:
--   ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerOutbox_dispatchedAt_idx"
--     ON "ProcessManagerOutbox" ("dispatchedAt") WHERE "status" = 'dispatched';
--   ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerInbox_consumedAt_idx"
--     ON "ProcessManagerInbox" ("consumedAt");
-- and these statements then become the no-ops that record the same intent.
--
-- The trap in that path: a CREATE INDEX CONCURRENTLY that FAILS leaves an
-- invalid index under this exact name, IF NOT EXISTS then skips, and the
-- planner never uses an invalid index. Anyone taking the concurrent path must
-- check
--   SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--   WHERE NOT i.indisvalid AND c.relname LIKE 'ProcessManager%';
-- and DROP INDEX CONCURRENTLY each one it names before retrying. The upgrade's
-- pre-built index check (packages/upgrade/src/stepping/prebuilt-indexes.ts)
-- also stops on an invalid or differently shaped index under either name.
--
-- LOCKING NOTE: left alone, each plain build takes a SHARE lock on its table
-- for its whole length. Reads keep working; inserts wait, and these are the two
-- highest-volume insert paths in the system. The sweep keeps both tables
-- bounded (24 hours of dispatched outbox, 7 days of consumed inbox), so expect
-- seconds rather than minutes, and plan the concurrent pre-build above for any
-- install with real traffic. It is not mandatory because requiring it would
-- fail this migration on every fresh install.
CREATE INDEX IF NOT EXISTS "ProcessManagerOutbox_dispatchedAt_idx"
  ON "ProcessManagerOutbox" ("dispatchedAt")
  WHERE "status" = 'dispatched';

CREATE INDEX IF NOT EXISTS "ProcessManagerInbox_consumedAt_idx"
  ON "ProcessManagerInbox" ("consumedAt");

-- Down (manual rollback; uncomment and run). The indexes hold no row data of
-- their own; the sweep falls back to scanning. A plain DROP INDEX takes ACCESS
-- EXCLUSIVE and blocks reads too; outside Prisma's transaction, DROP INDEX
-- CONCURRENTLY does not block:
-- DROP INDEX CONCURRENTLY IF EXISTS "ProcessManagerOutbox_dispatchedAt_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "ProcessManagerInbox_consumedAt_idx";
