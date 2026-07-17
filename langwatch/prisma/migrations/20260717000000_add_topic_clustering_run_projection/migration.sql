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
  "lastRunTracesProcessed" INTEGER NOT NULL DEFAULT 0,
  "lastRunTopicsCount" INTEGER NOT NULL DEFAULT 0,
  "lastRunSubtopicsCount" INTEGER NOT NULL DEFAULT 0,
  "lastRunPages" INTEGER NOT NULL DEFAULT 0,
  "inProgressRunId" TEXT,
  "inProgressTraces" INTEGER NOT NULL DEFAULT 0,
  "inProgressPages" INTEGER NOT NULL DEFAULT 0,
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
