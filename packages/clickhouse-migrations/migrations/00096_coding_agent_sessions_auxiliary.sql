-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: a thread the agent ran for itself.
--
--   Auxiliary: true once any of the session's spans carried the auxiliary mark
--              ingestion stamps on a trace codex started for a helper thread
--              of its own (the thread title generator, the recap). Such a
--              session keeps its row and its priced traces, and the Sessions
--              list omits it.
--
-- Codex 0.154 runs those helpers on a thread with an id of its own, through
-- the same telemetry exporter as the session they serve, so every title
-- generation used to list as a second, untitled session. Nothing on the
-- helper's telemetry names the thread it serves; the mark is derived from the
-- app-server request that started the helper turn.
--
-- DEFAULT false: a row from before this column is a session the mark never
-- reached, which is also what an unmarked session decodes to.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS Auxiliary Bool DEFAULT false CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets which sessions
-- were helper threads. `up` is idempotent (`ADD COLUMN IF NOT EXISTS`), so
-- `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS Auxiliary;
