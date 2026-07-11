-- +goose Up
-- +goose ENVSUB ON

-- Promote the Langy conversation title to a first-class, source-tracked field.
-- `TitleSource` records WHERE the current Title came from so the fold and the
-- cheap-model regeneration reactor can enforce precedence:
--   derived — first-message placeholder slice (may be replaced by an auto title)
--   auto    — produced by the langyTitleGeneration reactor (may be refined)
--   user    — a manual rename (sticky; never overridden by an auto title)
--
-- Existing rows predate title tracking and are all first-message-derived, so
-- the column defaults to 'derived'. LowCardinality: only three values ever.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations
    ADD COLUMN IF NOT EXISTS TitleSource LowCardinality(String) DEFAULT 'derived';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migration is intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations DROP COLUMN IF EXISTS TitleSource;
-- +goose StatementEnd

-- +goose ENVSUB OFF
