-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- simulation_analytics — ADR-034 Phase 7 slim per-simulation-run analytics
-- table.
--
-- A FOLD projection writes one row per simulation run (latest version wins)
-- into this `ReplacingMergeTree(UpdatedAt)`. Genuinely SLIM — not
-- "simulation_runs minus messages". Drops the heavy free-text fields
-- (`Messages`, `TraceIds`, `Reasoning`, `Error`, `MetCriteria`,
-- `UnmetCriteria`, `Metadata`, `Name`, `Description`, `TraceMetrics`,
-- `RoleCosts`, `RoleLatencies`) entirely, hoists the dimensions onto typed
-- columns at the root (ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
-- Status, Verdict), and HEURISTICALLY trims a small Attributes map at fold
-- time (same `analytics-attribute-trim.service.ts` the trace + eval slim use).
--
-- The simulation-run fold (`simulationRunState.foldProjection.ts`) reads +
-- folds the same events for the legacy `simulation_runs` table. Slim's fold
-- runs alongside and reuses the same per-event semantics for the SHARED
-- fields, so the VALUES it does carry match `simulation_runs` to the cent.
-- A parity test enforces this against drift.
--
-- Engine / partition / order / retention column mirror simulation_runs:
--   * `ReplacingMergeTree(UpdatedAt)` — re-folds replay-safely dedup to the
--     latest version per (TenantId, ScenarioRunId) — same LWW column as
--     simulation_runs. The Version column on the table is the schema-snapshot
--     identifier (calendar date string).
--   * `PARTITION BY toYearWeek(OccurredAt)` matches the time-anchored
--     partition cadence trace_analytics / evaluation_analytics use; the row's
--     OccurredAt is the latest event timestamp.
--   * `ORDER BY (TenantId, OccurredAt, ScenarioRunId)` — TIME-LEADING (unlike
--     simulation_runs' `(TenantId, ScenarioRunId)` which is point-lookup
--     sorted). Analytics scans are time-bounded, not per-run, so the sort
--     order is reorganised around `OccurredAt` to make range scans monotonic
--     over the part.
--   * `_retention_days` is the same UInt16 DEFAULT 308 as 00032 stamps on
--     every retention-managed table. Inline TTL on this CREATE drops rows
--     `_retention_days` days after their `OccurredAt`.
--
-- Bloom indexes on `mapKeys(Attributes)` + `mapValues(Attributes)` mirror
-- trace_analytics + evaluation_analytics so analytics filters on a metadata
-- key / value get index pruning. GRANULARITY 1 = check the bloom filter at
-- the finest level — small payload, fast skip on misses. The Attributes map
-- itself is bounded by `trimAttributesForAnalytics`.
--
-- Phase 7 is WRITE-SIDE ONLY: there is no analytics registry metric or UI
-- consumer for scenarios today. Data accumulates silently; future work
-- (registry + UI) will consume it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_analytics
(
    -- Keys: same shape as simulation_runs' so a row is addressable identically.
    -- ProjectionId is omitted (slim has no need to be addressed by a
    -- deterministic non-(TenantId, ScenarioRunId) key — the version dedup runs
    -- on the primary key).
    TenantId String CODEC(ZSTD(1)),
    ScenarioRunId String CODEC(ZSTD(1)),
    -- Schema-snapshot identifier (calendar date string). NOT the
    -- ReplacingMergeTree LWW key — CH rejects LowCardinality(String) for that
    -- (BAD_TYPE_OF_FIELD). Dedup engine collapses on UpdatedAt instead.
    Version LowCardinality(String) CODEC(ZSTD(1)),

    -- Scenario-run's occurred-at — the partition column and the lead sort key.
    -- Stamped from the latest event's `event.occurredAt`. For terminal events
    -- (finished/deleted) this is when the simulation ended; for in-progress
    -- rows (rare; the slim store skips empties) it's the latest stage
    -- transition.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Defensible bookkeeping. Same shape as simulation_runs'.
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Hoisted dimensions (typed columns at the root, NOT keys in the
    -- Attributes map). All come straight from the simulation events
    -- themselves:
    --   ScenarioId / BatchRunId / ScenarioSetId — set on queued/started.
    --   Status / Verdict — set on finished (the latest-wins terminal state).
    ScenarioId String CODEC(ZSTD(1)),
    BatchRunId String CODEC(ZSTD(1)),
    ScenarioSetId String CODEC(ZSTD(1)),
    Status LowCardinality(String),
    Verdict LowCardinality(String),

    -- Metric scalars. DurationMs comes off the finished event's `durationMs`;
    -- TotalCost flows off the metrics_computed event's aggregated `totalCost`.
    DurationMs Int64 CODEC(Delta(8), ZSTD(1)),
    TotalCost Nullable(Float64) CODEC(ZSTD(1)),

    -- Trimmed attributes map. Written through `trimAttributesForAnalytics`
    -- (the shared trim service from the trace + eval slim).
    Attributes Map(String, String) CODEC(ZSTD(1)),

    -- Bloom indexes on Attributes mirror trace_analytics / evaluation_analytics.
    INDEX idx_sim_analytics_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_sim_analytics_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    -- Mirror simulation_runs' tenant+run index so per-run point-lookups still
    -- get bloom pruning despite the time-leading primary sort.
    INDEX idx_sim_analytics_tenant_run (TenantId, ScenarioRunId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_sim_analytics_scenario_id ScenarioId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_sim_analytics_batch_run_id BatchRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_sim_analytics_scenario_set_id ScenarioSetId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_sim_analytics_status Status TYPE set(10) GRANULARITY 1,

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
-- toYearWeek(OccurredAt) matches trace_analytics' / evaluation_analytics'
-- partition expression. DateTime64(3) is accepted directly by toYearWeek, so
-- no toDate(...) wrap is needed.
PARTITION BY toYearWeek(OccurredAt)
-- Time-leading sort key — the whole point of the slim table. simulation_runs'
-- (TenantId, ScenarioRunId) is wrong for analytics range scans; (TenantId,
-- OccurredAt, ScenarioRunId) keeps tenant locality but reorganises around time
-- so analytics queries pull contiguous granules instead of one row per random
-- part.
ORDER BY (TenantId, OccurredAt, ScenarioRunId)
-- Inline retention TTL: drop a row `_retention_days` days after its
-- OccurredAt. Mirrors trace_analytics + evaluation_analytics. OccurredAt is
-- DateTime64(3); CH rejects DateTime64 directly in TTL arithmetic, so wrap in
-- toDateTime first.
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_analytics;
-- +goose StatementEnd

-- +goose ENVSUB OFF
