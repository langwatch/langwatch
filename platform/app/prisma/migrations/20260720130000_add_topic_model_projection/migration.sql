-- ADR-051: cursor row for the topic-model projection. The model itself is
-- the existing "Topic" table, written through by the projection; this row
-- records how far the fold has applied the event log. Rebuildable by replay.
CREATE TABLE IF NOT EXISTS "TopicModelProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "TopicModelProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TopicModelProjection_projectId_key"
  ON "TopicModelProjection" ("projectId");

-- IRREVERSIBLE: no executable down step by convention. Manual rollback:
--   DROP TABLE "TopicModelProjection";
-- (cursor only; the Topic table and event log are untouched by a rollback)
