-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- eval_results, every Instant Evals judgment, recalled before judging (ADR-189).
--
-- One row per judgment of one trace (or span) by one question and one judge
-- model, whoever asked: a quick eval() ask, a run, a dashboard widget or a
-- monitor on the Instant Evals judge. Before judging, the instant-eval module
-- looks up a matching row and reuses it; it judges only the misses and writes
-- them in one bulk insert. Owned by instant-eval; other modules read it through
-- InstantEvalApi.
--
-- The sort key leads with the trace, so the recall lookup and the trace page's
-- read are both prefix reads. InputHash is in the key so a question asked of a
-- trace's input and of its output are two rows, never one. JudgedAt ends the key
-- so every judgment is kept: a judge is not deterministic, and a re-judgment of
-- the same trace by the same source adds a row rather than replacing one. A
-- redelivered insert carries the same JudgedAt, so the replacing merge collapses
-- it. Reads MUST be replacement-aware (argMax or FINAL) and take the latest row
-- by JudgedAt.
--
-- KeyVersion is the version of the recall key's hashing. Recall reads only rows
-- of the current version, so rows written before recall is switched on, or
-- under a key bug, are never served; bumping the version retires them.
--
-- NO JUDGED TEXT IS STORED, as in 00097. InputHash is a hash of the text, not
-- the text. A judgment of free text with no trace is not stored.
--
-- No Passed column: a pass is Probability against the reader's threshold, so
-- two readers with different thresholds share one judge call.
--
-- Retention follows the trace: partition and TTL anchor on OccurredAt, the
-- trace's time, as trace_summaries does. The table is in
-- RETENTION_TABLE_CATEGORY_MAP under "traces". The TTL clause below is
-- character-for-character what `buildRetentionTTLExpression` emits for this
-- table's TABLE_TTL_CONFIG entry, so the reconciler's first pass issues no ALTER.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL to every node itself.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.eval_results
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter on
    -- TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- What was judged. SpanId and ThreadId are empty when the statement did not
    -- project them, as in 00097.
    TraceId String CODEC(ZSTD(1)),
    SpanId String DEFAULT '' CODEC(ZSTD(1)),
    ThreadId String DEFAULT '' CODEC(ZSTD(1)),

    -- What was asked. QuestionHash is sha256 of the normalised kind, text,
    -- criteria, range and categories; the statement's column alias is not in it.
    QuestionHash String CODEC(ZSTD(1)),
    Question String CODEC(ZSTD(3)),
    Kind LowCardinality(String) CODEC(ZSTD(1)),

    -- The resolved decision model and its version (ADR-182).
    JudgeModel LowCardinality(String) CODEC(ZSTD(1)),

    -- sha256 of the judged column name and the judged text.
    InputHash String DEFAULT '' CODEC(ZSTD(1)),

    -- The version of the recall key's hashing.
    KeyVersion UInt16 CODEC(ZSTD(1)),

    -- Who asked: ask, run, dashboard or monitor, and the id of that query, run,
    -- widget or monitor. A label only: recall never keys on it.
    Source LowCardinality(String) CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),

    -- The verdict, as in 00097. Recall reuses only Status = judged.
    Status LowCardinality(String) CODEC(ZSTD(1)),
    Score Nullable(Float64) CODEC(ZSTD(1)),
    Label String DEFAULT '' CODEC(ZSTD(1)),
    Probability Nullable(Float64) CODEC(ZSTD(1)),
    Probabilities String DEFAULT '' CODEC(ZSTD(1)),
    Error String DEFAULT '' CODEC(ZSTD(1)),

    -- The trace's time: the partition key and the TTL anchor.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- When the judge answered; "latest" means this.
    JudgedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- The ReplacingMergeTree version column.
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1)),

    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_question_hash QuestionHash TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, TraceId, SpanId, QuestionHash, JudgeModel, InputHash, SourceId, JudgedAt)
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.eval_results;
-- +goose StatementEnd

-- +goose ENVSUB OFF
