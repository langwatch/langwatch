-- +goose Up
-- +goose ENVSUB ON

-- LANGY_WORKER_REDESIGN_PLAN §0a: the per-conversation `runToken` — a 32-byte
-- CSPRNG secret (hex) minted at `conversation_started`, injected into the worker
-- at spawn, and used as the HMAC key that authenticates every frame the worker
-- streams back. SERVER-ONLY: this column is read exclusively by the worker
-- provisioning + relay-verification path (findRunToken); it is NEVER projected
-- to the client (not in the list/detail reads, not in the turn render fold) and
-- never re-sent on the wire. NULL for a conversation with no started event
-- (lazily created) or predating this column.
--
-- ReplacingMergeTree(UpdatedAt) fold semantics are unchanged; this is one more
-- latest-version column the fold projection writes and reads back on replay.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations
    ADD COLUMN IF NOT EXISTS RunToken Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migration is intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations DROP COLUMN IF EXISTS RunToken;
-- +goose StatementEnd

-- +goose ENVSUB OFF
