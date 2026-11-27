-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_session_events: the subscription account a call ran on.
--
--   AccountId             langwatch.account.id, else the agent's own
--                         user.account_uuid / user.account_id. Never an email.
--   AccountName           the label the account's owner set.
--   AccountSource         personal, pool or computer, as the launcher says.
--   AccountUsagePercent   the provider's own usage figure (0 to 100) at the
--                         launcher's latest reading; NULL when none was sent.
--   AccountUsageWindow    which window that figure is for (five_hour, ...).
--   AccountUsageResetsAt  when that window resets.
--   AccountUsageReadAt    when the launcher read the figure.
--   AccountLimitedUntil   set while the account is out of usage.
--
-- Filled on model_call and rate_limit rows only. Rows from before these
-- columns read as no account ('' and NULL); queries filter on AccountId != ''.
-- No backfill: there is nothing to backfill from.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountId String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountName String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountSource LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountUsagePercent Nullable(Float64) DEFAULT NULL CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountUsageWindow LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountUsageResetsAt Nullable(DateTime64(3)) DEFAULT NULL CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountUsageReadAt Nullable(DateTime64(3)) DEFAULT NULL CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AccountLimitedUntil Nullable(DateTime64(3)) DEFAULT NULL CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets the account of
-- every call already written. `up` is idempotent (`ADD COLUMN IF NOT EXISTS`),
-- so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountId;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountName;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountSource;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountUsagePercent;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountUsageWindow;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountUsageResetsAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountUsageReadAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AccountLimitedUntil;
