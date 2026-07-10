-- +goose Up
-- +goose ENVSUB ON

-- langy_conversations — the conversation SPINE for the in-product Langy
-- assistant, as an event-sourcing fold projection (ADR-046).
--
-- This table REPLACES the Postgres `LangyConversation` model. A fold projection
-- (langyConversationState.foldProjection) writes one row per conversation
-- (latest version wins) into this ReplacingMergeTree(UpdatedAt). It holds only
-- conversation-level spine metadata — NO message content. Per-message content
-- stays customer-side in `langy_messages` (00036), the same hybrid-deployment
-- guarantee the original design made (PR #4913): message text never leaves the
-- customer's ClickHouse.
--
-- Shape mirrors the other fold-projection tables (simulation_runs,
-- experiment_runs): ProjectionId + TenantId + the aggregate id (ConversationId)
-- + Version, ReplacingMergeTree(UpdatedAt) for insert-retry / re-fold
-- idempotency. TenantId = projectId (platform-wide convention). Retention TTL
-- is intentionally omitted for parity with langy_messages; a Langy retention /
-- erase sweep is a follow-up (ADR-046 open question 3).

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.langy_conversations
(
    ProjectionId    String                 CODEC(ZSTD(1)),
    TenantId        String                 CODEC(ZSTD(1)),
    ConversationId  String                 CODEC(ZSTD(1)),
    Version         String                 CODEC(ZSTD(1)),

    -- Owner (set once, from the first message — first-writer-wins).
    UserId          String                 CODEC(ZSTD(1)),
    Title           Nullable(String)       CODEC(ZSTD(1)),
    -- Lifecycle: active | running | idle | failed | archived.
    Status          LowCardinality(String),

    -- Sharing (preserves the PATCH share surface; ADR-046 open question 1).
    IsShared        Bool                   DEFAULT false,
    SharedAt        Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    SharedById      Nullable(String)       CODEC(ZSTD(1)),

    MessageCount    UInt32                 DEFAULT 0,
    LastActivityAt  Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    -- Liveness heartbeat from status/progress/tool signals during a turn.
    LastHeartbeatAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    -- The turn currently in flight, or NULL when idle.
    CurrentTurnId   Nullable(String)       CODEC(ZSTD(1)),
    LastError       Nullable(String)       CODEC(ZSTD(1)),

    CreatedAt       DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt       DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    -- Soft-delete marker. "Delete conversation" is archive, not hard delete.
    ArchivedAt      Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    -- Highest event occurredAt applied — the fold's out-of-order guard.
    LastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1)),

    -- The conversation-list read filters by owner (or shared) and orders by
    -- last activity; bloom-index UserId so per-user list scans prune granules.
    INDEX idx_langy_conv_user_id UserId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_langy_conv_status Status TYPE set(8) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(CreatedAt)
ORDER BY (TenantId, ConversationId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migration is intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.langy_conversations;
-- +goose StatementEnd

-- +goose ENVSUB OFF
