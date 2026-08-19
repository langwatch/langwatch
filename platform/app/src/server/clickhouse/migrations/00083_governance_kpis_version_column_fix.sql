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
-- ClickHouse cannot ALTER the version column of a ReplacingMergeTree, so the
-- table is rebuilt into a scratch copy and swapped in with EXCHANGE TABLES.
--
-- ----------------------------------------------------------------------------
-- PRECONDITION: the KPI writer MUST be quiesced before this runs.
-- ----------------------------------------------------------------------------
-- This is a copy-and-swap of a live table. The KPI writer
-- (governanceKpisSync.subscriber.ts, in the `workers` deployment) inserts
-- with async_insert = 1, wait_for_async_insert = 0 and is event-driven per
-- trace: "a failure in a trace's final window is not retried at all". So a
-- contribution written between the copy (step 3) and the drop (step 5)
-- lands only in the pre-swap table and is discarded permanently when that
-- table is dropped — there is no re-emit to heal it.
--
-- Earlier drafts tried to reconcile that window from the exchanged-out table
-- after the swap. That cannot be made lossless from inside a linear
-- migration: an async_insert buffer accepted before the exchange can still
-- flush into the pre-swap table AFTER the reconciliation read, and the drop
-- then discards it. Every reconciliation attempt only narrowed the race; it
-- never closed it. The correct fix is to remove the concurrency, not chase
-- it — so this migration carries no reconciliation and instead REQUIRES the
-- writer to be stopped.
--
-- Operational runbook for the deploy that applies this migration:
--   1. Scale the `workers` deployment to 0 (stops the KPIs subscriber).
--   2. Wait > 60s so any accepted async_insert buffer has flushed to the
--      table (bounded by async_insert_busy_timeout, ~1s, with margin).
--   3. Apply this migration.
--   4. Scale `workers` back up. It resumes from event_log; governance_kpis is
--      derived data, so the paused interval folds forward with no loss.
--
-- Step 0 GUARDS this precondition: it aborts the migration if governance_kpis
-- shows a write in the last 60s, so an operator who forgets to quiesce gets a
-- failed migration BEFORE any DDL rather than silent data loss. It is a
-- heuristic backstop, not a substitute for the runbook: CreatedAt is server
-- wall clock at insert, so "a fresh CreatedAt" means "a recent write", but a
-- writer paused for under 60s, clock skew, or a write buffered on another
-- replica can still slip past it. Quiesce first; do not lean on the guard.
--
-- Re-run safety (the runner may re-apply a partially executed file after a
-- crash): the scratch table is DROPPED and recreated rather than reused, so
-- it always carries the CreatedAt engine rather than whatever a previous
-- partial run left under that name. EXCHANGE TABLES (not RENAME) requires
-- both names to exist and leaves both existing, so re-applying converges; a
-- RENAME whose destination already exists fails and wedges the migration.
-- Because the writer is quiesced there are no concurrent writes, so a
-- re-apply re-copies the same rows and converges on the same state.
--
-- Replication: governance_kpis is already declared through
-- CLICKHOUSE_ENGINE_REPLACING_PREFIX (00031), so on a cluster it is a
-- ReplicatedReplacingMergeTree with identical content on every replica. This
-- file does not gate on CLICKHOUSE_IS_REPLICATED the way a migration carrying
-- rows over from a plain-engine table must: there is no per-replica partial
-- content to read. goose runs every statement on one connection (one
-- replica); the DDL replicates through the database engine, and the INSERT
-- writes into a Replicated engine so the rows replicate to every node.
--
-- @see https://github.com/langwatch/langwatch-saas/issues/1089
-- ============================================================================

-- 0. Guard the quiesce precondition. throwIf aborts the migration (and marks
--    it un-applied) if governance_kpis received a write in the last 60s,
--    which means the writer is still running. This runs before any DDL, so a
--    tripped guard leaves the table exactly as it was.
-- +goose StatementBegin
SELECT throwIf(
    (
        SELECT count()
        FROM ${CLICKHOUSE_DATABASE}.governance_kpis
        WHERE CreatedAt > now64(3) - INTERVAL 60 SECOND
    ) > 0,
    'governance_kpis received a write in the last 60s: the KPI writer is not quiesced. Scale the workers deployment to 0 and wait >60s before applying migration 00083 (see the header runbook).'
);
-- +goose StatementEnd

-- 1. Scratch is dropped, never reused: a previous partial run may have left a
--    table of the WRONG engine under this name, and rebuilding into it would
--    swap the backward-moving version column straight back in.
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_kpis_v2;
-- +goose StatementEnd

-- 2. The replacement table — 00031's schema with CreatedAt as the version.
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

-- 3. Copy the existing rows. With the writer quiesced this snapshot is the
--    whole table — nothing is landing behind it. CreatedAt carries over from
--    the source: it was already populated by 00031's DEFAULT now64(3) at
--    original insert time, so the copied rows keep their true write order.
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

-- 4. Atomic swap. governance_kpis is now the CreatedAt-versioned table.
-- +goose StatementBegin
EXCHANGE TABLES ${CLICKHOUSE_DATABASE}.governance_kpis AND ${CLICKHOUSE_DATABASE}.governance_kpis_v2;
-- +goose StatementEnd

-- 5. Drop the pre-swap table, now sitting under the scratch name. Safe: the
--    writer is quiesced, so nothing landed in it after the copy.
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
