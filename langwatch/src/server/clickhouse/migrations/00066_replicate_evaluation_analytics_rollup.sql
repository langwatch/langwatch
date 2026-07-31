-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- evaluation_analytics_rollup: move to the Replicated engine.
--
-- Same defect and same remedy as trace_analytics_rollup (00065): a plain
-- AggregatingMergeTree inside a Replicated database replicates its DDL but
-- not its data, so on a multi-replica cluster the app-side map projection
-- (evaluationAnalyticsRollup.mapProjection.ts) marooned each increment on
-- the replica that received the insert, and reads returned whichever
-- replica's fraction they hit. The engine below substitutes to
-- ReplicatedAggregatingMergeTree on clustered deployments so an insert
-- received by any replica replicates to all nodes.
--
-- Contents, per deployment shape:
--
--   * Single node (CLICKHOUSE_IS_REPLICATED=0): the existing table holds
--     the complete dataset, so the carry-over INSERT below copies it into
--     the replacement verbatim and the swap is a behavioral no-op.
--   * Cluster (CLICKHOUSE_IS_REPLICATED=1): the carry-over predicate is
--     constant-false, so nothing reads the old table and the replacement
--     starts EMPTY. Rows are produced by the TypeScript map projection
--     from terminal evaluation events in event_log (canonical status,
--     pass/fail, score and cost extraction), logic with no SQL
--     equivalent, so the rebuild path is the event-sourcing replay (ops
--     replay, projection `evaluationAnalyticsRollup`) over the
--     replicated event_log, matching the table's
--     replay-rebuilds-truncate-first contract (00040). Operator steps
--     and verification: dev/docs/runbooks/analytics-rollup-replay.md.
--
-- Single-connection correctness, mid-migration insert bounds, and re-run
-- safety (drop-not-truncate scratch, because a crash past the EXCHANGE
-- leaves the OLD plain-engine table under the scratch name) are identical
-- to 00065; see that migration's header.
-- ============================================================================

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup_rebuild
(
    -- Column-for-column the 00040 schema; only the engine changes.
    TenantId String CODEC(ZSTD(1)),
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    EvaluatorType LowCardinality(String),
    Status LowCardinality(String),

    EvalCount SimpleAggregateFunction(sum, UInt64),
    PassCount SimpleAggregateFunction(sum, UInt64),
    FailCount SimpleAggregateFunction(sum, UInt64),
    ErrorCount SimpleAggregateFunction(sum, UInt64),
    SkippedCount SimpleAggregateFunction(sum, UInt64),

    ScoreSum SimpleAggregateFunction(sum, Float64),
    ScoreCount SimpleAggregateFunction(sum, UInt64),

    DurationSum SimpleAggregateFunction(sum, Int64),

    CostSum SimpleAggregateFunction(sum, Float64),
    NonBilledCostSum SimpleAggregateFunction(sum, Float64),

    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, EvaluatorType, Status)
TTL IF(_retention_days > 0, toDateTime(BucketStart) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
-- Single-node carry-over. On a cluster the predicate is constant-false:
-- the plain-engine table's content is per-replica and must not be read.
-- The ENVSUB fallback is 1 (skip the copy): an environment that runs
-- migrations without buildMigrationEnvVars must fail towards an empty,
-- replay-recoverable table, never towards planting one node's private
-- fraction as content.
INSERT INTO ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup_rebuild
    (TenantId, BucketStart, EvaluatorType, Status, EvalCount, PassCount, FailCount,
     ErrorCount, SkippedCount, ScoreSum, ScoreCount, DurationSum, CostSum,
     NonBilledCostSum, _retention_days)
SELECT
    TenantId, BucketStart, EvaluatorType, Status, EvalCount, PassCount, FailCount,
    ErrorCount, SkippedCount, ScoreSum, ScoreCount, DurationSum, CostSum,
    NonBilledCostSum, _retention_days
FROM ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup
WHERE ${CLICKHOUSE_IS_REPLICATED:-1} = 0;
-- +goose StatementEnd

-- +goose StatementBegin
EXCHANGE TABLES ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup AND ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- IRREVERSIBLE: the swap discards the plain-engine table this migration
-- replaces, and moving back to a plain engine on a cluster would resume
-- marooning each insert on one replica. Rollback statements stay
-- commented out and must be applied manually if ever needed.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose ENVSUB OFF
