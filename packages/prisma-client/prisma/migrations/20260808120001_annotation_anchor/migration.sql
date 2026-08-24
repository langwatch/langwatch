-- Which part of a trace a comment is about.
--
-- All three columns are nullable and default to NULL, so every existing
-- annotation stays a comment about the trace as a whole and no backfill is
-- needed. "anchorKind" is a plain string rather than an enum: a fourth kind of
-- part is then a code change and not a schema migration, and a kind an older
-- build does not recognise reads as a comment about the trace rather than
-- failing the list.
--
-- The composite index serves the read every trace-level surface makes: the
-- comments of one project's trace, narrowed to the ones about the trace itself.

ALTER TABLE "Annotation" ADD COLUMN "anchorKind" TEXT;
ALTER TABLE "Annotation" ADD COLUMN "anchorId" TEXT;
ALTER TABLE "Annotation" ADD COLUMN "anchorPath" TEXT;

CREATE INDEX "Annotation_projectId_traceId_anchorKind_idx" ON "Annotation"("projectId", "traceId", "anchorKind");

-- Down (manual): run only to roll back this migration.
--
-- WARNING: this destroys data. Dropping these columns permanently deletes which
-- part of a trace each comment was about, leaving every anchored comment
-- reading as a comment about the whole trace with no way to recover its anchor.
--   DROP INDEX "Annotation_projectId_traceId_anchorKind_idx";
--   ALTER TABLE "Annotation" DROP COLUMN "anchorPath";
--   ALTER TABLE "Annotation" DROP COLUMN "anchorId";
--   ALTER TABLE "Annotation" DROP COLUMN "anchorKind";
