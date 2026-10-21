-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Trace's embeddings (modules/trace/adrs/003-similar-traces-from-clustering-embeddings.md):
-- one row per trace and embeddings model, the 1536-wide vector topic clustering
-- already computes from the trace's input, kept so "traces like this one" can rank
-- a project's traces by cosineDistance. Written by trace's repository from the
-- clustering intent, never from a projection. Int8: langevals scales each vector
-- so its largest component is 127; cosine distance ignores the scale.
--
-- ReplacingMergeTree(UpdatedAt) on (TenantId, EmbeddingsModel, TraceId): a later
-- clustering run of the same trace replaces its row; reads still GROUP BY TraceId
-- because unmerged parts and a moved OccurredAt partition keep older rows.
-- Vectors from different models are never compared, so the model leads the trace.
--
-- No vector similarity index: every read is one tenant and one model, which the
-- sorting key already narrows to that project's own granules, and an approximate
-- index across tenants would need post-filtering. Small granules because a row is
-- about 1.5 KiB.
--
-- Retention: category "traces", anchored on the trace's OccurredAt, so a row
-- expires with its trace; retroactive changes rewrite _retention_days like
-- trace_summaries. Not metered as customer storage (no _size_bytes).
-- New table only: no mutation and no rewrite at deploy.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_embeddings
(
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    EmbeddingsModel LowCardinality(String) CODEC(ZSTD(1)),
    Embedding Array(Int8) CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, EmbeddingsModel, TraceId)
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 1024${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: the rollback is a DROP TABLE, an operator step by house rule.
-- Clustering refills the table on its next runs.
--
-- To roll back, uncomment and run manually.
--
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_embeddings;
