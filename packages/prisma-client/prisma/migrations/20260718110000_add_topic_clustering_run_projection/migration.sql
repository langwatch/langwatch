-- ADR-051: per-project topic clustering run status projection (Postgres
-- operational read model; rebuildable by replaying the event log).
CREATE TABLE IF NOT EXISTS "TopicClusteringRunProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "lastRequestedAt" DOUBLE PRECISION,
  "lastRequestTrigger" TEXT,
  "lastRunAt" DOUBLE PRECISION,
  "lastRunOutcome" TEXT,
  "lastRunMode" TEXT,
  "lastRunSkippedReason" TEXT,
  "lastRunError" TEXT,
  "lastRunErrorCode" TEXT,
  "lastRunErrorUserActionable" BOOLEAN NOT NULL DEFAULT false,
  "lastRunTracesProcessed" INTEGER NOT NULL DEFAULT 0,
  "lastRunTopicsCount" INTEGER NOT NULL DEFAULT 0,
  "lastRunSubtopicsCount" INTEGER NOT NULL DEFAULT 0,
  "lastRunPages" INTEGER NOT NULL DEFAULT 0,
  "inProgressRunId" TEXT,
  "inProgressTraces" INTEGER NOT NULL DEFAULT 0,
  "inProgressPages" INTEGER NOT NULL DEFAULT 0,
  "inProgressStartedAt" DOUBLE PRECISION,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "TopicClusteringRunProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TopicClusteringRunProjection_projectId_key"
  ON "TopicClusteringRunProjection" ("projectId");

-- IRREVERSIBLE: Prisma migration files carry no executable down step by
-- convention. Manual rollback is safe and trivial — this table is a read
-- model, rebuildable by replaying the event log (see the replay scenario in
-- specs/topic-clustering/event-sourced-scheduling.feature); no
-- source-of-truth data lives here:
--   DROP TABLE "TopicClusteringRunProjection";
