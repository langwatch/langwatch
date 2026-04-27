-- +goose Up
-- +goose ENVSUB ON

-- Activity Monitor / D2 foundation:
--   Tag each trace with the upstream source (gateway / personal /
--   claude_cowork / copilot_studio / openai_compliance / workato /
--   otel_generic / s3_custom). SourceId points at the IngestionSource
--   row in Postgres for non-gateway types; for gateway/personal
--   sources it's the projectId (legacy compat).
--
-- Both columns added to trace_summaries (the canonical aggregate table).
-- Existing rows keep SourceType='gateway' which preserves all current
-- query semantics (they were already gateway-originated).
--
-- See:
--   specs/ai-gateway/governance/activity-monitor.feature
--   specs/ai-gateway/governance/ingestion-sources.feature
--   docs/ai-gateway/governance/architecture.md

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS SourceType LowCardinality(String)
    DEFAULT 'gateway' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS SourceId String
    DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- Bloom-filter index on SourceId for the admin-oversight cross-source
-- rollup queries. SourceType is LowCardinality so it benefits
-- automatically from the existing primary-key skipping.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_source_id SourceId
    TYPE bloom_filter(0.01) GRANULARITY 1;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. ALTER TABLE DROP COLUMN
-- is irreversible (data loss). Down migrations are intentionally
-- commented out per LangWatch CLAUDE.md "ClickHouse migration"
-- guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_source_id;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS SourceId;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS SourceType;
