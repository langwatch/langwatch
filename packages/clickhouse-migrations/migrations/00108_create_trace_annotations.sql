-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_annotations and trace_annotation_scores: trace's folds of annotation's
-- facts (round 24, EF-1), so trace's legacy read attaches annotations and names
-- their scores without an AnnotationApi read.
--
-- trace_annotations: one row per annotation and fold, written only by trace's
-- peer fold (trace_annotations.annotations). The newest updatedAt wins; a delete
-- is a tombstone (IsDeleted = 1) that nothing after it revives, so a backfill
-- racing a delete cannot bring the annotation back.
--
-- trace_annotation_scores: one row per score definition and fold, written only
-- by trace's peer fold (trace_annotations.annotationScores). A rename names old
-- results too, because results keep the score id.
--
-- Both are ReplacingMergeTree on Revision, which each fold raises on every
-- write for its aggregate. Reads MUST be replacement-aware (an IN-tuple on
-- max(Revision)): the dedup is eventual.
--
-- Not partitioned and no TTL: annotation keeps its rows without retention, and
-- trace reads them by trace id. Not enrolled in tenant retention.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL to every node itself.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_annotations
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter on
    -- TenantId first.
    TenantId String CODEC(ZSTD(1)),
    AnnotationId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    -- The content as annotation recorded it; NULL until a created or updated
    -- fact arrives (a delete can arrive first).
    Comment Nullable(String) CODEC(ZSTD(1)),
    IsThumbsUp Nullable(UInt8) CODEC(ZSTD(1)),
    ExpectedOutput Nullable(String) CODEC(ZSTD(1)),
    -- Score results keyed by score definition id, as JSON.
    ScoreOptions String DEFAULT '{}' CODEC(ZSTD(1)),
    AnchorKind Nullable(String) CODEC(ZSTD(1)),
    AnchorId Nullable(String) CODEC(ZSTD(1)),
    AnchorPath Nullable(String) CODEC(ZSTD(1)),
    HasContent UInt8 DEFAULT 0 CODEC(ZSTD(1)),
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- The annotation row's own write instant: the newest content wins on it.
    ContentUpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    IsDeleted UInt8 DEFAULT 0 CODEC(ZSTD(1)),
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- The ReplacingMergeTree version column.
    Revision UInt64 CODEC(Delta(8), ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}Revision)
ORDER BY (TenantId, AnnotationId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_annotation_scores
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter on
    -- TenantId first.
    TenantId String CODEC(ZSTD(1)),
    ScoreId String CODEC(ZSTD(1)),
    Name String CODEC(ZSTD(1)),
    -- When the score took this name; the newest name wins on it.
    NamedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- The ReplacingMergeTree version column.
    Revision UInt64 CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}Revision)
ORDER BY (TenantId, ScoreId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_annotation_scores;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_annotations;
-- +goose StatementEnd

-- +goose ENVSUB OFF
