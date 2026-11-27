-- +goose Up
-- +goose ENVSUB ON

-- The metadata keys the stock dashboard widgets read, as their own columns on trace_analytics.
--
-- Those widgets read `traces` only for these keys, and on a large project they run out of
-- memory there (tasks#1117). trace_metrics withholds the Attributes map (tasks#598), and the
-- map is heavy even when filtered, so each key becomes one small column instead. The trim keeps
-- every `metadata.*` key (cut at 4096 characters), so the values are on the map to copy.
--
-- MATERIALIZED, not written by the fold: ClickHouse computes the value from the row's own
-- Attributes, so an older release that writes the row still fills it, and a part written before
-- this ALTER computes it on read until the mutation below has stored it. A missing key reads ''.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses the Replicated
-- engine (00001), which propagates DDL to every node on its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataOutputAction String
    MATERIALIZED Attributes['metadata.output_action'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataOutcome String
    MATERIALIZED Attributes['metadata.outcome'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- `metadata.sent_to_review` stays text ('true', 'false'): the widgets compare it as text today.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataSentToReview String
    MATERIALIZED Attributes['metadata.sent_to_review'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataDocumentType String
    MATERIALIZED Attributes['metadata.document_type'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataFlow String
    MATERIALIZED Attributes['metadata.flow'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataLanguage String
    MATERIALIZED Attributes['metadata.language'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataSegment String
    MATERIALIZED Attributes['metadata.segment'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataTeam String
    MATERIALIZED Attributes['metadata.team'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataTopic String
    MATERIALIZED Attributes['metadata.topic'] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- Stores the nine values in parts written before this migration, so a read of them no longer
-- opens the map. One ALTER makes one mutation: each part is rewritten once, not nine times.
-- background step: trace:track-analytics-metadata-columns-materialisation
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  MATERIALIZE COLUMN MetadataOutputAction,
  MATERIALIZE COLUMN MetadataOutcome,
  MATERIALIZE COLUMN MetadataSentToReview,
  MATERIALIZE COLUMN MetadataDocumentType,
  MATERIALIZE COLUMN MetadataFlow,
  MATERIALIZE COLUMN MetadataLanguage,
  MATERIALIZE COLUMN MetadataSegment,
  MATERIALIZE COLUMN MetadataTeam,
  MATERIALIZE COLUMN MetadataTopic
  SETTINGS mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataOutputAction;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataOutcome;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataSentToReview;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataDocumentType;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataFlow;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataLanguage;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataSegment;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataTeam;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataTopic;
