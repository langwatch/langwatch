-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- simulation_run_metrics — per-trace cost/latency metrics for simulation runs.
--
-- Written by the simulationRunMetrics map projection
-- (simulation-processing/projections/simulationRunMetrics.mapProjection.ts):
-- one row per `lw.simulation_run.metrics_computed` event, keyed by
-- (TenantId, ScenarioRunId, TraceId).
--
-- ReplacingMergeTree gives an exactly-once effect under map-projection
-- retries: a re-delivery of the same metrics event re-inserts the same key
-- with the SAME OccurredAt (the map projection stamps it from
-- event.occurredAt, not the insert time) and identical values, so collapsing
-- to the latest version per trace (argMax / FINAL) yields the same row no
-- matter which duplicate wins the version tie.
-- Aggregation (per-run totals, per-role sums) is done at READ time over the
-- dedupe-safe rollup (00081) — this table stays a dumb per-trace fact log.
--
-- No `_retention_days` column / TTL yet: retention for this table is a
-- deliberate follow-up (it is absent from RETENTION_TABLE_CATEGORY_MAP and
-- TABLE_TTL_CONFIG, like gateway_spend's exemption shape). Reads MUST be
-- replacement-aware (argMax or FINAL): RMT dedup is eventual.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_run_metrics
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter
    -- on TenantId first.
    TenantId String CODEC(ZSTD(1)),
    ScenarioRunId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),

    -- Total trace cost (USD) and per-role cost/latency breakdowns, as
    -- computed by ComputeRunMetricsCommand and carried on the event (ECST).
    TotalCost Float64,
    RoleCosts Map(String, Float64),
    RoleLatencies Map(String, Float64),

    -- Event time; also the ReplacingMergeTree version column.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Provenance: the metrics_computed event id this row was mapped from.
    EventId String CODEC(ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}OccurredAt)
PARTITION BY toYYYYMM(OccurredAt)
ORDER BY (TenantId, ScenarioRunId, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_run_metrics;
-- +goose StatementEnd

-- +goose ENVSUB OFF
