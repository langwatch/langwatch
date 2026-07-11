-- +goose Up
-- +goose ENVSUB ON

-- ADR-048 shutdown-handoff: two columns on the langy_conversations fold table
-- carrying the opaque, worker-authored resume token a turn leaves when it
-- checkpoints on pod termination, and the turn it belongs to (idempotent
-- consume). Both NULL for a conversation with nothing to resume — the common
-- case. The token is opaque to the platform: stored verbatim, only opencode
-- authors and reads it (the manager forwards it, the control plane persists it).
--
-- ReplacingMergeTree(UpdatedAt) fold semantics are unchanged; these are just two
-- more latest-version columns the fold projection writes.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations
    ADD COLUMN IF NOT EXISTS PendingHandoffToken Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations
    ADD COLUMN IF NOT EXISTS PendingHandoffTurnId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migration is intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations DROP COLUMN IF EXISTS PendingHandoffToken;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.langy_conversations DROP COLUMN IF EXISTS PendingHandoffTurnId;
-- +goose StatementEnd

-- +goose ENVSUB OFF
