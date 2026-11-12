-- +goose Up
-- +goose ENVSUB ON

-- Each evaluation's outcome beside its trace's columns, for the stock widgets that join the two
-- (trace ADR-003). The traceAnalytics fold writes it: one live row per (TenantId, TraceId,
-- EvaluationId); a change writes the old row again with Sign = -1 (same Revision) and the new
-- row with Sign = +1 and the next Revision, so readers sum Sign and never need FINAL.
--
-- trace_analytics gains the fold's evaluation outcomes (JSON) and the digest of the rows it last
-- wrote, so its read-back skips the live-row read when nothing moved. Plain columns with a
-- DEFAULT: an older release writes ''. The background steps trace:record-evaluation-outcomes and
-- trace:replay-trace-evaluation-analytics fill the last 62 days; this file copies no rows.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses the Replicated
-- engine (00001), which propagates DDL to every node on its own.

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_evaluation_analytics
(
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    EvaluationId String CODEC(ZSTD(1)),
    -- the evaluation's time, as evaluation_analytics has it
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- processing time of the write
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- trace_analytics.OccurredAt of the trace
    TraceOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    Status LowCardinality(String),
    IsGuardrail Bool,
    Passed Nullable(Bool),
    Label Nullable(String) CODEC(ZSTD(1)),
    -- the evaluation's origin; evaluation_analytics writes NULL today, and so does this table
    Origin Nullable(String) CODEC(ZSTD(1)),
    -- trace_analytics.Origin
    TraceOrigin Nullable(String) CODEC(ZSTD(1)),
    CustomerId Nullable(String) CODEC(ZSTD(1)),
    TopicId Nullable(String) CODEC(ZSTD(1)),
    Labels Array(String) DEFAULT [] CODEC(ZSTD(1)),
    MetadataTopic String DEFAULT '' CODEC(ZSTD(1)),
    MetadataDocumentType String DEFAULT '' CODEC(ZSTD(1)),
    MetadataLanguage String DEFAULT '' CODEC(ZSTD(1)),
    MetadataTeam String DEFAULT '' CODEC(ZSTD(1)),
    MetadataFlow String DEFAULT '' CODEC(ZSTD(1)),
    MetadataSegment String DEFAULT '' CODEC(ZSTD(1)),
    MetadataPromptVersion String DEFAULT '' CODEC(ZSTD(1)),
    Sign Int8,
    Revision UInt64,
    _retention_days UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_VERSIONED_COLLAPSING_PREFIX:-VersionedCollapsingMergeTree(}Sign, Revision)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, OccurredAt, TraceId, EvaluationId)
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS EvaluationOutcomes String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS EvaluationRowsDigest String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP TABLE and a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_evaluation_analytics;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS EvaluationOutcomes;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS EvaluationRowsDigest;
