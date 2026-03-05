-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Migration: Timestamp consistency across projection tables (zero-downtime)
-- ============================================================================
-- Phase 1 of a multi-step migration:
--   Part A: ALTER existing tables — add new columns alongside old ones
--   Part B: CREATE _v2 tables — target schema with new ENGINE/PARTITION BY
--
-- After this migration runs:
--   1. Application writes to both old + new columns (dual-write)
--   2. Application reads with COALESCE fallback (new col → old col)
--   3. Operator runs INSERT INTO _v2 SELECT FROM old tables
--   4. Operator runs EXCHANGE TABLES to atomically swap
--   5. Cleanup migration (00031) drops _v2 tables and old columns
-- ============================================================================

-- --------------------------------------------------------------------------
-- Part A: ALTER existing tables (additive, safe, zero-downtime)
-- --------------------------------------------------------------------------

-- trace_summaries: add UpdatedAt (alias for LastUpdatedAt) and OccurredAt
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS UpdatedAt DateTime64(3) DEFAULT LastUpdatedAt CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS OccurredAt DateTime64(3) DEFAULT CreatedAt CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- evaluation_runs: add CreatedAt and ArchivedAt
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- simulation_runs: add ArchivedAt (alias for DeletedAt) and LastSnapshotOccurredAt
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3)) DEFAULT DeletedAt CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS LastSnapshotOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- experiment_runs: no new columns needed (only partition key changes in _v2)

-- --------------------------------------------------------------------------
-- Part B: CREATE _v2 tables with target schema
-- --------------------------------------------------------------------------

