-- +goose Up
-- +goose ENVSUB ON
--
-- governance_kpis fold projection — per-(TenantId, SourceId, HourBucket)
-- rollup of spend / tokens / event counts for governance-origin events
-- (langwatch.origin.kind = "ingestion_source"). Powers the /governance
-- dashboard KPI strip + the spend_spike anomaly reactor without
-- scanning recorded_spans / log_records partitions at read time.
--
-- TenantId is the org's hidden internal_governance Project ID (the
-- single TenantId used by the receiver to land governance ingest into
-- the unified store). Per CLAUDE.md, every CH query MUST include
-- TenantId; this fold inherits that contract.
--
-- Engine: SummingMergeTree — the populating reactor (3b-iii) inserts a
-- delta row per event (e.g. {SpendUsd=0.42, EventCount=1, ...}) and
-- CH merges them additively on background merges. Reads aggregate via
-- `sum(...)` for correctness regardless of merge state. This avoids the
-- cross-aggregate fold-projection race where two spans for the same
-- (SourceId, HourBucket) but different traceIds would load-modify-store
-- the same key concurrently.
--
-- The same delta-insert + SummingMergeTree pattern is used elsewhere
-- in LangWatch for additive rollups (see PR #3168 for reference).
--
-- Partition: toYYYYMM(HourBucket) — coarser than trace_summaries'
-- toYearWeek because rollup data has lower cardinality and benefits
-- from larger partition sizes for cross-month queries.
--
-- Source-of-truth invariant: this fold is DERIVED data only. The
-- append-only event_log + recorded_spans + log_records remain the
-- source of truth. The fold can be dropped + rebuilt at any time
-- from event_log without data loss.
--
-- Spec: specs/ai-gateway/governance/folds.feature

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis
(
    -- identity
    TenantId String CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),
    HourBucket DateTime CODEC(Delta(4), ZSTD(1)),

    -- denormalised dimensions (filtered cheaply at read time)
    SourceType LowCardinality(String),

    -- aggregates (all additive across events in the hour bucket)
    EventCount UInt64 CODEC(Delta(8), ZSTD(1)),
    SpendUsd Float64 CODEC(ZSTD(1)),
    PromptTokens UInt64 CODEC(Delta(8), ZSTD(1)),
    CompletionTokens UInt64 CODEC(Delta(8), ZSTD(1)),

    -- timestamps (informational — LastEventOccurredAt is the meaningful
    -- one for staleness checks; CreatedAt/UpdatedAt are insert times,
    -- not aggregated)
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_source_type SourceType TYPE set(64) GRANULARITY 4,
    INDEX idx_hour_bucket HourBucket TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_source (TenantId, SourceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = SummingMergeTree((EventCount, SpendUsd, PromptTokens, CompletionTokens))
PARTITION BY toYYYYMM(HourBucket)
ORDER BY (TenantId, SourceId, HourBucket)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- Down migration intentionally not provided — dropping governance_kpis
-- is supported (the fold is derived data, rebuildable from event_log)
-- but we don't ship it as an automated down because doing so by
-- accident would temporarily blank the /governance dashboard until the
-- fold is rebuilt. To roll back: uncomment the DROP statement below
-- and run manually after coordinating with operators.
--
-- -- +goose StatementBegin
-- -- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis;
-- -- +goose StatementEnd
