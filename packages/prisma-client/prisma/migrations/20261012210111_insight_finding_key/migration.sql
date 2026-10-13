-- The key a daily run matches a repeated finding by (modules/insight, ADR-004). A run that
-- finds the same thing again renews the insight that holds the key and files no twin. The
-- column is nullable, so an image that does not know it keeps reading and writing the table.
-- A row folded before this migration, or by such an image, holds NULL and is matched by no
-- key; nothing is backfilled here, and replaying the insight projection fills the column.
-- No index: a run matches in memory, over the rows the inbox read already answers.
-- Re-runnable on purpose: the statement is a no-op on a database that already applied it.
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "findingKey" TEXT;

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the column: the table is a read model, rebuilt by
-- replaying the event log.
