-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_analytics — ADR-034 Phase 2 slim per-trace analytics table.
--
-- A FOLD projection writes one row per trace (latest version wins) into this
-- ReplacingMergeTree(Version). Genuinely SLIM — not "trace_summaries minus
-- I/O". Drops heavy artifacts (ComputedInput / ComputedOutput / ErrorMessage /
-- AnnotationIds / prompt-rollup details / Events / Links) entirely, hoists the
-- late/derived dimensions onto typed columns at the root (TopicId, SubTopicId,
-- UserId, ConversationId, CustomerId, Origin, Models, Labels, TraceName), and
-- HEURISTICALLY trims the Attributes map at fold time (see
-- analytics-attribute-trim.service.ts). Queries that need the dropped or
-- trimmed fields fall back to trace_summaries (Phase 3 read routing).
--
-- The trace-summary fold (~250 LoC + many services) reads + folds the same
-- events. Slim's fold reuses the same service instances (SpanCostService,
-- SpanTimingService, SpanStatusService, TraceOriginService, etc.) so the
-- VALUES it does carry match trace_summaries to the cent — slim is "the same
-- data, less of it", not "different data, computed differently".
--
-- Engine / partition / order / retention column mirror trace_summaries:
--   * `ReplacingMergeTree(UpdatedAt)` — re-folds replay-safely dedup to the
--     latest version per (TenantId, TraceId) — ADR-021 / ADR-022 semantics.
--     Same LWW column as trace_summaries (00002_create_schema.sql:178). The
--     Version column on the table is the schema-snapshot identifier (calendar
--     date string) so a fold can address which schema version produced the
--     row, but the dedup engine collapses on `UpdatedAt` — ClickHouse rejects
--     LowCardinality(String) as a version column for ReplacingMergeTree
--     (BAD_TYPE_OF_FIELD), and the trace-summary fold uses UpdatedAt for the
--     same reason. UpdatedAt is guaranteed monotonic by
--     AbstractFoldProjection.apply (Math.max(Date.now(), prev + 1)) so the
--     IN-tuple dedup pattern recommended by clickhouse-queries.md is safe.
--   * `PARTITION BY toYearWeek(OccurredAt)` matches trace_summaries (line
--     179 of 00002_create_schema.sql) so partitions age and roll off in the
--     same weekly cadence. Time-range reads prune partitions; cold-tier
--     boundaries align with the source.
--   * `ORDER BY (TenantId, OccurredAt, TraceId)` — TIME-LEADING (unlike
--     trace_summaries' `(TenantId, TraceId)` which is point-lookup-sorted).
--     This is the whole point of the slim table: analytics scans are
--     time-bounded, not per-trace, so the sort order is reorganised around
--     `OccurredAt` to make range scans monotonic over the part.
--   * `_retention_days` is the same UInt16 DEFAULT 308 (= 10 months;
--     MIGRATION_DEFAULT_RETENTION_DAYS; partition-aligned) as 00032 stamps on
--     every retention-managed table. Inline TTL on this CREATE drops rows
--     `_retention_days` days after their `OccurredAt` — the same Phase 1
--     pattern (00035) used, and the same semantics ttlReconciler applies to
--     trace_summaries at runtime. No cold-storage MOVE clause: slim rows
--     are tiny, always warm, and the rollup's pattern (no MOVE) fits.
--
-- Bloom indexes on `mapKeys(Attributes)` + `mapValues(Attributes)` mirror
-- stored_spans (00002_create_schema.sql:111-112) so analytics filters on
-- a metadata key / value get index pruning. GRANULARITY 1 = check the
-- bloom filter at the finest level — small payload, fast skip on misses.
-- The Attributes map itself is bounded by `trimAttributesForAnalytics`
-- (4 KiB hard cap on metadata.* values; 256-char cap on arbitrary keys;
-- payload keys like `gen_ai.prompt` / `gen_ai.completion` dropped).
--
-- Phase 3 will repoint `getTimeseries` reads here (behind a Project flag).
-- Phase 2 is dual-tap only — write the slim row on every relevant event;
-- nothing reads it yet. ttlReconciler + RETENTION_TABLE_CATEGORY_MAP are
-- already wired (category: "traces") so retention reconciliation +
-- retroactive _retention_days updates apply automatically.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics
(
    -- Keys: same shape as trace_summaries' so a row is addressable identically.
    -- ProjectionId is omitted (slim has no need to be addressed by a deterministic
    -- non-(TenantId, TraceId) key — the version dedup runs on the primary key).
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    -- Schema-snapshot identifier (calendar date string) matching
    -- trace_summaries.Version (LowCardinality(String) CODEC(ZSTD(1))). NOT the
    -- ReplacingMergeTree LWW key — CH rejects LowCardinality(String) for that
    -- (BAD_TYPE_OF_FIELD). Dedup engine collapses on UpdatedAt instead, same
    -- as trace_summaries (00002_create_schema.sql:178).
    Version LowCardinality(String) CODEC(ZSTD(1)),

    -- Trace's occurred-at — the partition column and the lead sort key. Mirrors
    -- trace_summaries.OccurredAt's type + codec.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Defensible bookkeeping. Same shape as trace_summaries' columns so
    -- monitors and reconcilers that read either table treat the timestamps
    -- identically.
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Hoisted dimensions (typed columns at the root, NOT keys in the
    -- Attributes map). The fold extracts these from the per-span / per-log
    -- accumulated attribute map written by the trace-summary fold's
    -- TraceAttributeAccumulationService + TraceOriginService.
    --
    --   TraceName     ← TraceNameResolutionService (root span name, fallback to
    --                   earliest span, overridden by user via TraceNameChanged).
    --   TopicId       ← TopicAssignedEvent (assignTopic command).
    --   SubTopicId    ← TopicAssignedEvent (assignTopic command).
    --   UserId        ← langwatch.user_id (canonical key, hoisted from
    --                   langwatch.user.id / langwatch.user_id / metadata.user_id
    --                   sources by RESOURCE_ATTR_CANONICAL_MAPPINGS in
    --                   trace-attribute-accumulation.service.ts:62-78).
    --   ConversationId ← gen_ai.conversation.id (canonical key, hoisted from
    --                   langwatch.thread.id / langwatch.thread_id /
    --                   langwatch.langgraph.thread_id / metadata.thread_id
    --                   sources by the same mapping table; line 62-70).
    --   CustomerId    ← langwatch.customer_id (canonical key, hoisted from
    --                   langwatch.customer.id / langwatch.customer_id /
    --                   metadata.customer_id sources by the same mapping table;
    --                   line 79-86).
    --   Origin        ← langwatch.origin (TraceOriginService.hoistOrigin, with
    --                   the provisional "application" overridden by the root
    --                   span's real marker — flips during the fold).
    --   Models        ← state.models (mergeModelsMostRecentFirst across spans).
    --   Labels        ← langwatch.labels parsed as JSON array of strings
    --                   (union across spans, computed at fold time from the
    --                   merged langwatch.labels attribute).
    TraceName String CODEC(ZSTD(1)),
    TopicId Nullable(String) CODEC(ZSTD(1)),
    SubTopicId Nullable(String) CODEC(ZSTD(1)),
    UserId Nullable(String) CODEC(ZSTD(1)),
    ConversationId Nullable(String) CODEC(ZSTD(1)),
    CustomerId Nullable(String) CODEC(ZSTD(1)),
    Origin String CODEC(ZSTD(1)),
    Models Array(String) CODEC(ZSTD(1)),
    Labels Array(String) CODEC(ZSTD(1)),

    -- Metrics (scalar). Types + nullability mirror trace_summaries:
    -- - Float64 cost; UInt32 token counts; Int64 duration; UInt32 TTFT / TPS.
    -- - HasError / HasAnnotation collapse the trace_summaries
    --   ContainsErrorStatus + AnnotationIds details into booleans (slim doesn't
    --   carry the array; HasAnnotation = `AnnotationIds.length > 0` at fold time).
    TotalCost Nullable(Float64) CODEC(ZSTD(1)),
    NonBilledCost Nullable(Float64) CODEC(ZSTD(1)),
    TotalDurationMs Int64 CODEC(Delta(8), ZSTD(1)),
    TimeToFirstTokenMs Nullable(UInt32) CODEC(Delta(4), ZSTD(1)),
    TokensPerSecond Nullable(UInt32) CODEC(ZSTD(1)),
    PromptTokens Nullable(UInt32) CODEC(ZSTD(1)),
    CompletionTokens Nullable(UInt32) CODEC(ZSTD(1)),
    CacheReadTokens Nullable(UInt32) CODEC(ZSTD(1)),
    CacheWriteTokens Nullable(UInt32) CODEC(ZSTD(1)),
    ReasoningTokens Nullable(UInt32) CODEC(ZSTD(1)),
    HasError Bool,
    HasAnnotation Nullable(Bool),

    -- Trimmed attributes map. Written through `trimAttributesForAnalytics`
    -- (analytics-attribute-trim.service.ts) so:
    --   * `metadata.*` keys are ALWAYS kept (4 KiB cap on values — long blobs
    --     truncate to 4096 chars + "…" so truncation is visible).
    --   * `langwatch.reserved.*` keys are ALWAYS kept (computed by us, bounded).
    --   * Any other key is kept iff value length ≤ 256 chars.
    --   * Blocklisted keys (`gen_ai.prompt`, `gen_ai.completion`,
    --     `gen_ai.response.choices`, `gen_ai.response.finish_reasons`) are
    --     dropped REGARDLESS of length — they're known payload, not dimensions.
    Attributes Map(String, String) CODEC(ZSTD(1)),

    -- Bloom indexes on Attributes mirror stored_spans (00002_create_schema.sql:
    -- 111-112) so analytics filters on a custom metadata key / value still get
    -- index pruning even after the trim. GRANULARITY 1 = check the bloom at the
    -- finest level — cheapest possible skip on misses.
    INDEX idx_trace_analytics_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_trace_analytics_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    -- Mirror trace_summaries' tenant+trace index so per-trace point-lookups
    -- (rare on this table, but inevitable for debugging) still get bloom
    -- pruning despite the time-leading primary sort.
    INDEX idx_trace_analytics_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1,
    -- Topic / models filters are the common slim queries (group-by topic, plot
    -- cost-by-model), so mirror the trace_summaries indexes on those columns.
    INDEX idx_trace_analytics_topic_id TopicId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_trace_analytics_models Models TYPE bloom_filter(0.01) GRANULARITY 4,

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    -- Same column shape as every other retention-managed table.
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
-- toYearWeek(OccurredAt) is exactly trace_summaries' partition expression
-- (00002_create_schema.sql:179) — same weekly cadence, same cold-tier rhythm.
-- DateTime64(3) is accepted directly by toYearWeek, so no toDate(...) wrap is
-- needed (Phase 1's 00035 wrapped because the comment justified it on its
-- BucketStart; here we match trace_summaries' exact form).
PARTITION BY toYearWeek(OccurredAt)
-- Time-leading sort key — the whole point of the slim table. trace_summaries'
-- (TenantId, TraceId) is wrong for analytics range scans; (TenantId, OccurredAt,
-- TraceId) keeps tenant locality but reorganises around time so analytics
-- queries pull contiguous granules instead of one row per random part.
ORDER BY (TenantId, OccurredAt, TraceId)
-- Inline retention TTL: drop a row `_retention_days` days after its OccurredAt.
-- Mirrors the rollup's pattern (00035) and the semantics ttlReconciler applies
-- to trace_summaries at runtime. OccurredAt is DateTime64(3); CH rejects
-- DateTime64 directly in TTL arithmetic, so wrap in toDateTime first.
TTL toDateTime(OccurredAt) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics;
-- +goose StatementEnd

-- +goose ENVSUB OFF
