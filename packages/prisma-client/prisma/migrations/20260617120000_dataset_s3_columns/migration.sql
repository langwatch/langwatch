-- ADR-032: dataset content moves to S3 as chunked JSONL.
-- Additive only: new nullable columns + defaults so existing rows stay valid.
-- `useS3` (dead single-blob path) is intentionally left untouched; the new
-- layout is marked by `contentLayout`.

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "contentLayout" TEXT NOT NULL DEFAULT 'postgres',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ready',
ADD COLUMN     "statusError" TEXT,
ADD COLUMN     "rowCount" INTEGER,
ADD COLUMN     "sizeBytes" BIGINT,
ADD COLUMN     "chunkCount" INTEGER,
ADD COLUMN     "chunkOffsets" JSONB;
