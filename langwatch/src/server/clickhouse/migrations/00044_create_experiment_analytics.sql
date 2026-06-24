-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- experiment_analytics — ADR-034 Phase 7 slim per-experiment-run analytics
-- table.
--
-- A FOLD projection writes one row per experiment run (latest version wins)
-- into this `ReplacingMergeTree(UpdatedAt)`. Genuinely SLIM — not
-- "experiment_runs minus targets blob". Drops the heavy `Targets` JSON blob
-- and the per-row counters that aren't useful as analytical group-by keys
-- (`TotalScoreSum`, `PassedCount`, etc. — slim carries the DERIVED `AvgScoreBps`
-- / `PassRateBps` instead). Hoists the dimensions onto typed columns at the
-- root (RunId, ExperimentId, WorkflowVersionId, CompletionMode), and
-- HEURISTICALLY trims a small Attributes map at fold time.
--
-- The experiment-run fold (`experimentRunState.foldProjection.ts`) reads +
-- folds the same events for the legacy `experiment_runs` table. Slim's fold
-- runs alongside and reuses the same per-event semantics for the SHARED
-- fields, so the VALUES it does carry match `experiment_runs` to the cent.
-- A parity test enforces this against drift.
--
-- Engine / partition / order / retention column mirror experiment_runs:
--   * `ReplacingMergeTree(UpdatedAt)` — re-folds replay-safely dedup to the
--     latest version per (TenantId, RunId).
--   * `PARTITION BY toYearWeek(OccurredAt)` matches the time-anchored
--     partition cadence trace_analytics / evaluation_analytics use.
--   * `ORDER BY (TenantId, OccurredAt, RunId)` — TIME-LEADING (unlike
--     experiment_runs' `(TenantId, RunId, ExperimentId)`).
--   * `_retention_days` UInt16 DEFAULT 308 (00032's contract).
--
-- Bloom indexes on `mapKeys(Attributes)` + `mapValues(Attributes)` mirror
-- trace_analytics + evaluation_analytics so analytics filters on a metadata
-- key / value get index pruning.
--
-- Phase 7 is WRITE-SIDE ONLY: there is no analytics registry metric or UI
-- consumer for experiments today. Data accumulates silently; future work
-- (registry + UI) will consume it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_analytics
(
    -- Keys: same shape as experiment_runs' so a row is addressable identically.
    -- ProjectionId is omitted (slim has no need to be addressed by a
    -- deterministic non-(TenantId, RunId) key — the version dedup runs on the
    -- primary key).
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    -- Schema-snapshot identifier (calendar date string).
    Version LowCardinality(String) CODEC(ZSTD(1)),

    -- Run's occurred-at — the partition column and the lead sort key. Stamped
    -- from the latest event's `event.occurredAt`.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Hoisted dimensions (typed columns at the root, NOT keys in the
    -- Attributes map). All come straight from the experiment events:
    --   ExperimentId / WorkflowVersionId — set on STARTED.
    --   CompletionMode — derived on COMPLETED.
    ExperimentId String CODEC(ZSTD(1)),
    WorkflowVersionId Nullable(String) CODEC(ZSTD(1)),
    CompletionMode LowCardinality(String),

    -- Metric scalars (the slim DERIVED columns; the underlying raw counters
    -- live on experiment_runs for drawer reads).
    Total UInt32,
    Progress UInt32,
    CompletedCount UInt32,
    FailedCount UInt32,
    TotalCost Nullable(Float64) CODEC(ZSTD(1)),
    TotalDurationMs Nullable(Int64) CODEC(Delta(8), ZSTD(1)),
    AvgScoreBps Nullable(UInt32) CODEC(ZSTD(1)),
    PassRateBps Nullable(UInt32) CODEC(ZSTD(1)),

    -- Trimmed attributes map.
    Attributes Map(String, String) CODEC(ZSTD(1)),

    -- Bloom indexes on Attributes mirror trace_analytics / evaluation_analytics.
    INDEX idx_exp_analytics_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_exp_analytics_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_exp_analytics_tenant_run (TenantId, RunId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_exp_analytics_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_exp_analytics_completion_mode CompletionMode TYPE set(4) GRANULARITY 1,

    -- Per-row retention (matches 00032).
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, OccurredAt, RunId)
TTL toDateTime(OccurredAt) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_analytics;
-- +goose StatementEnd

-- +goose ENVSUB OFF
