-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions — read-back columns (ADR-066, Pillar 1 adopter #1).
--
-- The session fold's store.get() returned null by design, so every cache miss
-- and every out-of-order delivery refolded the aggregate's WHOLE history from
-- event_log. On a large session that is a 20-100 MB S3-walking read; enough of
-- them starved ClickHouse merges into OOM, stalled event_log part merges, and
-- tripped TOO_MANY_PARTS platform-wide (2026-07-23 outage).
--
-- ADR-066 makes the fold read back its own last committed state instead. The
-- row already carries almost the whole state as typed columns; these five close
-- the round-trip gap so store.get() can reconstruct working state WITHOUT ever
-- reading event_log:
--
--   SubAgentIds               — the dedup set behind the SubAgents count; the
--                               row carried the count + types, not the ids.
--   PreviousCallContextTokens — the previous model call's context size, used to
--                               detect the NEXT call's cache rebuild.
--   StepStartedAt             — per-step start times, parallel to Steps. Steps
--                               dropped these on projection, which is the real
--                               reason a read-back step could not be re-ordered.
--   MetricSeries              — the converged metric units the metric-fed fields
--                               are recomputed from (replace-not-increment,
--                               ADR-056 §5). Persisting the map makes the pure
--                               overlay reproduce every metric-fed field on
--                               read-back with no read-path change. (Transitional
--                               per ADR-066 step 2: this map later leaves the
--                               fold for session_metric_series.)
--   LastEventOccurredAt       — the fold's out-of-order checkpoint. CreatedAt /
--                               UpdatedAt already exist (UpdatedAt is the RMT
--                               version), so only this one is new.
--
-- Each ALTER is its own statement block — ClickHouse does not support
-- multi-statement queries.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS SubAgentIds Array(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS PreviousCallContextTokens UInt64 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS StepStartedAt Array(UInt64) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- (SeriesId, MetricName, Type, Decision, Language, Value). Unnamed tuple so it
-- serialises as a JSON array over JSONEachRow, exactly like the Steps column.
-- Nullable attribute fields ride as empty strings and map back to null.
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS MetricSeries Array(Tuple(String, String, String, String, String, Float64)) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS LastEventOccurredAt DateTime64(3) DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS SubAgentIds;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS PreviousCallContextTokens;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS StepStartedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS MetricSeries;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS LastEventOccurredAt;
