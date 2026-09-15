-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- The image quantities gateway_spend could not store.
--
-- The gateway's image generation and edit endpoints meter the token-billed
-- image models (OpenAI's gpt-image family) in three disjoint buckets: text
-- tokens, input image tokens and output image tokens. The table carried
-- columns for the first only, so an image call's pixels had nowhere to land
-- and the request rated at a fraction of its cost: a 1024x1024 answer is
-- about 1600 output image tokens at $30 to $40 per million, most of what
-- the call costs, against a prompt of a few dozen text tokens.
--
-- The three columns below close that, one per quantity:
--
--   TokensInputImage    image tokens in the prompt, what an edit pays for
--                       the pixels it reads
--   TokensOutputImage   image tokens in the answer, what every generated
--                       image is billed by
--   ImageCount          images the response carried, for display only;
--                       nothing prices from it
--
-- The two token counts arrive already subtracted from TokensInput and
-- TokensOutput, the same exclusive split as the audio token columns, so each
-- token is priced exactly once.
--
-- DEFAULT 0 with NO projection version bump, for the reason 00078 states:
-- zero is the truthful value for every row written before these columns
-- existed, and a version bump would turn every existing row into a store
-- miss that folds from init() and overwrites committed state. The read path
-- selects and decodes these columns in readForFold, so a late admission
-- folding over a confirmed request restates them rather than zeroing them.
--
-- Metadata-only ALTER: ADD COLUMN with a literal default writes no data and
-- rewrites no parts. Old parts serve the default on read.
--
-- No ON CLUSTER: the database engine is Replicated, which distributes DDL on
-- its own.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD COLUMN IF NOT EXISTS TokensInputImage UInt64 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS TokensOutputImage UInt64 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ImageCount UInt64 DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: this down step is deliberately a no-op.
--
-- Every statement below is a DROP against the billing spend ledger, and goose
-- runs a down step unattended, on whichever environment asked for it. Dropping
-- a quantity column destroys the only record of what a request was billed for,
-- which no rollback is worth. Leaving the up step in place is safe: an older
-- build reading this table simply does not select these columns.
--
-- To roll back, uncomment and run these manually.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS ImageCount;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS TokensOutputImage;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS TokensInputImage;
