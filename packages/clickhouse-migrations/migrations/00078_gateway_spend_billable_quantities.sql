-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- The billable quantities gateway_spend could not store.
--
-- The table carries five token classes and nothing else, so every quantity a
-- provider bills by that is not a token had nowhere to land. Measured against
-- production: three openai/tts-1 calls of 4000 characters each, $0.18 of real
-- spend, moved a budget by $0.0002. The characters were measured at the
-- gateway, dropped at the spend wire, and the request rated at zero
-- (langwatch/langwatch#6934).
--
-- The five columns below close that, one per quantity:
--
--   CharsInput          characters synthesized, what TTS is priced by
--   AudioMS             audio duration, what transcription and conversation
--                       are priced by
--   TokensCacheWrite1h  hour-long cache writes, measured today and dropped
--                       at the same seam
--   TokensInputAudio    audio tokens in the prompt total
--   TokensOutputAudio   audio tokens in the completion total
--
-- The audio token columns are not a nicety. OpenAI charges $32 per million
-- audio input tokens against $4 for text on gpt-realtime, so a conversation
-- metered from a flat prompt total prices at an eighth of what it costs. The
-- two counts arrive already subtracted from TokensInput and TokensOutput, so
-- each token is priced exactly once.
--
-- Duration is whole MILLISECONDS, not fractional seconds. Every quantity in
-- this pipeline is an integer, and money is integer nano-USD; a float would
-- put the one non-integer quantity on the money path. The discretisation
-- costs at most 283 nano-USD per request at the highest per-second rate in
-- the catalog, rounded half up at the gateway, against a smallest billable
-- unit of 1 nano-USD. Milliseconds convert to seconds exactly once, at the
-- rating seam.
--
-- DEFAULT 0 with NO projection version bump. Zero is the truthful value for
-- every row written before these columns existed: those requests really did
-- carry no characters, no audio and no hour-long cache writes on the wire.
-- Bumping GATEWAY_SPEND_PROJECTION_VERSION_LATEST would instead make every
-- existing row a store miss, and the fold runs with refoldOnStoreMiss off, so
-- a miss folds from init() and overwrites a committed row with partial state.
-- The read path pays for that choice by selecting and decoding these columns
-- in readForFold, so a late admission folding over a confirmed request
-- restates the quantities rather than zeroing them.
--
-- Metadata-only ALTER: ADD COLUMN with a literal default writes no data and
-- rewrites no parts. Old parts serve the default on read.
--
-- No ON CLUSTER: the database engine is Replicated, which distributes DDL on
-- its own.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD COLUMN IF NOT EXISTS CharsInput UInt64 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS AudioMS UInt64 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS TokensCacheWrite1h UInt64 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS TokensInputAudio UInt64 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS TokensOutputAudio UInt64 DEFAULT 0;
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

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS TokensOutputAudio;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS TokensInputAudio;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS TokensCacheWrite1h;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS AudioMS;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS CharsInput;
