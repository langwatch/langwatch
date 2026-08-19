-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- governance_kpis: swap the ReplacingMergeTree version column from
-- LastEventOccurredAt to CreatedAt.
--
-- LastEventOccurredAt moves BACKWARD: the fold takes
-- min(occurredAt, span.startTimeUnixMs), so a later flush that folded in an
-- earlier-starting span carries a LOWER value than the flush before it.
-- ReplacingMergeTree keeps the row with the HIGHEST version at merge time,
-- so background merges keep the stale, lower-spend row and discard the
-- correct cumulative one. Reads are plain sum(SpendUsd) with no FINAL and
-- no argMax (findSpendTotals), so nothing compensates: spend, prompt tokens
-- and completion tokens all under-report after a merge.
--
-- CreatedAt (DEFAULT now64(3), never set by the writer) is a monotonic
-- server wall clock, so a later write always carries a higher version.
--
-- ClickHouse cannot ALTER the version column of a ReplacingMergeTree, so
-- the table has to be rebuilt and swapped. The statement order below is
-- 00064's (following 00058), and its two guarantees carry over:
--
--   1. Re-run safety (the runner may re-apply a partially executed file
--      after a crash): the scratch table is DROPPED and recreated rather
--      than reused, so it always has the CreatedAt engine rather than
--      whatever a previous partial run left under that name. EXCHANGE
--      TABLES is used rather than RENAME because EXCHANGE requires both
--      names to exist and leaves both existing, so re-applying converges;
--      a RENAME whose destination already exists fails and wedges the
--      migration until a human intervenes.
--
--   2. Reconciliation: the copy at step 5 reads a snapshot, so a row
--      written to governance_kpis after that SELECT begins is absent from
--      the rebuilt table. The KPI writer is event-driven per trace, NOT a
--      periodic re-emitter (governanceKpisSync.subscriber.ts: "a failure
--      in a trace's final window is not retried at all"), and it inserts
--      with async_insert = 1, wait_for_async_insert = 0, so buffered rows
--      keep landing in the pre-swap table. Without a sweep those traces
--      would contribute nothing, permanently. Step 7 runs AFTER the
--      exchange and inserts, from the pre-swap table, exactly the writes
--      the snapshot missed — matched on
--      (TenantId, SourceId, HourBucket, TraceId, CreatedAt), which
--      identifies a write rather than a key. Unlike 00064 the delta needs
--      no arithmetic, because these are whole replacing rows rather than
--      aggregate states: the missed write is simply carried over, and the
--      engine collapses it against its predecessor on the next merge.
--
-- Crash-after-exchange recovery (the loss window 00064 sidesteps by reading
-- its delta from a durable ledger, which this table does not have): if the
-- runner dies between the EXCHANGE (step 6) and the reconciliation
-- (step 7), every write from the copy window lives ONLY in the
-- exchanged-out table, now sitting under the scratch name. A re-apply that
-- dropped the scratch first — as the first draft of this file did — would
-- discard those writes permanently. Steps 1-2 close that window: before
-- anything is dropped, the re-apply reconciles whatever the scratch name
-- currently holds back into the live table. It is the same anti-join as
-- step 7 and a no-op in every state except the one it exists for:
--   - fresh run: step 1 creates an empty scratch, step 2 sweeps nothing;
--   - crashed mid-copy (pre-exchange): the scratch is a partial copy of the
--     live table, so each of its rows already matches a live
--     (key, CreatedAt) and the anti-join selects nothing;
--   - crashed after the exchange: the scratch IS the old live table, and
--     the anti-join carries exactly the copy-window writes the crash
--     stranded there back into the new live table before step 3 drops it.
-- CREATE TABLE IF NOT EXISTS at step 1 is what makes step 2 safe to run
-- unconditionally: on a re-apply the scratch already exists (with whatever
-- engine the crash left it), so the IF NOT EXISTS is a no-op and the sweep
-- reads the real stranded table rather than a freshly-emptied one.
--
-- Residual, stated rather than hidden: a row still sitting in an
-- async_insert buffer at the instant a reconciliation SELECT runs is
-- missed — bounded by async_insert_busy_timeout, not by the copy duration.
-- It is bounded and this table is derived data: it is rebuildable from
-- event_log, which is the recovery path if it fires.
--
-- Replication: governance_kpis is already declared through
-- CLICKHOUSE_ENGINE_REPLACING_PREFIX (00031), so on a cluster it is a
-- ReplicatedReplacingMergeTree and its content is identical on every
-- replica. That is why this file does not gate on
-- CLICKHOUSE_IS_REPLICATED the way a migration carrying rows over from a
-- plain-engine table must: there is no per-replica partial content to
-- read. goose runs every statement on one connection, i.e. one replica;
-- the DDL replicates through the database engine, and the INSERTs write
-- into a Replicated engine so the rows replicate to every node.
--
-- @see https://github.com/langwatch/langwatch-saas/issues/1089
-- ============================================================================

-- 1. Ensure the scratch name exists so step 2 can read it unconditionally.
--    On a fresh run this creates an empty table; on a re-apply the scratch
--    already exists (a partial copy, or — after a crash past the exchange —
--    the old live table itself), so IF NOT EXISTS is a no-op and preserves
--    whatever the crash stranded there. The engine here is provisional:
--    step 3 drops this table and step 4 recreates it, so a fresh run's
--    engine is never swapped in. This CREATE mirrors step 4 exactly.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis_v2
(
    -- identity (per-trace contribution)
    TenantId String CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),
    HourBucket DateTime CODEC(Delta(4), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),

    -- denormalised dimensions (filtered cheaply at read time)
    SourceType LowCardinality(String),

    -- per-trace contribution
    SpendUsd Float64 CODEC(ZSTD(1)),
    PromptTokens UInt64 CODEC(Delta(8), ZSTD(1)),
    CompletionTokens UInt64 CODEC(Delta(8), ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_source_type SourceType TYPE set(64) GRANULARITY 4,
    INDEX idx_hour_bucket HourBucket TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_source (TenantId, SourceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}CreatedAt)
PARTITION BY toYYYYMM(HourBucket)
ORDER BY (TenantId, SourceId, HourBucket, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- 2. Crash-after-exchange recovery. If a previous run died between the
--    exchange (step 6) and the reconciliation (step 7), the copy-window
--    writes are stranded in the exchanged-out table, now under the scratch
--    name. Carry them back into the live table BEFORE step 3 drops it.
--    Same anti-join as step 7, keyed on the full write identity
--    (TenantId, SourceId, HourBucket, TraceId, CreatedAt): a no-op on a
--    fresh run (empty scratch) and after a pre-exchange crash (the scratch
--    is a subset of the live table), and the recovery in the one case it
--    exists for.
-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.governance_kpis
    (TenantId, SourceId, HourBucket, TraceId, SourceType, SpendUsd, PromptTokens, CompletionTokens, CreatedAt, LastEventOccurredAt)
SELECT
    stranded.TenantId,
    stranded.SourceId,
    stranded.HourBucket,
    stranded.TraceId,
    stranded.SourceType,
    stranded.SpendUsd,
    stranded.PromptTokens,
    stranded.CompletionTokens,
    stranded.CreatedAt,
    stranded.LastEventOccurredAt
FROM ${CLICKHOUSE_DATABASE}.governance_kpis_v2 AS stranded
LEFT ANTI JOIN (
    SELECT TenantId, SourceId, HourBucket, TraceId, CreatedAt
    FROM ${CLICKHOUSE_DATABASE}.governance_kpis
) AS live
USING (TenantId, SourceId, HourBucket, TraceId, CreatedAt);
-- +goose StatementEnd

-- 3. Scratch is dropped, never reused: a previous partial run may have left
--    a table of the WRONG engine under this name, and rebuilding into it
--    would swap the backward-moving version column straight back in. Safe
--    now that step 2 has recovered anything the scratch was holding.
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis_v2;
-- +goose StatementEnd

-- 4. The replacement table — 00031's schema with CreatedAt as the version.
-- +goose StatementBegin
CREATE TABLE ${CLICKHOUSE_DATABASE}.governance_kpis_v2
(
    -- identity (per-trace contribution)
    TenantId String CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),
    HourBucket DateTime CODEC(Delta(4), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),

    -- denormalised dimensions (filtered cheaply at read time)
    SourceType LowCardinality(String),

    -- per-trace contribution (sum at read time across the HourBucket
    -- group to get the rollup; count(DISTINCT TraceId) for trace count)
    SpendUsd Float64 CODEC(ZSTD(1)),
    PromptTokens UInt64 CODEC(Delta(8), ZSTD(1)),
    CompletionTokens UInt64 CODEC(Delta(8), ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    LastEventOccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_source_type SourceType TYPE set(64) GRANULARITY 4,
    INDEX idx_hour_bucket HourBucket TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_source (TenantId, SourceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}CreatedAt)
PARTITION BY toYYYYMM(HourBucket)
ORDER BY (TenantId, SourceId, HourBucket, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- 5. Copy the existing rows. CreatedAt carries over from the source: it was
--    already populated by 00031's DEFAULT now64(3) at original insert time,
--    so the copied rows keep their true write order.
--    Columns are listed explicitly. `SELECT *` happens to be correct while
--    the two schemas are byte-identical, and silently stops being correct
--    the moment somebody adds a column to one of them.
-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.governance_kpis_v2
    (TenantId, SourceId, HourBucket, TraceId, SourceType, SpendUsd, PromptTokens, CompletionTokens, CreatedAt, LastEventOccurredAt)
SELECT
    TenantId,
    SourceId,
    HourBucket,
    TraceId,
    SourceType,
    SpendUsd,
    PromptTokens,
    CompletionTokens,
    CreatedAt,
    LastEventOccurredAt
FROM ${CLICKHOUSE_DATABASE}.governance_kpis;
-- +goose StatementEnd

-- 6. Atomic swap. Writes reach the rebuilt table from here on.
-- +goose StatementBegin
EXCHANGE TABLES ${CLICKHOUSE_DATABASE}.governance_kpis AND ${CLICKHOUSE_DATABASE}.governance_kpis_v2;
-- +goose StatementEnd

-- 7. Reconciliation. governance_kpis_v2 now holds the PRE-SWAP table, so
--    this sweeps the rows written to it during the copy at step 5.
--
--    It is a DELTA pass, not a re-copy. Re-inserting the whole pre-swap
--    table would be correct after a merge and wrong until one: reads are
--    plain sum(SpendUsd) with no FINAL, so every duplicated row would
--    double-count spend for as long as the duplicate parts survived.
--    (TenantId, SourceId, HourBucket, TraceId, CreatedAt) identifies a
--    write exactly — a row written during the window shares the ORDER BY
--    key with its copied predecessor but carries a strictly higher
--    CreatedAt — so the anti-join keeps precisely the writes the snapshot
--    missed, and re-running it selects nothing.
-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.governance_kpis
    (TenantId, SourceId, HourBucket, TraceId, SourceType, SpendUsd, PromptTokens, CompletionTokens, CreatedAt, LastEventOccurredAt)
SELECT
    missed.TenantId,
    missed.SourceId,
    missed.HourBucket,
    missed.TraceId,
    missed.SourceType,
    missed.SpendUsd,
    missed.PromptTokens,
    missed.CompletionTokens,
    missed.CreatedAt,
    missed.LastEventOccurredAt
FROM ${CLICKHOUSE_DATABASE}.governance_kpis_v2 AS missed
LEFT ANTI JOIN (
    SELECT TenantId, SourceId, HourBucket, TraceId, CreatedAt
    FROM ${CLICKHOUSE_DATABASE}.governance_kpis
) AS rebuilt
USING (TenantId, SourceId, HourBucket, TraceId, CreatedAt);
-- +goose StatementEnd

-- 8. Drop the pre-swap table, now fully swept into the rebuilt one.
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis_v2;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- IRREVERSIBLE: the swap discards the LastEventOccurredAt-versioned table,
-- and going back would restore a version column that moves backward and
-- under-reports spend after every merge. Rollback statements stay commented
-- out and must be applied manually if ever needed; the table is derived
-- data and the supported recovery path is a rebuild from event_log.
