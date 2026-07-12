-- +goose Up
-- +goose ENVSUB ON

-- langy_conversation_turns — the per-TURN render document for the in-product
-- Langy assistant, a SECOND fold projection over the same langy_conversation
-- aggregate (the first is langy_conversations, the conversation spine).
--
-- The conversation's event stream is folded two ways: langyConversationState
-- keys per conversation; langyConversationTurn keys per (ConversationId, TurnId)
-- via the fold's custom key extractor, producing one document per turn. Reading
-- one row here is enough to render an entire turn — its status, the agent's
-- whole answer (text + tool-output cards + enrichment + actions, as JSON parts),
-- and the tool-call lifecycle audit.
--
-- Shape mirrors langy_conversations: ProjectionId + TenantId + the aggregate id
-- (ConversationId + TurnId) + Version, ReplacingMergeTree(UpdatedAt) for
-- insert-retry / re-fold idempotency. TenantId = projectId. Rich fields
-- (QuestionParts, AnswerParts, ToolCalls) are stored as JSON strings, exactly
-- like langy_messages.Parts, so message text never leaves the customer's
-- ClickHouse. Retention TTL intentionally omitted for parity (ADR-046 open q3).

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.langy_conversation_turns
(
    ProjectionId    String                 CODEC(ZSTD(1)),
    TenantId        String                 CODEC(ZSTD(1)),
    ConversationId  String                 CODEC(ZSTD(1)),
    TurnId          String                 CODEC(ZSTD(1)),
    Version         String                 CODEC(ZSTD(1)),

    -- Lifecycle: pending | running | completed | failed.
    Status          LowCardinality(String),

    -- JSON-serialised UI-message parts / tool-call list (opaque to the pipeline).
    -- QuestionParts is reserved (populated once the flow shares a turnId; see
    -- LANGY_REWORK_PLAN.md S2). AnswerParts carries the whole final answer.
    QuestionParts   String                 CODEC(ZSTD(1)),
    AnswerParts     String                 CODEC(ZSTD(1)),
    ToolCalls       String                 CODEC(ZSTD(1)),

    Error           Nullable(String)       CODEC(ZSTD(1)),
    StartedAt       Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    EndedAt         Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    CreatedAt       DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt       DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    -- Highest event occurredAt applied — the fold's out-of-order guard.
    LastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(CreatedAt)
ORDER BY (TenantId, ConversationId, TurnId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migration is intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.langy_conversation_turns;
-- +goose StatementEnd

-- +goose ENVSUB OFF
