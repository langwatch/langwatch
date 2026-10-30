-- The actions an insight card offers (modules/insight, ADR-005): up to four `{ id, label, prompt }`
-- objects, each a prompt a click sends to Langy. The column is nullable, so an image that does
-- not know it keeps reading and writing the table. A row folded before this migration, or by
-- such an image, holds NULL and reads as no actions; nothing is backfilled here, and replaying
-- the insight projection fills the column. No index: nothing filters or sorts on it.
-- Re-runnable on purpose: the statement is a no-op on a database that already applied it.
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "actions" JSONB;

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the column: the table is a read model, rebuilt by
-- replaying the event log.
