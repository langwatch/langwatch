CREATE TABLE "IngestionPullRunProjection" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cron" TEXT,
    "cursor" TEXT,
    "lastRunAt" DOUBLE PRECISION,
    "lastRunOutcome" TEXT,
    "lastRunEventCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunError" TEXT,
    "lastRunErrorCode" TEXT,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "lastRunScheduledFor" DOUBLE PRECISION,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "occurredAt" DOUBLE PRECISION NOT NULL,
    "acceptedAt" DOUBLE PRECISION NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    CONSTRAINT "IngestionPullRunProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngestionPullRunProjection_sourceId_key"
  ON "IngestionPullRunProjection"("sourceId");
CREATE INDEX "IngestionPullRunProjection_projectId_idx"
  ON "IngestionPullRunProjection"("projectId");
