-- Age indexes for the process-manager retention sweep. Why, locking, the
-- concurrent pre-build and the invalid-index check:
-- dev/docs/runbooks/process-manager-table-purge.md step 5.
-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerOutbox_dispatchedAt_idx" ON "ProcessManagerOutbox" ("dispatchedAt") WHERE "status" = 'dispatched';
CREATE INDEX IF NOT EXISTS "ProcessManagerOutbox_dispatchedAt_idx"
  ON "ProcessManagerOutbox" ("dispatchedAt")
  WHERE "status" = 'dispatched';

-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerInbox_consumedAt_idx" ON "ProcessManagerInbox" ("consumedAt");
CREATE INDEX IF NOT EXISTS "ProcessManagerInbox_consumedAt_idx"
  ON "ProcessManagerInbox" ("consumedAt");

-- Down (manual rollback; Prisma runs no down step, so uncomment and run outside a transaction):
-- DROP INDEX CONCURRENTLY IF EXISTS "ProcessManagerOutbox_dispatchedAt_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "ProcessManagerInbox_consumedAt_idx";
