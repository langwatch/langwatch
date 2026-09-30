-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- instant_eval_runs, one row per Instant Eval run: its definition and its
-- counters, which is what a caller polls.
--
-- Modelled on experiment_runs (00002): a ReplacingMergeTree keyed by the
-- tenant and the run, where every write is a whole row and reads collapse to
-- the latest version. Two writers share the row and the line between them is
-- the design (ADR-137 §5):
--
--  - the service writes the definition once, when it accepts the run, so a
--    caller can read the run back the instant they are handed its id;
--  - the state projection writes the counters and its own checkpoint
--    (OccurredAt, AcceptedAt, LastEventId, ProjectionVersion), carrying the
--    definition forward unchanged, so a replay rebuilds what the run found
--    without rewriting what it was asked.
--
-- The version column is WrittenAt, the writer's own clock at the insert, and
-- not UpdatedAt. UpdatedAt is business time, the latest event the projection
-- folded, and the run's first event was recorded before the service's row was
-- inserted, so a projection write versioned by it would lose the merge to the
-- definition row and the counters would never show. A write clock is monotone
-- across both writers, which is the one property the merge needs.
--
-- Reads MUST be replacement-aware (argMax or the IN-tuple max(WrittenAt)
-- pattern): the dedup is eventual, not immediate.
--
-- Not time-partitioned, on purpose. The table holds one row per run, a run is
-- polled by its key every few seconds while it runs, and a project's runs are
-- listed with no time bound. A time partition would make every one of those
-- reads a scan across every partition and a flagged cold scan, for a table
-- whose whole size is a few thousand rows per tenant.
--
-- Retention: `_retention_days` defaults to 0, the indefinite sentinel, for the
-- same reason instant_eval_judgments (00097) keeps it: the row holds counters
-- and the caller's own statement, and deleting a run on a timer would orphan
-- the judgements it explains. The table joins INDEFINITE_DEFAULT_RETENTION_TABLES,
-- and the TTL clause below is character-for-character what
-- `buildRetentionTTLExpression` emits for its TABLE_TTL_CONFIG entry.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL to every node itself.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.instant_eval_runs
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter on
    -- TenantId first.
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),

    -- The definition, written once by the service that accepted the run.
    -- Name is what the caller called it; Sql is the statement exactly as
    -- submitted, never rewritten; Parameters, Questions and Plan are JSON
    -- documents kept as strings so they round-trip as the caller sent them.
    Name Nullable(String) CODEC(ZSTD(1)),
    Sql String CODEC(ZSTD(3)),
    Parameters String DEFAULT '{}' CODEC(ZSTD(3)),
    Questions String DEFAULT '[]' CODEC(ZSTD(3)),
    Plan String DEFAULT '[]' CODEC(ZSTD(3)),
    RowLimit UInt32,

    -- The counters, folded from the run's events by the state projection.
    Status LowCardinality(String) CODEC(ZSTD(1)),
    Total Nullable(UInt32),
    Progress UInt32 DEFAULT 0,
    -- Boolean matches across the run, or null for a run that asked no boolean
    -- question. Per question the number is matches for a boolean question and
    -- judged rows for the others, as a JSON object of question id to count.
    Matched Nullable(UInt32),
    MatchedByQuestion String DEFAULT '{}' CODEC(ZSTD(1)),
    Failed UInt32 DEFAULT 0,
    Skipped UInt32 DEFAULT 0,
    Tokens UInt64 DEFAULT 0,
    CostUsd Float64 DEFAULT 0,
    PriceUsd Float64 DEFAULT 0,
    -- The code of the failure that ended the run, when one did. A code, never
    -- prose: the words a customer reads come from the presentation registry.
    Error Nullable(String) CODEC(ZSTD(1)),

    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- The business time of the latest write: the run's acceptance, then the
    -- latest event the projection folded.
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    -- The projection's checkpoint over the run's own event stream: the
    -- business time of the latest applied event, the event log's acceptance
    -- time, the event id that breaks a tie inside one millisecond, and the
    -- projection version that wrote the counters. Empty until the first event
    -- is folded, because the row is created by the service that accepted the
    -- run rather than by the projection.
    OccurredAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    AcceptedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    LastEventId String DEFAULT '' CODEC(ZSTD(1)),
    ProjectionVersion String DEFAULT '' CODEC(ZSTD(1)),

    -- The ReplacingMergeTree version column: the writer's clock at the insert.
    WrittenAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}WrittenAt)
ORDER BY (TenantId, RunId)
TTL IF(_retention_days > 0, toDateTime(CreatedAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.instant_eval_runs;
-- +goose StatementEnd

-- +goose ENVSUB OFF
