-- +goose Up
-- +goose ENVSUB ON
--
-- Per-origin retention TTL for governance-origin spans and log records.
-- Adds RetentionClass column on stored_spans + stored_log_records and
-- attaches per-class TTL clauses so governance ingest auto-expires per
-- the IngestionSource.retentionClass setting:
--
--   thirty_days  → 30 days  (operational, default for IngestionSources;
--                            SOC 2 / ISO 27001 baseline-by-implication)
--   one_year     → 1 year   (compliance baseline — SOC 2 long-form,
--                            ISO 27001 audit cycle, EU AI Act
--                            general-purpose)
--   seven_years  → 7 years  (regulated industry — HIPAA covered-entity,
--                            SEC 17a-4-adjacent, financial audit)
--
-- Application-origin spans (no governance origin) are NOT subject to
-- TTL — RetentionClass defaults to the empty string, which doesn't
-- match any TTL clause's WHERE predicate, so existing
-- application-trace retention behaviour is fully preserved.
--
-- Population: the trace-processing pipeline's spanStorage +
-- logRecordStorage map projections read
-- `langwatch.governance.retention_class` from the span/log attributes
-- and write it into this column at ingest. Receiver
-- (ingestionRoutes.ts) stamps the attribute on every governance span
-- per step 2b-i (e2c30961a). Population code lands in 3c-ii.
--
-- Why DEFAULT '' (not 'thirty_days'): a non-empty default would
-- accidentally apply the 30-day TTL to ALL application traces on the
-- next ClickHouse merge — which would delete every customer's
-- existing trace history. The empty-string default is a no-op against
-- all three TTL clauses below; only governance ingest (which populates
-- the column at write time) gets retention enforced.
--
-- Why TTL on stored_spans + stored_log_records (not trace_summaries):
-- trace_summaries is a derived projection. When its source span rows
-- expire from stored_spans, downstream queries naturally return less
-- data; trace_summaries rows themselves are eventually consistent.
-- Per ADR-018, trace_summaries can be rebuilt from event_log if
-- needed (event_log itself remains the source of truth and is NOT
-- governed by per-origin retention here — that's a separate concern
-- tracked under the deferred tamper-evidence work).
--
-- Spec: specs/ai-gateway/governance/retention.feature

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS RetentionClass LowCardinality(String) DEFAULT '' AFTER ServiceName;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  MODIFY TTL
    StartTime + INTERVAL 30 DAY DELETE WHERE RetentionClass = 'thirty_days',
    StartTime + INTERVAL 1 YEAR DELETE WHERE RetentionClass = 'one_year',
    StartTime + INTERVAL 7 YEAR DELETE WHERE RetentionClass = 'seven_years';
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD COLUMN IF NOT EXISTS RetentionClass LowCardinality(String) DEFAULT '' AFTER ScopeVersion;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  MODIFY TTL
    TimeUnixMs + INTERVAL 30 DAY DELETE WHERE RetentionClass = 'thirty_days',
    TimeUnixMs + INTERVAL 1 YEAR DELETE WHERE RetentionClass = 'one_year',
    TimeUnixMs + INTERVAL 7 YEAR DELETE WHERE RetentionClass = 'seven_years';
-- +goose StatementEnd

-- +goose Down
-- Down migration intentionally not provided — dropping the
-- RetentionClass column AND the TTL clauses on stored_spans /
-- stored_log_records is supported but operator-only (the TTL
-- enforcement is a customer-visible compliance posture; flipping it
-- off accidentally would silently extend retention beyond the
-- contracted class). To roll back: uncomment the statements below
-- and run manually after coordinating with operators.
--
-- -- +goose StatementBegin
-- -- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans REMOVE TTL;
-- -- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS RetentionClass;
-- -- +goose StatementEnd
-- -- +goose StatementBegin
-- -- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records REMOVE TTL;
-- -- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records DROP COLUMN IF EXISTS RetentionClass;
-- -- +goose StatementEnd
