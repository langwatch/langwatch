-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: every branch a session drove.
--
--   GitBranches: the bounded, first-seen set of every branch the session's
--                companion `langwatch.session_context` events reported.
--
-- `GitBranch` (00075) is the branch the session ENDED on, which is the branch
-- it was working in when it stopped, and it stays exactly that. It is not the
-- whole answer to "what did this session drive": an agent that lands a change,
-- moves to the next branch and opens a second pull request is ONE session
-- behind two of them, and a rollup that reads only the last branch charges the
-- whole session to the last pull request while the earlier one reads as free.
-- The set is the history; the scalar is the present tense.
--
-- Plain Array(String), never Array(LowCardinality(String)): branch names are
-- high-cardinality, one per task and often one per agent run. `GitBranch` in
-- 00075 and `FilesTouched` in 00051 are plain String for the same reason,
-- while the LowCardinality arrays next to them (`Models`, `Skills`,
-- `LanguagesEdited`) all hold small, repeating vocabularies.
--
-- The DEFAULT is load-bearing rather than cosmetic, and for an Array it is the
-- difference between a working read and an outage. A variable-size column
-- added by ALTER is unmaterialised in every part written before it, so a read
-- decodes a size header that was never written and ClickHouse tries to
-- allocate whatever that garbage says (Code 173 at read time, Code 241 at merge
-- time). 00014, 00057 and 00074 each fixed exactly that, and 00057 documents
-- the incident it caused.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS GitBranches Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which destroys the branch set of
-- every session already folded, and an automated `goose down` is exactly the
-- way that happens by accident. The statement is written out but left
-- commented, so `down` is deliberately a no-op: re-running `up` is idempotent
-- (`ADD COLUMN IF NOT EXISTS`), and a rollback that has to be pasted by hand is
-- one somebody decided on.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS GitBranches;
