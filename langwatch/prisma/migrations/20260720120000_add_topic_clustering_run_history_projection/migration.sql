-- ADR-051: per-project topic clustering run history (Postgres audit read
-- model; one row per project, bounded newest-first run entries as JSON;
-- rebuildable by replaying the event log).
CREATE TABLE IF NOT EXISTS "TopicClusteringRunHistoryProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "runs" JSONB NOT NULL,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "TopicClusteringRunHistoryProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TopicClusteringRunHistoryProjection_projectId_key"
  ON "TopicClusteringRunHistoryProjection" ("projectId");

-- IRREVERSIBLE: Prisma migration files carry no executable down step by
-- convention. Manual rollback is safe and trivial — this table is a read
-- model, rebuildable by replaying the event log (see the replay scenario in
-- specs/topic-clustering/run-history.feature); no source-of-truth data
-- lives here:
--   DROP TABLE "TopicClusteringRunHistoryProjection";
