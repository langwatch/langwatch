-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_analytics — make row ABSENCE mean something.
--
-- The store's persistable-signal gate (traceAnalytics.store.ts) declines to
-- write a state whose only signal is a dimension (topic / annotation / name —
-- no span, no log record). That kept phantom "traces" out of analytics, but it
-- made absence ambiguous: a missing row could mean "new aggregate" OR "we
-- declined to persist this". The executor therefore could not trust a store
-- miss, and answered every one with an unwindowed fallback read plus a full
-- re-fold from `event_log`. Measured in production over 30 days:
--
--   es_fold_read_window_fallback_total{traceAnalytics}: 150,573 unwindowed
--     retries, outcome "recovered" = 0 — not one found a row the 7-day
--     window had missed.
--   es_fold_refold_on_miss_total{traceAnalytics}: ~111/min re-folds, 93.1%
--     of a 962-refold sample returning exactly the events the queue had
--     already delivered.
--
-- `HasSignal` splits the two meanings apart. The store now ALWAYS writes the
-- row and carries the gate's verdict in this column instead: analytics readers
-- add `AND HasSignal` and see exactly the population they saw before; the fold
-- read-back reads the row unfiltered, so a committed state always has a row
-- and absence is authoritative. DEFAULT 1 because every row an old build wrote
-- had, by construction, passed the gate.
--
-- During the deploy window a new-build worker inserts these columns against an
-- un-migrated table and FAILS (input_format_skip_unknown_fields: 0, see
-- READ_BACK_FOLD_INSERT_SETTINGS) — deliberate, same fail-and-retry shape as
-- the 00056 columns: the job retries on the queue's backoff and recovers the
-- moment the app pod's boot applies this file.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS HasSignal Bool DEFAULT 1;
-- +goose StatementEnd

-- ============================================================================
-- `WriterNonce` — a per-write identity for the LWW tiebreak.
--
-- `queryLatestVersion` picks the winning row version with a best-effort
-- progress ranking (LastEventOccurredAt, SpanCount, watermark length) and its
-- own comment names the residual: two writers resuming from the same committed
-- version can produce rows equal on every key, and `LIMIT 1` then picks
-- ARBITRARILY — a different winner per read, so the fold can resume from one
-- version and rewrite the other's contributions. The memory-pressure cascade
-- manufactures exactly that precondition (killed worker's in-flight insert
-- lands after its replacement resumed). A random nonce written with every row
-- version makes the final pick DETERMINISTIC: still not provably "the most
-- complete" — no key can know that — but stable across reads, which is what
-- the applied-event-id dedup needs to stay coherent. DEFAULT '' ranks every
-- pre-existing row version below any nonce-carrying one.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS WriterNonce String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  DROP COLUMN IF EXISTS HasSignal;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  DROP COLUMN IF EXISTS WriterNonce;
-- +goose StatementEnd