-- trace_summaries_v2: UpdatedAt as RMT version, OccurredAt as partition key
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries_v2
(
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    Version LowCardinality(String) CODEC(ZSTD(1)),
    Attributes Map(String, String) CODEC(ZSTD(1)),

    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Input/output
    ComputedIOSchemaVersion LowCardinality(String) CODEC(ZSTD(1)),
    ComputedInput Nullable(String) CODEC(ZSTD(3)),
    ComputedOutput Nullable(String) CODEC(ZSTD(3)),

    TimeToFirstTokenMs Nullable(UInt32) CODEC(Delta(4), ZSTD(1)),
    TimeToLastTokenMs Nullable(UInt32) CODEC(Delta(4), ZSTD(1)),
    TotalDurationMs Int64 CODEC(Delta(8), ZSTD(1)),
    TokensPerSecond Nullable(UInt32) CODEC(ZSTD(1)),
    SpanCount UInt32 CODEC(ZSTD(1)),
    ContainsErrorStatus Bool,
    ContainsOKStatus Bool,
    ErrorMessage Nullable(String) CODEC(ZSTD(1)),
    Models Array(String) CODEC(ZSTD(1)),

    -- Cost metrics
    TotalCost Nullable(Float64) CODEC(ZSTD(1)),
    TokensEstimated Bool,
    TotalPromptTokenCount Nullable(UInt32) CODEC(ZSTD(1)),
    TotalCompletionTokenCount Nullable(UInt32) CODEC(ZSTD(1)),

    -- Output tracking
    OutputFromRootSpan Bool DEFAULT 0,
    OutputSpanEndTimeMs UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
    BlockedByGuardrail Bool DEFAULT 0,

    -- Trace intelligence
    SatisfactionScore Nullable(Float64) CODEC(ZSTD(1)),
    TopicId Nullable(String) CODEC(ZSTD(1)),
    SubTopicId Nullable(String) CODEC(ZSTD(1)),
    HasAnnotation Nullable(Bool),

    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_total_duration TotalDurationMs TYPE minmax GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1,
    INDEX idx_models Models TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_topic_id TopicId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_has_error ContainsErrorStatus TYPE set(2) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, TraceId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- evaluation_runs_v2: add CreatedAt/ArchivedAt, partition by ScheduledAt
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs_v2
(
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    EvaluationId String CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    EvaluatorId String CODEC(ZSTD(1)),
    EvaluatorType LowCardinality(String),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    TraceId Nullable(String) CODEC(ZSTD(1)),
    IsGuardrail UInt8 DEFAULT 0,

    Status LowCardinality(String),

    Score Nullable(Float64),
    Passed Nullable(UInt8),
    Label Nullable(String) CODEC(ZSTD(1)),
    Details Nullable(String) CODEC(ZSTD(3)),
    Error Nullable(String) CODEC(ZSTD(3)),

    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    ArchivedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    ScheduledAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    CompletedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    CostId Nullable(String) CODEC(ZSTD(1)),
    LastProcessedEventId String CODEC(ZSTD(1)),

    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 4,
    INDEX idx_scheduled_at ScheduledAt TYPE minmax GRANULARITY 1,
    INDEX idx_started_at StartedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(ScheduledAt)
ORDER BY (TenantId, EvaluationId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- experiment_runs_v2: partition by StartedAt instead of CreatedAt
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs_v2
(
    ProjectionId String CODEC(ZSTD(1)),
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
    StartedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    StoppedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    LastProcessedEventId String CODEC(ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_started_at StartedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(StartedAt)
ORDER BY (TenantId, RunId, ExperimentId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- simulation_runs_v2: ArchivedAt replaces DeletedAt, add LastSnapshotOccurredAt, partition by StartedAt
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_v2
(
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    ScenarioRunId String CODEC(ZSTD(1)),
    ScenarioId String CODEC(ZSTD(1)),
    BatchRunId String CODEC(ZSTD(1)),
    ScenarioSetId String CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    Status String CODEC(ZSTD(1)),
    Name Nullable(String) CODEC(ZSTD(1)),
    Description Nullable(String) CODEC(ZSTD(1)),
    `Messages.Id`       Array(String) CODEC(ZSTD(1)),
    `Messages.Role`     Array(String) CODEC(ZSTD(1)),
    `Messages.Content`  Array(String) CODEC(ZSTD(3)),
    `Messages.TraceId`  Array(String) CODEC(ZSTD(1)),
    `Messages.Rest`     Array(String) CODEC(ZSTD(3)),
    TraceIds Array(String) CODEC(ZSTD(1)),

    Verdict Nullable(String) CODEC(ZSTD(1)),
    Reasoning Nullable(String) CODEC(ZSTD(3)),
    MetCriteria Array(String) CODEC(ZSTD(1)),
    UnmetCriteria Array(String) CODEC(ZSTD(1)),
    Error Nullable(String) CODEC(ZSTD(3)),

    DurationMs Nullable(UInt64),
    StartedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    ArchivedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    LastSnapshotOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_scenario_id ScenarioId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_batch_run_id BatchRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_scenario_set_id ScenarioSetId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_started_at StartedAt TYPE minmax GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(StartedAt)
ORDER BY (TenantId, ScenarioRunId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- experiment_run_items_v2: partition by OccurredAt instead of CreatedAt
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items_v2
(
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    ExperimentId String CODEC(ZSTD(1)),

    RowIndex UInt32,
    TargetId String CODEC(ZSTD(1)),
    ResultType LowCardinality(String),  -- 'target' or 'evaluator'

    -- Target result fields
    DatasetEntry String CODEC(ZSTD(3)),
    Predicted Nullable(String) CODEC(ZSTD(3)),
    TargetCost Nullable(Float64),
    TargetDurationMs Nullable(UInt32),
    TargetError Nullable(String) CODEC(ZSTD(3)),
    TraceId Nullable(String) CODEC(ZSTD(1)),

    -- Evaluator result fields
    EvaluatorId Nullable(String) CODEC(ZSTD(1)),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    EvaluationStatus LowCardinality(String),
    Score Nullable(Float64),
    Label Nullable(String) CODEC(ZSTD(1)),
    Passed Nullable(UInt8),
    EvaluationDetails Nullable(String) CODEC(ZSTD(3)),
    EvaluationCost Nullable(Float64),
    EvaluationInputs Nullable(String) CODEC(ZSTD(3)),
    EvaluationDurationMs Nullable(UInt32),

    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    OccurredAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_target_id TargetId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_result_type ResultType TYPE set(2) GRANULARITY 4,
    INDEX idx_evaluator_id EvaluatorId TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}OccurredAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, RunId, ProjectionId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- event_log_v2: ReplacingMergeTree with IdempotencyKey in ORDER BY for dedup
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.event_log_v2
(
    TenantId String CODEC(ZSTD(1)),
    IdempotencyKey String CODEC(ZSTD(1)),
    AggregateType LowCardinality(String),
    AggregateId String CODEC(ZSTD(1)),
    EventId String CODEC(ZSTD(1)),
    EventType LowCardinality(String),
    EventVersion LowCardinality(String),
    EventTimestamp UInt64 CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    EventPayload String CODEC(ZSTD(3)),
    ProcessingTraceparent String DEFAULT '' CODEC(ZSTD(1)),
    EventOccurredAt UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),

    INDEX idx_event_id EventId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_event_timestamp EventTimestamp TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_aggregate_event_id (TenantId, AggregateType, AggregateId, EventId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}EventTimestamp)
PARTITION BY (AggregateType, toYearWeek(toDateTime64(EventOccurredAt / 1000, 3)))
ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Revert Part B: drop _v2 tables
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries_v2 SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs_v2 SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs_v2 SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_v2 SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items_v2 SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.event_log_v2 SYNC;
-- +goose StatementEnd

-- Revert Part A: drop added columns
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS UpdatedAt;
-- +goose StatementEnd
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS OccurredAt;
-- +goose StatementEnd
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS CreatedAt;
-- +goose StatementEnd
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS ArchivedAt;
-- +goose StatementEnd
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS ArchivedAt;
-- +goose StatementEnd
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS LastSnapshotOccurredAt;
-- +goose StatementEnd

-- +goose ENVSUB OFF
