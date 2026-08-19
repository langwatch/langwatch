-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: the title the session's orchestrator declared.
--
--   TitleExplicit: the newest explicit title carried on the session's
--                  companion `langwatch.session_context` events, set from
--                  LANGWATCH_SESSION_TITLE in the session's environment.
--
-- `Title` (00075) keeps its two-source semantics untouched: the generated
-- conversation title replaces it, the first typed prompt fills it when empty.
-- The explicit title is a THIRD source that outranks both, and it lives in
-- its own column rather than a precedence flag because the fold's working
-- state is decoded back from this row (ADR-066): a single column holding
-- "whichever source won" cannot say whether a later generated title may
-- replace it, and getting that wrong renames a fleet agent back to its
-- scripted greeting. The read coalesces TitleExplicit over Title.
--
-- Plain String: titles are free text. The DEFAULT '' matters the usual
-- ALTER way — parts written before this column decode the default instead
-- of a missing-column error.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS TitleExplicit String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which destroys the declared
-- title of every session already folded. `up` is idempotent
-- (`ADD COLUMN IF NOT EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS TitleExplicit;
