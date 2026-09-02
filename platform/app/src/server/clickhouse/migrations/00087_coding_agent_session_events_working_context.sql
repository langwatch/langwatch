-- +goose Up
-- +goose ENVSUB ON

-- The working context active when the event happened: repository and branch,
-- stamped onto each fact row by the contribute command from the session's
-- last `session_context` declaration. This is what lets one session's cost
-- split across every pull request it drove, instead of the whole
-- lifetime-cumulative total landing on the earliest one.
--
-- '' means the row predates the stamp or the session had not declared yet;
-- the usage read prices those rows under the legacy whole-session rule, so
-- history behaves exactly as before this migration. No backfill on purpose:
-- there is nothing correct to backfill from.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
    ADD COLUMN IF NOT EXISTS RepositoryHost LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
    ADD COLUMN IF NOT EXISTS RepositoryOwner LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
    ADD COLUMN IF NOT EXISTS RepositoryName LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
    ADD COLUMN IF NOT EXISTS Branch LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Rolling back drops the stamped context on every row, which cannot be
-- rewritten afterwards. To roll back, uncomment and run manually:
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS RepositoryHost;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS RepositoryOwner;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS RepositoryName;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS Branch;
