-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_topic_names: trace's fold of topic's `topics_recorded` fact, so the
-- trace list labels topic facets without a TopicApi read (round 23).
--
-- Written only by trace's peer fold (trace_topic_names.topicNames), one row per
-- topic and change. A REPLACE that drops a topic writes a row with IsRemoved = 1
-- for it, as topic's own fold drops it from the model and main deleted it.
--
-- ReplacingMergeTree on UpdatedAt, which the fold raises on every write for a
-- project, so the newest row per (TenantId, TopicId) wins. Reads MUST be
-- replacement-aware (an IN-tuple on max(UpdatedAt)): the dedup is eventual.
--
-- Not partitioned and no TTL: a project holds a few hundred topics at most and
-- topic keeps no retention on them either. Not enrolled in tenant retention.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL to every node itself.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_topic_names
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter on
    -- TenantId first.
    TenantId String CODEC(ZSTD(1)),
    TopicId String CODEC(ZSTD(1)),
    Name String CODEC(ZSTD(1)),
    -- The parent topic for a subtopic; NULL for a top-level topic.
    ParentId Nullable(String) CODEC(ZSTD(1)),
    -- 1 when the topic left the model on a REPLACE.
    IsRemoved UInt8 DEFAULT 0 CODEC(ZSTD(1)),
    -- The business time of the newest topic fact folded when the row was written.
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- The ReplacingMergeTree version column.
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
ORDER BY (TenantId, TopicId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_topic_names;
-- +goose StatementEnd

-- +goose ENVSUB OFF
