-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- simulation_run_metrics_rollup — dedupe-safe per-trace rollup of
-- simulation_run_metrics (00080), fed by a materialized view.
--
-- Why not just read the base table: the base table's ReplacingMergeTree dedup
-- is eventual, so every read of it must re-run the argMax-per-trace collapse
-- over every raw row (including retry duplicates). This rollup pre-computes
-- that collapse per (TenantId, ScenarioRunId, TraceId); the per-run
-- aggregation (sum across traces, per-role map sums) still happens at READ
-- time over the rollup.
--
-- Dedupe safety: a materialized view fires per inserted BLOCK, so a retried
-- map-projection append landing in a SEPARATE insert would double-count any
-- additive state (sumState). argMaxState is used instead: a retry re-inserts
-- a row with the SAME OccurredAt (stamped from event.occurredAt by the map
-- projection) and identical values, so the per-block argMaxState and the
-- cross-block state merge both resolve to that one value deterministically.
-- Exactly-once therefore does not depend on parts having merged: the read
-- path (argMaxMerge per trace, GROUP BY TraceId) collapses unmerged partial
-- states the same way.
--
-- PartitionMonth is a plain column carrying toYYYYMM(max(OccurredAt)) because
-- a partition expression cannot be derived from an AggregateFunction state.
-- It is constant per trace (one metrics_computed event per trace, one
-- OccurredAt), so which value a merge keeps is irrelevant; even a
-- hypothetical cross-partition duplicate is still collapsed at read time by
-- argMaxMerge.
--
-- No backfill: the base table is new in 00080 (same feature branch), so
-- there is no pre-existing data the view would miss.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup
(
    -- Same dedupe key as the base table.
    TenantId String CODEC(ZSTD(1)),
    ScenarioRunId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),

    -- Latest-version states; version column is the base table's OccurredAt.
    TotalCost AggregateFunction(argMax, Float64, DateTime64(3)),
    RoleCosts AggregateFunction(argMax, Map(String, Float64), DateTime64(3)),
    RoleLatencies AggregateFunction(argMax, Map(String, Float64), DateTime64(3)),
    OccurredAt AggregateFunction(max, DateTime64(3)),

    -- Plain partition anchor (toYYYYMM of the trace's OccurredAt); see the
    -- header for why this is not derived from the state column.
    PartitionMonth UInt32
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
PARTITION BY PartitionMonth
ORDER BY (TenantId, ScenarioRunId, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
-- NOTE: the source column is table-qualified everywhere because the
-- maxState(OccurredAt) alias below would otherwise shadow it, and argMax
-- rejects an AggregateFunction state as its version argument
-- (ILLEGAL_TYPE_OF_ARGUMENT).
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup_mv
TO ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup
AS
SELECT
    TenantId,
    ScenarioRunId,
    TraceId,
    argMaxState(TotalCost, simulation_run_metrics.OccurredAt) AS TotalCost,
    argMaxState(RoleCosts, simulation_run_metrics.OccurredAt) AS RoleCosts,
    argMaxState(RoleLatencies, simulation_run_metrics.OccurredAt) AS RoleLatencies,
    maxState(simulation_run_metrics.OccurredAt) AS OccurredAt,
    toYYYYMM(max(simulation_run_metrics.OccurredAt)) AS PartitionMonth
FROM ${CLICKHOUSE_DATABASE}.simulation_run_metrics
GROUP BY TenantId, ScenarioRunId, TraceId;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup;
-- +goose StatementEnd

-- +goose ENVSUB OFF
