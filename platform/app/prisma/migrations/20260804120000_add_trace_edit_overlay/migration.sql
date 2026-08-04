-- Reviewer corrections stored beside the captured trace, plus the queue-item
-- marker that feeds the end-of-queue dataset hand-off.
--
-- TraceEditOverlay is one row per (projectId, traceId): a correction replaces
-- the previous one rather than versioning it, and `updatedById` records who
-- last edited. `patch` is a version-1 document validated by the application on
-- both write and read, so a row this build cannot interpret reads as "no
-- correction" rather than failing a trace read.
--
-- AnnotationQueueItem.markedForDatasetAt is nullable and defaults to NULL, so
-- every existing queue item stays unmarked.

CREATE TABLE "TraceEditOverlay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceEditOverlay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TraceEditOverlay_projectId_traceId_key" ON "TraceEditOverlay"("projectId", "traceId");

CREATE INDEX "TraceEditOverlay_projectId_idx" ON "TraceEditOverlay"("projectId");

ALTER TABLE "TraceEditOverlay" ADD CONSTRAINT "TraceEditOverlay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TraceEditOverlay" ADD CONSTRAINT "TraceEditOverlay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TraceEditOverlay" ADD CONSTRAINT "TraceEditOverlay_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnnotationQueueItem" ADD COLUMN "markedForDatasetAt" TIMESTAMP(3);

-- Down (manual): reverses in dependency order; run only to roll back this
-- migration.
--   ALTER TABLE "AnnotationQueueItem" DROP COLUMN "markedForDatasetAt";
--   ALTER TABLE "TraceEditOverlay" DROP CONSTRAINT "TraceEditOverlay_updatedById_fkey";
--   ALTER TABLE "TraceEditOverlay" DROP CONSTRAINT "TraceEditOverlay_createdById_fkey";
--   ALTER TABLE "TraceEditOverlay" DROP CONSTRAINT "TraceEditOverlay_projectId_fkey";
--   DROP TABLE "TraceEditOverlay";
