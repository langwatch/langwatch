-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- evaluation_analytics — ADR-034 Phase 6 slim per-evaluation analytics table.
--
-- A FOLD projection writes one row per evaluation (latest version wins) into
-- this ReplacingMergeTree(UpdatedAt). Genuinely SLIM — not "evaluation_runs
-- minus heavy text". Drops the heavy free-text fields (Inputs, Details, Error,
-- ErrorDetails) entirely, hoists the late/derived dimensions onto typed
-- columns at the root (TraceId, UserId, ConversationId, CustomerId, Origin,
-- Model, Label, Passed), and HEURISTICALLY trims the Attributes map at fold
-- time (same `analytics-attribute-trim.service.ts` the trace slim uses).
-- Queries that need the dropped fields fall back to `evaluation_runs` (Phase 6
-- read routing).
--
-- The evaluation-run fold (evaluationRun.foldProjection.ts) reads + folds the
-- same events. Slim's fold reuses the same service-level handlers / lift logic
-- (cross-pipeline `TraceSummaryStore.get` for the run-level dim columns) so
-- the VALUES it does carry match `evaluation_runs` to the cent for the shared
-- fields. Per-domain enrichment (the userId / conversationId / customerId
-- hoist) reads off the run's trace fold, not the evaluation events themselves,
-- because the eval events do not carry trace-level dims.
--
-- Engine / partition / order / retention column mirror evaluation_runs +
-- trace_analytics:
--   * `ReplacingMergeTree(UpdatedAt)` — re-folds replay-safely dedup to the
--     latest version per (TenantId, EvaluationId) — same LWW column as
--     trace_analytics (00037). The Version column is the schema-snapshot
--     identifier (calendar date string).
--   * `PARTITION BY toYearWeek(OccurredAt)` matches trace_analytics so
--     partitions age and roll off in the same weekly cadence.
--   * `ORDER BY (TenantId, OccurredAt, EvaluationId)` — TIME-LEADING (unlike
--     evaluation_runs' `(TenantId, EvaluationId)` which is point-lookup
--     sorted). Analytics scans are time-bounded, not per-eval, so the sort
--     order is reorganised around `OccurredAt` to make range scans
--     monotonic over the part.
--   * `_retention_days` is the same UInt16 DEFAULT 308 as 00032 stamps on
--     every retention-managed table. Inline TTL on this CREATE drops rows
--     `_retention_days` days after their `OccurredAt`.
--
-- Bloom indexes on `mapKeys(Attributes)` + `mapValues(Attributes)` mirror
-- trace_analytics (00037) so analytics filters on a metadata key / value get
-- index pruning. GRANULARITY 1 = check the bloom filter at the finest level —
-- small payload, fast skip on misses. The Attributes map itself is bounded by
-- `trimAttributesForAnalytics` (4 KiB hard cap on metadata.* values; 256-char
-- cap on arbitrary keys; payload keys dropped).
--
-- Phase 6 will route eval-metric `getTimeseries` reads here behind the
-- existing `release_event_sourced_analytics_read` flag. Until then this table
-- is dual-tap only — write the slim row on every relevant event; nothing
-- reads it yet beyond the Phase 5/6 heartbeat's source-aware recency check
-- and the eval-graph-trigger reactor.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics
(
    -- Keys: same shape as evaluation_runs' so a row is addressable identically.
    -- ProjectionId is omitted (slim has no need to be addressed by a
    -- deterministic non-(TenantId, EvaluationId) key — the version dedup runs
    -- on the primary key).
    TenantId String CODEC(ZSTD(1)),
    EvaluationId String CODEC(ZSTD(1)),
    -- Schema-snapshot identifier (calendar date string) matching
    -- evaluation_runs.Version (LowCardinality(String) CODEC(ZSTD(1))). NOT the
    -- ReplacingMergeTree LWW key — CH rejects LowCardinality(String) for that
    -- (BAD_TYPE_OF_FIELD). Dedup engine collapses on UpdatedAt instead.
    Version LowCardinality(String) CODEC(ZSTD(1)),

    -- Evaluation's occurred-at — the partition column and the lead sort key.
    -- Stamped from the latest event's `event.occurredAt`. For terminal events
    -- (completed/reported) this is when the evaluator returned; for
    -- in-progress / scheduled-only rows (rare; the slim store skips empties)
    -- it's the latest stage transition.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Defensible bookkeeping. Same shape as evaluation_runs' columns.
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Hoisted run-level dimensions (typed columns at the root, NOT keys in
    -- the Attributes map). EvaluatorType / EvaluatorName / Status / Score /
    -- Label / Passed / TraceId / IsGuardrail come straight from the
    -- evaluation events themselves; UserId / ConversationId / CustomerId /
    -- Origin are hoisted from the trace's fold at slim write time (cross-
    -- pipeline lift — same pattern the eval alert reactor uses).
    --
    -- Model: the model the evaluator USED (not the model under evaluation).
    -- '' when not recorded. Future-friendly for "which judge model" group-bys.
    EvaluatorType LowCardinality(String),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    Status LowCardinality(String),
    IsGuardrail Bool,
    Passed Nullable(Bool),
    Score Nullable(Float64),
    Label Nullable(String) CODEC(ZSTD(1)),
    Model Nullable(String) CODEC(ZSTD(1)),
    TraceId Nullable(String) CODEC(ZSTD(1)),
    UserId Nullable(String) CODEC(ZSTD(1)),
    ConversationId Nullable(String) CODEC(ZSTD(1)),
    CustomerId Nullable(String) CODEC(ZSTD(1)),
    Origin Nullable(String) CODEC(ZSTD(1)),

    -- Metric scalars. DurationMs = completedAt - startedAt (0 for atomic
    -- reported events). TotalCost / NonBilledCost flow off the CostId record
    -- when present.
    DurationMs Int64 CODEC(Delta(8), ZSTD(1)),
    TotalCost Nullable(Float64) CODEC(ZSTD(1)),
    NonBilledCost Nullable(Float64) CODEC(ZSTD(1)),

    -- Trimmed attributes map. Written through `trimAttributesForAnalytics`
    -- (the shared trim service from the trace slim). Same trim contract:
    --   * `metadata.*` keys are ALWAYS kept (4 KiB cap on values).
    --   * `langwatch.reserved.*` keys are ALWAYS kept (computed by us, bounded).
    --   * Any other key is kept iff value length ≤ 256 chars.
    --   * Blocklisted keys dropped REGARDLESS of length.
    Attributes Map(String, String) CODEC(ZSTD(1)),

    -- Bloom indexes on Attributes mirror trace_analytics (00037).
    INDEX idx_eval_analytics_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_eval_analytics_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    -- Mirror evaluation_runs' tenant+eval index so per-eval point-lookups
    -- still get bloom pruning despite the time-leading primary sort.
    INDEX idx_eval_analytics_tenant_eval (TenantId, EvaluationId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_eval_analytics_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_eval_analytics_evaluator_type EvaluatorType TYPE bloom_filter(0.01) GRANULARITY 4,

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
-- toYearWeek(OccurredAt) matches trace_analytics' partition expression
-- (00037). DateTime64(3) is accepted directly by toYearWeek, so no toDate(...)
-- wrap is needed.
PARTITION BY toYearWeek(OccurredAt)
-- Time-leading sort key — the whole point of the slim table. evaluation_runs'
-- (TenantId, EvaluationId) is wrong for analytics range scans; (TenantId,
-- OccurredAt, EvaluationId) keeps tenant locality but reorganises around time
-- so analytics queries pull contiguous granules instead of one row per random
-- part.
ORDER BY (TenantId, OccurredAt, EvaluationId)
-- Inline retention TTL: drop a row `_retention_days` days after its
-- OccurredAt. Mirrors the slim trace-analytics pattern (00037). OccurredAt is
-- DateTime64(3); CH rejects DateTime64 directly in TTL arithmetic, so wrap in
-- toDateTime first.
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics;
-- +goose StatementEnd

-- +goose ENVSUB OFF
