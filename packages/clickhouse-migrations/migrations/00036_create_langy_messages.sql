-- +goose Up
-- +goose ENVSUB ON

-- Langy conversation messages — the content layer for the in-product assistant.
--
-- Rogerio's design note (PR #4913 review): message content must live on the
-- customer side (ClickHouse) so that hybrid-deployment customers never have
-- their conversation content on LangWatch infrastructure. Postgres keeps only
-- the thin LangyConversation spine (id, projectId, userId, title, isShared,
-- lastActivityAt, messageCount) — no content or content-derived fields.
--
-- Shape mirrors experiment_run_items (per-item rows) with ReplacingMergeTree
-- for insert-retry idempotency keyed on (TenantId, ConversationId, MessageId).
-- TenantId = projectId (same convention as trace_summaries and all other tables).

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.langy_messages
(
    TenantId        String               CODEC(ZSTD(1)),
    ConversationId  String               CODEC(ZSTD(1)),
    MessageId       String               CODEC(ZSTD(1)),
    Role            LowCardinality(String),
    Parts           String               CODEC(ZSTD(3)),
    CreatedAt       DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt       DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
ORDER BY (TenantId, ConversationId, MessageId)
PARTITION BY toYYYYMM(CreatedAt)
SETTINGS index_granularity = 8192;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.langy_messages;
