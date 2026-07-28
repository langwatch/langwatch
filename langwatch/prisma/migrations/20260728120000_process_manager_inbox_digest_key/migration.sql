-- The inbox's uniqueness moves off the raw source event id and onto a
-- fixed-width digest of it.
--
-- The raw id is `idempotencyKey ?? id`, composed by whichever pipeline emits
-- the command, so its length was never the store's to guarantee. Postgres
-- refuses a btree index row past ~2704 bytes, and a long enough key therefore
-- turned the inbox insert into a hard SQLSTATE 54000 inside the commit
-- transaction — deterministic, so the queue's retry ladder ran out and parked
-- the aggregate's group permanently.
--
-- `sourceEventId` is kept as an unindexed column so operators can still read
-- what was consumed.
--
-- WRITTEN FOR A ROLLING DEPLOY. `prisma migrate deploy` runs at pod boot, so
-- this lands while pods running the PREVIOUS build are still serving — and
-- those pods insert inbox rows without `sourceEventKey`. The column therefore
-- stays NULLABLE here: a NOT NULL would fail every one of their commits with a
-- 23502, deterministically, which is the exact "commit fails inside the
-- transaction → ladder exhausts → group parks" chain this migration exists to
-- end. A follow-up migration adds NOT NULL once the fleet has cycled.
--
-- Uniqueness is unaffected in the meantime: btree treats NULLs as distinct, so
-- an old pod's row simply is not covered by the new constraint. It is still
-- covered by nothing worse than it had before, and the new pods — the only ones
-- that can write an oversized key — are fully constrained.

-- AddColumn
ALTER TABLE "ProcessManagerInbox" ADD COLUMN "sourceEventKey" TEXT;

-- Backfill with the same derivation the store uses: sha256 of the UTF-8 bytes,
-- lowercase hex. `sha256()` is built in since Postgres 11.
UPDATE "ProcessManagerInbox"
SET "sourceEventKey" = encode(sha256(convert_to("sourceEventId", 'UTF8')), 'hex')
WHERE "sourceEventKey" IS NULL;

-- Swap the constraint. The old index cannot have held a row over the btree
-- limit (that was exactly the failure), so the digest of every surviving row is
-- as unique as the raw value it came from and the new index cannot conflict.
--
-- Guarded both ways to match the migration that created the old index
-- (20260716140000 used CREATE UNIQUE INDEX IF NOT EXISTS), so an environment
-- that diverged does not fail this one mid-transaction.
DROP INDEX IF EXISTS "ProcessManagerInbox_processName_projectId_sourceEventId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ProcessManagerInbox_processName_projectId_sourceEventKey_key"
ON "ProcessManagerInbox"("processName", "projectId", "sourceEventKey");
