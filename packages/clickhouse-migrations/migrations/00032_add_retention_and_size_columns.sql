-- +goose Up
-- +goose ENVSUB ON

-- Add _retention_days (UInt16, 308 = 10 months / 44 weeks, partition-aligned)
-- and _size_bytes (UInt32, MATERIALIZED via CH-native byteSize(...)) to all
-- 11 retention-managed tables.
--
-- Each ALTER is its own StatementBegin block because ClickHouse does not
-- support multi-statement ALTER queries.
--
-- Properties (see `ch/migration-and-throttling.md` for the full story):
--
-- * DEFAULT 308 — intentional behavior change. Rows older than 308 days
--   become TTL-eligible on the next merge cycle for their partition. Sparse
--   encoding compresses the column to ~zero bytes on parts where every row
--   holds the default ([RFC #19953]).
--
-- * MATERIALIZED byteSize(...) — ClickHouse computes the row's in-memory
--   byte total server-side at insert time across the listed payload columns.
--   App must NEVER pass _size_bytes in INSERTs (MATERIALIZED columns are
--   not insertable; CH will reject the row). Old parts compute the value
--   lazily on read; merges drift it onto disk over normal operations.
--
-- * Metadata-only at migration time. ClickHouse does NOT scan or rewrite
--   existing parts. Confirmed by Alexey Milovidov (CH maintainer):
--   "Usually add column is instant and blocks nothing and waits for nothing."
--   The migration that hung previously was environmental (alter_sync /
--   replication queue / stuck mutations) — see runbook before retrying.
--
-- * SETTINGS alter_sync = 1, mutations_sync = 0 — wait only for the local
--   replica, never queue behind unrelated mutations.


-- event_log: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- event_log: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(EventPayload, ProcessingTraceparent)
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_spans: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_spans: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(
      ResourceAttributes, SpanAttributes, StatusMessage,
      ScopeName, ScopeVersion,
      `Events.Timestamp`, `Events.Name`, `Events.Attributes`,
      `Links.TraceId`, `Links.SpanId`, `Links.Attributes`
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_log_records: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_log_records: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(Body, Attributes, ResourceAttributes, ScopeName, ScopeVersion)
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_metric_records: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- stored_metric_records: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(MetricUnit, Attributes, ResourceAttributes)
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- trace_summaries: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- trace_summaries: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(
      Attributes, ComputedInput, ComputedOutput, ErrorMessage,
      Models, TopicId, SubTopicId, AnnotationIds,
      SelectedPromptId, SelectedPromptSpanId,
      LastUsedPromptId, LastUsedPromptVersionId, LastUsedPromptSpanId,
      TraceName, SourceId
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- evaluation_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- evaluation_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(
      EvaluatorName, TraceId, Label, Details, Error, ErrorDetails, Inputs
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- experiment_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- experiment_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(WorkflowVersionId, Targets)
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- experiment_run_items: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- experiment_run_items: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(
      DatasetEntry, Predicted, TargetError, TraceId,
      EvaluatorId, EvaluatorName, Label,
      EvaluationDetails, EvaluationInputs
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- simulation_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- simulation_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(
      Status, Name, Description,
      `Messages.Id`, `Messages.Role`, `Messages.Content`,
      `Messages.TraceId`, `Messages.Rest`,
      TraceIds, Verdict, Reasoning,
      MetCriteria, UnmetCriteria,
      Error, Metadata,
      RoleCosts, RoleLatencies,
      TraceMetricsJson
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- suite_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- suite_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(Status)
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- dspy_steps: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- dspy_steps: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32
    MATERIALIZED byteSize(
      Label, OptimizerName, OptimizerParameters,
      Predictors, Examples, LlmCalls
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs DROP COLUMN IF EXISTS `_size_bytes`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps DROP COLUMN IF EXISTS `_size_bytes`;
-- +goose StatementEnd
