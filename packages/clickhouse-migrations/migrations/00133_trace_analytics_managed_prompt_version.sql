-- +goose Up
-- +goose ENVSUB ON

-- The managed prompt version a trace last used, as a trace_analytics column, so att-change reads
-- it from trace_metrics instead of traces (analytics ADR-006). It is the version of the trace's
-- latest prompt span by start time, the SpanId breaking a tie, by trace_summaries' rule. Each fold
-- reads its own row back and forgets the start time, so a late prompt span can leave this column
-- and trace_summaries.LastUsedPromptVersionId apart until the trace is refolded.
--
-- A plain column with a DEFAULT, no MATERIALIZED expression: the traceAnalytics fold writes it, so
-- an older release that writes the row leaves ''. This file starts no mutation and copies no rows.
-- background step: trace:replay-trace-analytics-managed-prompt-version refolds the last 122 days
-- once no older writer is left.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses the Replicated
-- engine (00001), which propagates DDL to every node on its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS LastUsedPromptVersionId String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS LastUsedPromptVersionId;
