-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- LangWatch ClickHouse Schema — All Tables
-- ============================================================================
-- Consolidated schema for all ClickHouse tables. Creates the 11 tables that
-- make up the LangWatch data model in a single migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. event_log — Event-sourcing append log
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.event_log
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

-- ---------------------------------------------------------------------------
-- 2. stored_spans — OpenTelemetry span storage
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_spans
(
    -- identity
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),

    -- trace/span ids
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId Nullable(String) CODEC(ZSTD(1)),
    ParentTraceId Nullable(String) CODEC(ZSTD(1)),

    -- parent sampling/remote
    ParentIsRemote Nullable(UInt8) CODEC(ZSTD(1)),
    Sampled UInt8 CODEC(ZSTD(1)),

    -- timing
    StartTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    EndTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    DurationMs UInt64 CODEC(Delta(8), ZSTD(1)),

    -- span metadata
    SpanName LowCardinality(String),
    SpanKind UInt8 CODEC(ZSTD(1)),
    ServiceName LowCardinality(String),

    -- attributes
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    -- status
    StatusCode Nullable(UInt8) CODEC(ZSTD(1)),
    StatusMessage Nullable(String) CODEC(ZSTD(1)),

    -- scope
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion Nullable(String) CODEC(ZSTD(1)),

    -- events
    `Events.Timestamp` Array(DateTime64(3)) CODEC(ZSTD(1)),
    `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),

    -- links
    `Links.TraceId` Array(String) CODEC(ZSTD(1)),
    `Links.SpanId` Array(String) CODEC(ZSTD(1)),
    `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),

    -- dropped counts
    DroppedAttributesCount UInt32 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
    DroppedEventsCount UInt32 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
    DroppedLinksCount UInt32 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id SpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service_name ServiceName TYPE set(1000) GRANULARITY 4,
    INDEX idx_span_name SpanName TYPE set(10000) GRANULARITY 4,
    INDEX idx_status_code StatusCode TYPE set(10) GRANULARITY 4,
    INDEX idx_duration_ms DurationMs TYPE minmax GRANULARITY 1,
    INDEX idx_start_time StartTime TYPE minmax GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_trace_span (TenantId, TraceId, SpanId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}StartTime)
PARTITION BY toYearWeek(StartTime)
ORDER BY (TenantId, TraceId, SpanId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- 3. trace_summaries — Aggregated trace-level metrics
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries
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

-- ---------------------------------------------------------------------------
-- 4. evaluation_runs — Per-evaluation execution records
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs
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
    ErrorDetails Nullable(String) CODEC(ZSTD(3)),

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

-- ---------------------------------------------------------------------------
-- 5. experiment_runs — Experiment batch run aggregates
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs
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

-- ---------------------------------------------------------------------------
-- 6. experiment_run_items — Per-row experiment results
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items
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

-- ---------------------------------------------------------------------------
-- 7. simulation_runs — Scenario simulation execution records
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs
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

-- ---------------------------------------------------------------------------
-- 8. billable_events — Usage metering records
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.billable_events
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    EventId String CODEC(ZSTD(1)),
    EventType LowCardinality(String),
    DeduplicationKey String CODEC(ZSTD(1)),
    DeduplicationKeyHash UInt64 MATERIALIZED cityHash64(DeduplicationKey),
    EventTimestamp DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(EventTimestamp)
ORDER BY (OrganizationId, TenantId, DeduplicationKeyHash)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- 9. stored_log_records — OpenTelemetry log record storage
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_log_records
(
    -- identity
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),

    -- trace/span correlation
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),

    -- log record fields
    TimeUnixMs DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    SeverityNumber UInt8 CODEC(ZSTD(1)),
    SeverityText LowCardinality(String),
    Body String CODEC(ZSTD(1)),

    -- attributes
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    -- scope
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion Nullable(String) CODEC(ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id SpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_severity SeverityNumber TYPE set(256) GRANULARITY 4,
    INDEX idx_time TimeUnixMs TYPE minmax GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(TimeUnixMs)
ORDER BY (TenantId, TraceId, SpanId, ProjectionId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- 10. stored_metric_records — OpenTelemetry metric record storage
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_metric_records
(
    -- identity
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),

    -- trace/span correlation
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),

    -- metric fields
    MetricName LowCardinality(String),
    MetricUnit String CODEC(ZSTD(1)),
    MetricType LowCardinality(String),
    Value Float64 CODEC(ZSTD(1)),
    TimeUnixMs DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- attributes
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id SpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_metric_name MetricName TYPE set(1000) GRANULARITY 4,
    INDEX idx_metric_type MetricType TYPE set(10) GRANULARITY 4,
    INDEX idx_time TimeUnixMs TYPE minmax GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(TimeUnixMs)
ORDER BY (TenantId, TraceId, SpanId, MetricName, ProjectionId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations commented out to match existing pattern (data is not recoverable)
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.event_log SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.stored_spans SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.billable_events SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.stored_log_records SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.stored_metric_records SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.suite_runs SYNC;
-- +goose StatementEnd

-- +goose ENVSUB OFF
