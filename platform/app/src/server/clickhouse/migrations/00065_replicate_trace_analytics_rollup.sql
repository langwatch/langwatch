-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_analytics_rollup: move to the Replicated engine.
--
-- When CLICKHOUSE_CLUSTER is set the database engine is Replicated (00001),
-- which replicates DDL to every node but NOT table data: data only
-- replicates through Replicated*MergeTree table engines. This table was
-- created with a plain AggregatingMergeTree, so on a multi-replica cluster
-- every replica accumulates a PRIVATE copy: the app-side map projection
-- (traceAnalyticsRollup.mapProjection.ts) inserts through the load
-- balancer, each increment lands on exactly one replica and never
-- replicates, and reads return whichever replica's fraction they happen to
-- hit. The engine below substitutes to ReplicatedAggregatingMergeTree on
-- clustered deployments (the same mechanism every ReplacingMergeTree table
-- uses via CLICKHOUSE_ENGINE_REPLACING_PREFIX), so an insert received by
-- any replica replicates to all nodes.
--
-- Contents, per deployment shape:
--
--   * Single node (CLICKHOUSE_IS_REPLICATED=0): the existing table holds
--     the complete dataset, so the carry-over INSERT below copies it into
--     the replacement verbatim and the swap is a behavioral no-op.
--   * Cluster (CLICKHOUSE_IS_REPLICATED=1): the carry-over predicate is
--     constant-false, so nothing reads the old table (each replica's
--     content is a partial private fraction, unusable as a source) and
--     the replacement starts EMPTY. A SQL rebuild is not possible here:
--     rows are produced by the TypeScript map projection (span
--     normalization, canonical model extraction, token-accumulation
--     gates, pricing) from SpanReceivedEvents in event_log, logic that
--     has no SQL equivalent. event_log IS replicated, so the
--     event-sourcing replay (ops replay, projection
--     `traceAnalyticsRollup`) rebuilds the true content through any
--     node, and with this engine the rebuilt rows replicate. The
--     table's contract has always been replay-rebuilds-truncate-first
--     (00038); after this migration the truncation has already
--     happened. Operator steps and verification:
--     dev/docs/runbooks/analytics-rollup-replay.md.
--
-- Single-connection correctness on a cluster: goose runs every statement
-- through one connection. CREATE / EXCHANGE / DROP are DDL and replicate
-- through the database engine; the carry-over INSERT (single-node only)
-- runs where the complete dataset lives.
--
-- Mid-migration inserts: an increment inserted between the carry-over
-- SELECT and the EXCHANGE lands in the outgoing table and is dropped with
-- it. The window is the sub-second gap between two statements, the rollup
-- explicitly tolerates single-increment drift (00038 accepts re-delivery
-- over-count), and a replay rebuild erases the drift entirely. From the
-- EXCHANGE onward inserts land in the replacement table and are kept.
--
-- Re-run safety (the runner may re-apply a partially executed file after
-- a crash): the scratch is DROPPED and recreated rather than truncated
-- and reused. This matters because the migration converts the engine:
-- after a crash between the EXCHANGE and the final drop, the scratch NAME
-- holds the old plain-engine table, and truncating and reusing it would
-- swap the plain engine back in. A re-run after such a crash discards
-- increments accrued since the first EXCHANGE (bounded by the
-- crash-to-rerun gap); the replay rebuild recovers them on a cluster, and
-- on a single node the re-run's carry-over re-copies the live table, so
-- only the crash-window increments are lost.
-- ============================================================================

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE ${CLICKHOUSE_DATABASE}.trace_analytics_rollup_rebuild
(
    -- Column-for-column the 00038 schema; only the engine changes.
    TenantId String CODEC(ZSTD(1)),
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    Model LowCardinality(String),
    SpanType LowCardinality(String),

    SpanCount SimpleAggregateFunction(sum, UInt64),
    TraceCount SimpleAggregateFunction(sum, UInt64),
    ErrorCount SimpleAggregateFunction(sum, UInt64),

    CostSum SimpleAggregateFunction(sum, Float64),
    NonBilledCostSum SimpleAggregateFunction(sum, Float64),

    DurationSum SimpleAggregateFunction(sum, Int64),

    PromptTokensSum SimpleAggregateFunction(sum, UInt64),
    CompletionTokensSum SimpleAggregateFunction(sum, UInt64),
    CacheReadTokensSum SimpleAggregateFunction(sum, UInt64),
    CacheWriteTokensSum SimpleAggregateFunction(sum, UInt64),
    ReasoningTokensSum SimpleAggregateFunction(sum, UInt64),

    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, Model, SpanType)
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
INSERT INTO ${CLICKHOUSE_DATABASE}.trace_analytics_rollup_rebuild
    (TenantId, BucketStart, Model, SpanType, SpanCount, TraceCount, ErrorCount,
     CostSum, NonBilledCostSum, DurationSum, PromptTokensSum, CompletionTokensSum,
     CacheReadTokensSum, CacheWriteTokensSum, ReasoningTokensSum, _retention_days)
SELECT
    TenantId, BucketStart, Model, SpanType, SpanCount, TraceCount, ErrorCount,
    CostSum, NonBilledCostSum, DurationSum, PromptTokensSum, CompletionTokensSum,
    CacheReadTokensSum, CacheWriteTokensSum, ReasoningTokensSum, _retention_days
FROM ${CLICKHOUSE_DATABASE}.trace_analytics_rollup
WHERE ${CLICKHOUSE_IS_REPLICATED:-1} = 0;
-- +goose StatementEnd

-- +goose StatementBegin
EXCHANGE TABLES ${CLICKHOUSE_DATABASE}.trace_analytics_rollup AND ${CLICKHOUSE_DATABASE}.trace_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- IRREVERSIBLE: the swap discards the plain-engine table this migration
-- replaces, and moving back to a plain engine on a cluster would resume
-- marooning each insert on one replica. Rollback statements stay
-- commented out and must be applied manually if ever needed.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_rollup_rebuild;
-- +goose StatementEnd

-- +goose ENVSUB OFF
