-- Where an insight came from and what its evidence replays with (modules/insight). Every
-- column is nullable or has a default, so an image that does not know them keeps reading
-- and writing the table, and a row folded before this migration reads as: no pointer,
-- saved from a chat, no window. Nothing references "Dashboard" or "CustomGraph": the board
-- and widget ids are a pointer, kept after either is deleted.
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "boardId" TEXT;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "boardName" TEXT;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "widgetId" TEXT;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "widgetName" TEXT;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "filedVia" TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "replayStart" DOUBLE PRECISION;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "replayEnd" DOUBLE PRECISION;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "replayGranularitySeconds" INTEGER;
ALTER TABLE "InsightProjection" ADD COLUMN IF NOT EXISTS "replayContext" JSONB;

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the columns: the table is a read model, rebuilt by
-- replaying the event log.
