-- +goose Up
-- +goose ENVSUB ON

-- Bloom-filter skip index on coding_agent_sessions.SessionId. The sort key leads with
-- StartedAt, and the single-session read's dedup subquery must stay unwindowed (ADR-071),
-- so the primary key cannot exclude a granule whose SessionId range spans the requested id.
-- bloom_filter(0.001) GRANULARITY 1 matches idx_trace_id on stored_spans. No result changes.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD INDEX IF NOT EXISTS idx_session_id SessionId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- ADD INDEX covers only parts written after it; materialise the existing ones as a background
-- mutation. Deferring it to an ops task left the indexes of 00062 and 00063 inert for a month (#5864).
-- background step: coding-agent:track-session-id-index-materialisation
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  MATERIALIZE INDEX idx_session_id;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP INDEX IF EXISTS idx_session_id;
