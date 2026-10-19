-- Expand only (Alex, audit R2). A producer's outbox delivers an audit intent at least once;
-- the key it minted finds the row a redelivery already wrote, so every row keeps the table's
-- one id scheme. Nullable: rows written without a key, and every release still serving that
-- never names the column, stay valid. NULLs are distinct, so the new index meets no duplicate.
--
-- LOCKING NOTE: the plain build takes a SHARE lock on "AuditLog" for its length; reads keep
-- working, audit writes wait. A deployment with a large audit table can build it ahead of the
-- release, outside Prisma's transaction, as 20261006120000_process_outbox_lease_by_process_index
-- describes (check pg_index.indisvalid after a failed concurrent build):
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_idempotencyKey_key"
--     ON "AuditLog" ("idempotencyKey");
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_idempotencyKey_key" ON "AuditLog" ("idempotencyKey");

-- Down (manual rollback; uncomment and run). The column holds only outbox keys:
-- DROP INDEX IF EXISTS "AuditLog_idempotencyKey_key";
-- ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "idempotencyKey";
