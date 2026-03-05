-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Migration: Counter renames for experiment_runs
-- ============================================================================
-- The event-sourcing aggregate ID is now a composite key (experimentId:runId)
-- which ensures ExperimentId is always populated from event #1, fixing the
-- split-row bug where ExperimentId mutated from "" to the real value.
--
-- RunId and ExperimentId columns still store raw values — the composite key
-- lives only in the event-sourcing layer (Id / projection ID).
--
-- ORDER BY unchanged: (TenantId, RunId, ExperimentId) — this is correct
-- because ExperimentId is now always populated.
--
-- Renames:
--   PassFailCount → GradedCount
--   AvgScore (Float64) → AvgScoreBps (UInt32, basis points 0–10000)
--   PassRate (Float64) → PassRateBps (UInt32, basis points 0–10000)
--
-- Data is re-derivable from the event log — safe to drop/recreate
-- (same approach as migration 00021).
-- ============================================================================

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs SYNC;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    ExperimentId String CODEC(ZSTD(1)),
    WorkflowVersionId Nullable(String) CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    Total UInt32,
    Progress UInt32,
    CompletedCount UInt32,
    FailedCount UInt32,
    TotalCost Nullable(Float64),
    TotalDurationMs Nullable(UInt64),
    AvgScoreBps Nullable(UInt32),
    PassRateBps Nullable(UInt32),
    Targets String CODEC(ZSTD(3)),

    TotalScoreSum Float64 DEFAULT 0,
    ScoreCount UInt32 DEFAULT 0,
    PassedCount UInt32 DEFAULT 0,
    GradedCount UInt32 DEFAULT 0,

    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    StoppedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    LastProcessedEventId String CODEC(ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, RunId, ExperimentId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Revert by dropping (data is re-derivable from event log)
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs SYNC;
-- +goose StatementEnd

-- +goose ENVSUB OFF
