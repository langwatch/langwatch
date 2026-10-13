-- The insights inbox (modules/insight): one row per insight, and one row per insight and
-- reader for that reader's own seen, done and kept state. Both are read models folded from
-- the `insight` aggregate's events, rebuildable by replaying the event log.
-- Re-runnable on purpose: this folder was first keyed 20261009120000, so a database that
-- applied it under that key applies it again under this one, and every statement is a no-op.
CREATE TABLE IF NOT EXISTS "InsightProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "topic" TEXT,
  "validDays" INTEGER NOT NULL,
  "lwql" TEXT,
  "sourceConversationId" TEXT,
  "sourceMessageId" TEXT,
  "filedByUserId" TEXT,
  "filedAt" DOUBLE PRECISION NOT NULL,
  "renewedAt" DOUBLE PRECISION,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "InsightProjection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InsightProjection_projectId_filedAt_idx"
  ON "InsightProjection" ("projectId", "filedAt");

CREATE TABLE IF NOT EXISTS "InsightReaderProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "insightId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seenAt" DOUBLE PRECISION,
  "archivedAt" DOUBLE PRECISION,
  "keptAt" DOUBLE PRECISION,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "InsightReaderProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InsightReaderProjection_projectId_insightId_userId_key"
  ON "InsightReaderProjection" ("projectId", "insightId", "userId");

CREATE INDEX IF NOT EXISTS "InsightReaderProjection_projectId_userId_idx"
  ON "InsightReaderProjection" ("projectId", "userId");

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe: both tables are read models, rebuilt by replaying the event log:
--   DROP TABLE "InsightReaderProjection";
--   DROP TABLE "InsightProjection";
