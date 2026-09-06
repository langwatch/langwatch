-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- gateway_budget_ledger_events.ProviderKey: the provider a debit was
-- actually dispatched to.
--
-- A budget can now carry a provider filter ("$50/month, OpenAI only"). Which
-- bucket a debit lands in is already handled by the ScopeId the fold writes
-- (the filter rides the bucket key, so a filtered and an unfiltered budget on
-- the same target never share a pot). This column is the audit dimension for
-- the row itself: without it a ledger event cannot answer "which vendor did
-- this dollar go to", which is the first question asked when a provider-
-- filtered budget's total is disputed.
--
-- Empty string means the dispatching gateway did not report a provider. Old
-- rows keep that default, which is honest: they predate the field.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
    ADD COLUMN IF NOT EXISTS ProviderKey String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
    DROP COLUMN IF EXISTS ProviderKey;
-- +goose StatementEnd

-- +goose ENVSUB OFF
