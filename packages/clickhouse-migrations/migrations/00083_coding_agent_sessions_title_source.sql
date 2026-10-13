-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: which source set the session's Title.
--
--   TitleSource: "prompt", "generated" or "name" — or '' on rows from
--                before this column.
--
-- `Title` (00075) stays the ONE title column, but it now has three sources
-- in rank order: the session's own name as the harness holds it (claude's
-- --name / /rename, codex's thread name, mirrored by the capture seams over
-- `langwatch.session.name`), the generated conversation title, and the first
-- typed prompt. The fold's working state is decoded back from this row
-- (ADR-066), and the title alone cannot say whether a later generated title
-- may replace it — getting that wrong renames a session away from the name
-- its harness holds. So the winning source rides beside the title.
--
-- LowCardinality: three fixed values and the empty default.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS TitleSource LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets which source
-- named every session already folded. `up` is idempotent
-- (`ADD COLUMN IF NOT EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS TitleSource;
