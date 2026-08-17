-- +goose Up
-- +goose ENVSUB ON
--
-- Fix: governance_kpis uses ReplacingMergeTree(LastEventOccurredAt) but
-- LastEventOccurredAt moves backward (fold takes min(occurredAt,
-- span.startTimeUnixMs)), so background merges keep the stale row and
-- discard the correct cumulative one.
--
-- ClickHouse cannot ALTER the version column of a ReplacingMergeTree.
-- Strategy: CREATE v2 with CreatedAt → INSERT SELECT → RENAME swap →
-- DROP old. RENAME TABLE is atomic; write gap = INSERT duration only.
--
-- CreatedAt is a monotonic wall clock (DEFAULT now64(3)), set by the
-- server at insert time. The writer does not set it explicitly, so
-- later writes always have a higher CreatedAt than earlier ones.
--
-- @see https://github.com/langwatch/langwatch-saas/issues/1089

-- 1. Create the replacement table with CreatedAt as the version column.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis_v2
(
    -- identity (per-trace contribution)
    TenantId String CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),
    HourBucket DateTime CODEC(Delta(4), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),

    -- denormalised dimensions (filtered cheaply at read time)
    SourceType LowCardinality(String),

    -- per-trace contribution (sum at read time across the HourBucket
    -- group to get the rollup; count(DISTINCT TraceId) for trace count)
    SpendUsd Float64 CODEC(ZSTD(1)),
    PromptTokens UInt64 CODEC(Delta(8), ZSTD(1)),
    CompletionTokens UInt64 CODEC(Delta(8), ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_source_type SourceType TYPE set(64) GRANULARITY 4,
    INDEX idx_hour_bucket HourBucket TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_source (TenantId, SourceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}CreatedAt)
PARTITION BY toYYYYMM(HourBucket)
ORDER BY (TenantId, SourceId, HourBucket, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- 2. Copy existing data. CreatedAt carries over from the source (it was
--    already populated by the DEFAULT now64(3) at original insert time).
-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.governance_kpis_v2
SELECT * FROM ${CLICKHOUSE_DATABASE}.governance_kpis;
-- +goose StatementEnd

-- 3. Atomic swap — RENAME TABLE exchanges both names in a single
--    metadata operation. No write gap apart from the INSERT above.
-- +goose StatementBegin
RENAME TABLE
  ${CLICKHOUSE_DATABASE}.governance_kpis TO ${CLICKHOUSE_DATABASE}.governance_kpis_old,
  ${CLICKHOUSE_DATABASE}.governance_kpis_v2 TO ${CLICKHOUSE_DATABASE}.governance_kpis;
-- +goose StatementEnd

-- 4. Drop the old table.
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis_old;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down intentionally not provided. The version column fix is
-- forward-only; rolling back would reintroduce the backward-moving
-- version column bug. The table is derived data (rebuildable from
-- event_log) so a manual rebuild is the rollback path if needed.
