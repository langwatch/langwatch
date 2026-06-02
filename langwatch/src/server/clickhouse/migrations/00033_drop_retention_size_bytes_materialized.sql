-- +goose Up
-- +goose ENVSUB ON

-- Drop _size_bytes MATERIALIZED column from all retention-managed tables.
--
-- The column was added in 00032 as `MATERIALIZED byteSize(<payload cols>)`.
-- ClickHouse evaluates that expression on the heavy payload columns
-- (EventPayload, SpanAttributes, ResourceAttributes, ComputedInput/Output,
-- Inputs, …) during background merges as it drifts the value onto disk for
-- pre-existing parts. On heavy-payload tables this materially increased
-- merge memory usage and combined with already-large parts to push merges
-- past the per-server memory cap, producing MEMORY_LIMIT_EXCEEDED failures
-- on MERGE_PARTS replication queue entries and an exponential-backoff
-- retry loop that pressured the cluster.
--
-- Retention enforcement itself does NOT depend on `_size_bytes` — only
-- `_retention_days` is referenced by the TTL DELETE expression. The storage
-- metering surface that used `SUM(_size_bytes)` is reworked alongside this
-- migration to a path that does not require a per-row byteSize column.
--
-- DROP COLUMN is metadata-only at ALTER time and reads no row data; the
-- column files are removed from each part on disk lazily.

-- event_log
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_spans
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_log_records
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_metric_records
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- trace_summaries
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- evaluation_runs
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- experiment_runs
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- experiment_run_items
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- simulation_runs
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- suite_runs
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- dspy_steps
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps
  DROP COLUMN IF EXISTS `_size_bytes`
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually. Re-adding the MATERIALIZED column
-- re-introduces the byteSize() merge-memory cost that motivated dropping it,
-- so a rollback must be followed by either raising the CH per-server memory
-- cap or accepting merge OOM risk on heavy-payload tables.
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(EventPayload, ProcessingTraceparent) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(ResourceAttributes, SpanAttributes, StatusMessage, ScopeName, ScopeVersion, `Events.Timestamp`, `Events.Name`, `Events.Attributes`, `Links.TraceId`, `Links.SpanId`, `Links.Attributes`) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(Body, Attributes, ResourceAttributes, ScopeName, ScopeVersion) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(MetricUnit, Attributes, ResourceAttributes) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(Attributes, ComputedInput, ComputedOutput, ErrorMessage, Models, TopicId, SubTopicId, AnnotationIds, SelectedPromptId, SelectedPromptSpanId, LastUsedPromptId, LastUsedPromptVersionId, LastUsedPromptSpanId, TraceName, SourceId) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(EvaluatorName, TraceId, Label, Details, Error, ErrorDetails, Inputs) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(WorkflowVersionId, Targets) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(DatasetEntry, Predicted, TargetError, TraceId, EvaluatorId, EvaluatorName, Label, EvaluationDetails, EvaluationInputs) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(Status, Name, Description, `Messages.Id`, `Messages.Role`, `Messages.Content`, `Messages.TraceId`, `Messages.Rest`, TraceIds, Verdict, Reasoning, MetCriteria, UnmetCriteria, Error, Metadata, RoleCosts, RoleLatencies, TraceMetricsJson) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(Status) CODEC(Delta(4), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 MATERIALIZED byteSize(Label, OptimizerName, OptimizerParameters, Predictors, Examples, LlmCalls) CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd
