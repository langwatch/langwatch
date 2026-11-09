-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- The web search count gateway_spend could not store.
--
-- A provider's built-in web search tool bills per query on top of the tokens,
-- and the spend vocabulary prices it as web_search_requests. The table keeps
-- one column per priced quantity, so the count needs its own:
--
--   WebSearchRequests   web search tool calls the provider ran, each priced
--                       at the model's per-query rate
--
-- DEFAULT 0 with no projection version bump, for the reason 00078 states:
-- zero is the truthful value for every row written before the column existed.
-- The fold read selects and decodes it, so a late admission folding over a
-- confirmed request restates it rather than zeroing it.
--
-- Metadata-only ALTER: ADD COLUMN with a literal default writes no data and
-- rewrites no parts. No ON CLUSTER: the database engine is Replicated.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD COLUMN IF NOT EXISTS WebSearchRequests UInt64 DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: this down step is deliberately a no-op. Dropping a quantity
-- column destroys the only record of what a request was billed for. An older
-- build reading this table simply does not select the column.
--
-- To roll back, uncomment and run manually.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS WebSearchRequests;
