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

-- AddColumn (nullable first so the backfill has somewhere to land)
ALTER TABLE "ProcessManagerInbox" ADD COLUMN "sourceEventKey" TEXT;

-- Backfill with the same derivation the store uses: sha256 of the UTF-8 bytes,
-- lowercase hex. `sha256()` is built in since Postgres 11.
UPDATE "ProcessManagerInbox"
SET "sourceEventKey" = encode(sha256(convert_to("sourceEventId", 'UTF8')), 'hex')
WHERE "sourceEventKey" IS NULL;

ALTER TABLE "ProcessManagerInbox" ALTER COLUMN "sourceEventKey" SET NOT NULL;

-- Swap the constraint. The old index cannot have held a row over the btree
-- limit (that was exactly the failure), so the digest of every surviving row is
-- as unique as the raw value it came from and the new index cannot conflict.
DROP INDEX "ProcessManagerInbox_processName_projectId_sourceEventId_key";

CREATE UNIQUE INDEX "ProcessManagerInbox_processName_projectId_sourceEventKey_key"
ON "ProcessManagerInbox"("processName", "projectId", "sourceEventKey");
