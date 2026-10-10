-- Whose insight it is (modules/insight, ADR-003). An insight is personal: its owner alone
-- reads it and acts on it. The column is nullable, so an image that does not know it keeps
-- reading and writing the table. A row folded before this migration, or by such an image,
-- holds NULL and reads as owned by whoever filed it ("filedByUserId"); nothing is backfilled
-- here, and replaying the insight projection fills the column.
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

-- Backs the inbox read (PrismaInsightRepository.findForReader):
-- WHERE "projectId" = $1 AND "ownerUserId" = $2 ORDER BY "filedAt" DESC LIMIT n.
--
-- ops pre-build: a deployment with insights already filed builds this ahead of the release,
-- outside Prisma's transaction, where CONCURRENTLY can run:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "InsightProjection_projectId_ownerUserId_filedAt_idx"
--     ON "InsightProjection" ("projectId", "ownerUserId", "filedAt");
-- and this statement is then the no-op that records the same intent. A concurrent build that
-- fails leaves an invalid index under this name, which IF NOT EXISTS then skips: check
--   SELECT indisvalid FROM pg_index WHERE indexrelid =
--     '"InsightProjection_projectId_ownerUserId_filedAt_idx"'::regclass;
-- and DROP INDEX CONCURRENTLY before retrying.
CREATE INDEX IF NOT EXISTS "InsightProjection_projectId_ownerUserId_filedAt_idx"
  ON "InsightProjection" ("projectId", "ownerUserId", "filedAt");

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the column: the table is a read model, rebuilt by
-- replaying the event log.
