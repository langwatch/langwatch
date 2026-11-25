-- +goose Up
-- +goose ENVSUB ON
--
-- governance_kpis fold projection — per-trace contribution to the
-- per-(TenantId, SourceId, HourBucket) rollup of spend / tokens /
-- event counts for governance-origin events
-- (langwatch.origin.kind = "ingestion_source"). Powers the /governance
-- dashboard KPI strip + the spend_spike anomaly reactor (3e) without
-- scanning recorded_spans / log_records partitions at read time.
--
-- TenantId is the org's hidden internal_governance Project ID (the
-- single TenantId used by the receiver to land governance ingest into
-- the unified store). Per CLAUDE.md, every CH query MUST include
-- TenantId; this fold inherits that contract.
--
-- Engine: ReplacingMergeTree(LastEventOccurredAt) with TraceId in the
-- ORDER BY. Each trace contributes ONE row per (SourceId, HourBucket).
-- Replays of the same trace collapse at merge time
-- (ReplacingMergeTree dedup-by-key keeps the latest version), so the
-- populating reactor (3b-iii) can replay safely without double-counting.
--
-- Reads aggregate via `sum(...)` / `count(...)` over the (SourceId,
-- HourBucket) group with the standard IN-tuple dedup pattern when
-- pre-merge state matters. The pattern matches trace_summaries' own
-- dedup discipline.
--
-- Why not SummingMergeTree: SummingMergeTree sums rows that share the
-- primary key. Reactor replay would double-count. Including TraceId in
-- the key with SummingMergeTree wouldn't help — same trace replayed
-- creates new rows summed independently. Replay-safety needs structural
-- dedup, which is what ReplacingMergeTree provides.
--
-- Why not a fold projection (load-mutate-store): the fold-projection
-- framework partitions work by aggregateId (= traceId in the trace
-- pipeline), so two traces emitting deltas for the same (SourceId,
-- HourBucket) would race on load-mutate-store. The reactor + per-trace
-- key pattern side-steps that race entirely — every trace becomes one
-- independent row.
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
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}LastEventOccurredAt)
PARTITION BY toYYYYMM(HourBucket)
ORDER BY (TenantId, SourceId, HourBucket, TraceId)
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
