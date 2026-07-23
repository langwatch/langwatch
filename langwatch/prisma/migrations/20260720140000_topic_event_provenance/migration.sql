-- ADR-051: the Topic table is now a projection of the topic-clustering
-- event stream. Each row records which `topics_recorded` event recorded it;
-- NULL marks a legacy row written before event ownership (i.e. not yet
-- seeded onto the stream).
ALTER TABLE "Topic" ADD COLUMN IF NOT EXISTS "lastEventId" TEXT;

COMMENT ON TABLE "Topic" IS
  'Projection of the topic-clustering event stream (ADR-051): written only by TopicModelFoldProjection, rebuildable by replay. Cursor: TopicModelProjection.';
COMMENT ON COLUMN "Topic"."lastEventId" IS
  'Event-log id of the topics_recorded event that recorded this row; NULL = legacy row predating event ownership.';

-- IRREVERSIBLE: no executable down step by convention. Manual rollback:
--   ALTER TABLE "Topic" DROP COLUMN "lastEventId";
-- (provenance only; topic data and the event log are untouched)
