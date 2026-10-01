-- +goose Up
-- +goose ENVSUB ON

-- Activity Monitor / D2 foundation:
--   gateway_activity_events captures normalised AI activity events
--   from every IngestionSource (Tier C/D platforms — Cowork, Workato,
--   Copilot Studio, OpenAI Compliance, Claude Compliance, S3 custom,
--   generic OTel passthrough). Each receiver normalises its
--   platform-specific shape into OCSF + AOS fields before inserting.
--
-- Tenancy: TenantId = IngestionSource.id (NOT projectId — these
-- events have no project context). OrganizationId is denormalised
-- onto the row so admin oversight queries can filter cross-source.
-- This complements trace_summaries for SourceType='gateway' (the
-- LangWatch-proxied path) which uses projectId as TenantId.
--
-- See:
--   specs/ai-gateway/governance/activity-monitor.feature
--   specs/ai-gateway/governance/ingestion-sources.feature
--   docs/ai-gateway/governance/architecture.md (OCSF + AOS schema section)

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_activity_events
(
    -- Multitenancy boundary — every query MUST filter on TenantId.
    -- For ingest events: TenantId = IngestionSource.id.
    -- (For gateway-originated events trace_summaries already exists
    --  with TenantId = projectId; we don't double-write here.)
    TenantId String CODEC(ZSTD(1)),

    -- Denormalised org id so admin oversight queries can roll up
    -- across all sources in an org without fanning out to PG to
    -- resolve every source-id to its org first.
    OrganizationId String CODEC(ZSTD(1)),

    -- Source classification — matches trace_summaries.SourceType
    -- (migration 00018) for cross-table query consistency.
    SourceType LowCardinality(String),
    SourceId String CODEC(ZSTD(1)),

    -- Event identity (idempotency anchor for ReplacingMergeTree)
    EventId String CODEC(ZSTD(1)),

    -- OCSF API Activity (class 6003) extended with AOS verb taxonomy.
    -- Common values: 'api.call', 'agent.action', 'tool.invocation',
    -- 'auth.signin', 'auth.signout', 'admin.config_change'.
    EventType LowCardinality(String),

    -- OCSF Actor / Target / Action triple
    Actor String DEFAULT '' CODEC(ZSTD(1)),       -- user email or principal id
    Action String DEFAULT '' CODEC(ZSTD(1)),      -- the verb in this domain
    Target String DEFAULT '' CODEC(ZSTD(1)),      -- model / tool / resource

    -- Optional AOS cost + token attribution
    CostUSD Decimal(18, 6) DEFAULT 0 CODEC(ZSTD(1)),
    TokensInput UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    TokensOutput UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),

    -- Forensic copy of the upstream event (truncated to 64KB to keep
    -- partition size predictable). Admin UI shows side-by-side raw +
    -- normalised on the per-source detail page.
    RawPayload String DEFAULT '' CODEC(ZSTD(1)),

    -- Timing — EventTimestamp is the partition key + sort-key leaf
    -- so range queries prune partitions and read only the relevant
    -- granules. IngestedAt is when LangWatch received the event
    -- (post-normalisation), useful for SLO + lag dashboards.
    EventTimestamp DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    IngestedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_org (OrganizationId) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_actor (Actor) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_event_type (EventType) TYPE set(0) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}IngestedAt)
PARTITION BY toYYYYMM(EventTimestamp)
ORDER BY (TenantId, EventTimestamp, EventId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. DROP TABLE is irreversible
-- (data loss). Down migrations are intentionally commented out per
-- LangWatch CLAUDE.md guidance.
--
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_activity_events;
