-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: git context and the session title.
--
-- Where a session ran, and what it was called. No coding agent exports any of
-- this on its own telemetry (verified at the raw OTLP wire), so the first five
-- columns are fed by one small LangWatch companion event,
-- `langwatch.session_context`, emitted by a hook the CLI wrapper installs:
--
--   RepositoryHost:   the forge the checkout points at (`github.com`, an
--   RepositoryOwner:  enterprise host, …), plus the owner and repository name.
--   RepositoryName:   Once-set per session: a session is one checkout.
--   GitBranch:        the branch the session ENDED on, last write wins. A
--                     session that starts on the default branch and cuts a
--                     feature branch mid-run belongs to the branch its pull
--                     request comes from, not the one it opened with.
--   GitWorktree:      the working directory, so parallel worktrees of one
--                     repository are told apart. Once-set, like the repository.
--   Title:            the conversation title the agent generates for the
--                     session, parsed out of its title-generator response body.
--                     Conversation-derived content: the read path gates it
--                     behind the viewer's captured-content visibility, unlike
--                     the git columns above, which are operational metadata.
--
-- Agents with no companion emitter carry the defaults, and empty means "nothing
-- reported it", never "this session has no repository".
--
-- Every DEFAULT '' is load-bearing rather than cosmetic. A variable-size column
-- added by ALTER is unmaterialised in every part written before it, so a read
-- decodes a size header that was never written; 00014, 00057 and 00074 all
-- fixed exactly that, and every session row that exists today is such a part.
--
-- Each ALTER is its own statement block, because ClickHouse does not support
-- multi-statement queries.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS RepositoryHost LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS RepositoryOwner LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS RepositoryName LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- Plain String, never LowCardinality: branch names are high-cardinality (one
-- per task, often per agent run), the same reasoning ParentSessionId carries
-- in 00074.
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS GitBranch String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS GitWorktree String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS Title String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: every rollback here is a DROP COLUMN, which destroys the
-- values that column holds for every session already folded, and an automated
-- `goose down` is exactly the way that happens by accident. The statements are
-- written out but left commented, so `down` is deliberately a no-op: re-running
-- `up` is idempotent (`ADD COLUMN IF NOT EXISTS`), and a rollback that has to
-- be pasted by hand is one somebody decided on.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS RepositoryHost;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS RepositoryOwner;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS RepositoryName;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS GitBranch;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS GitWorktree;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS Title;
