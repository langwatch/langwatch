-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- instant_eval_judgments, one verdict per Instant Eval run, trace and question.
--
-- Written by the page intent of the instant-eval-processing process manager
-- (process-manager/instantEvalIntentHandlers.ts) through
-- instant-eval-judgments.repository.ts: one row per judged row per question of
-- a run, written before the page is recorded as judged.
--
-- The grain is (TenantId, RunId, TraceId, SpanId, QuestionId) because a run
-- asks several questions of one text and each answer is read on its own: a
-- query counting labels of one question must not have to unnest the others.
--
-- SpanId is in the key rather than beside it because a statement is not
-- required to have one row per trace. One over analytics.spans projects one
-- row per span, so several judgements share a TraceId, and a key without
-- SpanId would collapse every span of a trace into one row per question.
-- A statement whose rows are one per trace writes the empty string there,
-- which keys it exactly as it would have been keyed without the column.
--
-- ReplacingMergeTree gives the exactly-once effect the queue needs. A page that
-- failed halfway is thrown so the outbox delivers it again, and the second
-- delivery re-inserts the same keys; collapsing to the latest UpdatedAt leaves
-- one row per verdict either way. Reads MUST be replacement-aware (argMax or
-- FINAL): the dedup is eventual, not immediate.
--
-- NO JUDGED TEXT IS STORED. A verdict is a probability, a score or a label, and
-- the text it was formed from lives in the trace it came from. Keeping a copy
-- here would duplicate customer content into a table with its own retention and
-- its own row policy, for a value the sample endpoint re-reads from the trace
-- on demand. That is also why this table declares no content gate in the
-- LangWatchQL catalog.
--
-- NO TOKEN COUNT EITHER, and that is not an omission. One classifier request
-- answers every question about one text, and one text can be a whole
-- conversation covering many traces, so a per-trace-per-question token count
-- would be the same number copied across rows that did not each cost it. What a
-- run spent is a property of the run, and the run's own row carries it.
--
-- Retention: `_retention_days` defaults to 0, the indefinite sentinel
-- (`buildRetentionTTLExpression` maps 0 to a year-2106 expiry), so nothing here
-- is deleted on a timer until a write path stamps a day count. The table joins
-- INDEFINITE_DEFAULT_RETENTION_TABLES rather than the customer-facing
-- RETENTION_MANAGED_TABLES: the customer cascade's categories are traces,
-- scenarios and experiments, its floor is the 49-day platform default, and
-- membership also enrolls a table in the customer storage meter. None of those
-- is what a judgement wants yet. The TTL clause below is character-for-character
-- what `buildRetentionTTLExpression` emits for this table's TABLE_TTL_CONFIG
-- entry, so the reconciler's first pass finds the clause already correct and
-- issues no ALTER of its own.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL to every node itself.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.instant_eval_judgments
(
    -- Multitenancy boundary (TenantId = projectId); every query MUST filter on
    -- TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- The run that asked, and the question it asked. The question id is the
    -- statement's own output column alias, which is unique within a statement
    -- and is what a caller reads the answer back by.
    RunId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    QuestionId String CODEC(ZSTD(1)),

    -- Where the judged text came from, when the statement projected it. Empty
    -- when it did not: a trace-level statement has no thread, and only a
    -- span-level one has a span. SpanId is part of the sort key, so the
    -- empty string is what makes a trace-level judgement key on the trace.
    ThreadId String DEFAULT '' CODEC(ZSTD(1)),
    SpanId String DEFAULT '' CODEC(ZSTD(1)),

    -- What was asked: boolean, score or category.
    Kind LowCardinality(String) CODEC(ZSTD(1)),

    -- Whether it was answered: judged, skipped or failed. A skip is a real
    -- answer of "we did not judge this", which is why it is a status rather
    -- than an absent row.
    Status LowCardinality(String) CODEC(ZSTD(1)),

    -- The verdict, split by what each kind fills. Nullable rather than
    -- defaulted: a boolean question has no score, and a zero would read as one.
    Passed Nullable(UInt8) CODEC(ZSTD(1)),
    Score Nullable(Float64) CODEC(ZSTD(1)),
    Label String DEFAULT '' CODEC(ZSTD(1)),
    Probability Nullable(Float64) CODEC(ZSTD(1)),

    -- The full distribution of a category answer, as a JSON object of option
    -- name to probability. A string rather than a Map so the column round-trips
    -- through the API and the CLI as the JSON the classifier reported.
    Probabilities String DEFAULT '' CODEC(ZSTD(1)),

    -- Why a skipped or failed judgement has no verdict. A classifier skip
    -- reason, never a driver diagnostic.
    Error String DEFAULT '' CODEC(ZSTD(1)),

    -- When the judged row happened, carried from the statement so a judgement
    -- can be joined to a trace inside a bounded period.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- When the judgement was written. The partition key and the dataset's
    -- partition-pruning time column.
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- The ReplacingMergeTree version column.
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(CreatedAt)
ORDER BY (TenantId, RunId, TraceId, SpanId, QuestionId)
TTL IF(_retention_days > 0, toDateTime(CreatedAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.instant_eval_judgments;
-- +goose StatementEnd

-- +goose ENVSUB OFF
