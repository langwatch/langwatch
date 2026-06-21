-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- suite_analytics — ADR-034 Phase 7 slim per-suite-run analytics table.
--
-- A FOLD projection writes one row per suite run (latest version wins) into
-- this `ReplacingMergeTree(UpdatedAt)`. Genuinely SLIM — not "suite_runs minus
-- counters". Hoists the dimensions onto typed columns at the root (SuiteRunId,
-- BatchRunId, ScenarioSetId, SuiteId, Status), drops the raw counters
-- (`StartedCount`, `PassedCount`, `GradedCount`) in favour of the DERIVED
-- `PassRateBps` the legacy fold projects, and HEURISTICALLY trims a small
-- Attributes map at fold time (same `analytics-attribute-trim.service.ts`
-- the trace + eval slim use).
--
-- The suite-run fold (`suiteRunState.foldProjection.ts`) reads + folds the
-- same events for the legacy `suite_runs` table. Slim's fold runs alongside
-- and reuses the same per-event semantics for the SHARED fields, so the
-- VALUES it does carry match `suite_runs` to the cent. A parity test
-- enforces this against drift.
--
-- Engine / partition / order / retention column mirror suite_runs:
--   * `ReplacingMergeTree(UpdatedAt)` — re-folds replay-safely dedup to the
--     latest version per (TenantId, SuiteRunId).
--   * `PARTITION BY toYearWeek(OccurredAt)` matches the time-anchored
--     partition cadence trace_analytics / evaluation_analytics use.
--   * `ORDER BY (TenantId, OccurredAt, SuiteRunId)` — TIME-LEADING (unlike
--     suite_runs' `(TenantId, ScenarioSetId, BatchRunId)`).
--   * `_retention_days` UInt16 DEFAULT 308 (00032's contract).
--
-- Bloom indexes on `mapKeys(Attributes)` + `mapValues(Attributes)` mirror
-- trace_analytics + evaluation_analytics.
--
-- Phase 7 is WRITE-SIDE ONLY: there is no analytics registry metric or UI
-- consumer for suites today. Data accumulates silently; future work
-- (registry + UI) will consume it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.suite_analytics
(
    -- Keys: SuiteRunId is the primary slim address. ProjectionId omitted.
    TenantId String CODEC(ZSTD(1)),
    SuiteRunId String CODEC(ZSTD(1)),
    -- Schema-snapshot identifier (calendar date string).
    Version LowCardinality(String) CODEC(ZSTD(1)),

    -- Run's occurred-at — the partition column and the lead sort key. Stamped
    -- from the latest event's `event.occurredAt`.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Hoisted dimensions (typed columns at the root, NOT keys in the
    -- Attributes map). All come straight from the suite events:
    --   BatchRunId / ScenarioSetId / SuiteId — set on STARTED.
    --   Status — derived in the fold (PENDING → IN_PROGRESS → SUCCESS/FAILURE).
    BatchRunId String CODEC(ZSTD(1)),
    ScenarioSetId String CODEC(ZSTD(1)),
    SuiteId String CODEC(ZSTD(1)),
    Status LowCardinality(String),

    -- Metric scalars (the slim DERIVED columns).
    Total UInt32,
    Progress UInt32,
    CompletedCount UInt32,
    FailedCount UInt32,
    PassRateBps Nullable(UInt32) CODEC(ZSTD(1)),

    -- Trimmed attributes map.
    Attributes Map(String, String) CODEC(ZSTD(1)),

    -- Bloom indexes on Attributes mirror trace_analytics / evaluation_analytics.
    INDEX idx_suite_analytics_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_suite_analytics_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_suite_analytics_tenant_suite_run (TenantId, SuiteRunId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_suite_analytics_batch_run_id BatchRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_suite_analytics_scenario_set_id ScenarioSetId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_suite_analytics_suite_id SuiteId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_suite_analytics_status Status TYPE set(10) GRANULARITY 1,

    -- Per-row retention (matches 00032).
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, OccurredAt, SuiteRunId)
TTL toDateTime(OccurredAt) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.suite_analytics;
-- +goose StatementEnd

-- +goose ENVSUB OFF
