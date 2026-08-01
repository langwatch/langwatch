-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_analytics + evaluation_analytics — read-back columns (ADR-066,
-- Pillar 1 adopters #2 and #3; the LAST two refolding folds).
--
-- Both slim folds returned null from store.get() by design, so every cache miss
-- and every out-of-order delivery refolded the aggregate's WHOLE history from
-- event_log — a no-time-filter scan that walks cold S3 partitions (1.3-2.2s per
-- query, observed continuously in prod worker logs 2026-07-24). That is the same
-- refold pattern that drove the 2026-07-23 TOO_MANY_PARTS outage on
-- codingAgentSession (migrations 00053/00054). ADR-066 makes each fold read back
-- its own last committed state instead; these columns close the round-trip gap
-- so store.get() reconstructs working state without reading event_log — for
-- every row written at the current projection version, which after one event per
-- aggregate is all of them (see the version gate at the end of this header).
--
-- Typed columns only (no JSON blob, no new table) — same shape as 00053. Each
-- ALTER is its own statement block: ClickHouse does not support multi-statement
-- queries. ms timestamps ride as UInt64 (epoch ms) rather than DateTime64 so
-- the round-trip is exact on any machine timezone — the fold compares these
-- values numerically (root-span precedence, duration), where a DateTime64
-- format-parse drift would be a real bug, not just cosmetic.
--
-- trace_analytics — the fold state the trimmed slim row could not round-trip:
--
--   SpanCount               — spans seen; drives the MAX_PROCESSED_SPANS cap AND
--                             the store's persistable-signal gate. Defaulting it
--                             to 0 would silently drop a late dimension-only
--                             event (topic / annotation) on a span-only trace.
--   AnnotationIds           — the id set behind HasAnnotation; the row carried
--                             only the boolean, so a later add/remove could not
--                             round-trip (mirrors 00053's SubAgentIds).
--   RootSpanStartTimeMs     — the canonical root's start time. The trace-name
--   TraceNameFromFallback     resolution precedence (which span owns TraceName,
--   RootMetadataFromFallback  and whether a later real root or a user rename may
--   TraceNameUserOverridden   supersede it) is gated on these four fields; losing
--                             them lets a late span clobber a user-visible name.
--   LastEventOccurredAt     — the fold's out-of-order checkpoint (trace_analytics
--                             OccurredAt is the min span time, NOT the latest
--                             event time, so it cannot double as the checkpoint).
--
--   The Attributes map is NOT re-persisted untrimmed (that heavy content is the
--   whole reason the slim table exists — ADR-022 axis). The fold only reads the
--   hoisted dimension keys (re-injected on read-back from the typed UserId /
--   ConversationId / CustomerId / Origin / Labels columns) and the
--   langwatch.reserved.* accumulators (kept verbatim by the trim contract), so
--   the trimmed column IS a faithful read-back for everything the fold consumes.
--
-- evaluation_analytics — the lifecycle timestamps DurationMs is derived from:
--
--   StartedAt / CompletedAt — DurationMs = CompletedAt - StartedAt. A `completed`
--                             event arriving after a cache miss needs the earlier
--                             `started` time to compute a non-zero duration; the
--                             row persisted only the derived DurationMs, not its
--                             operands. (scheduledAt / costId / evaluatorId feed
--                             no persisted value and default on read-back;
--                             LastEventOccurredAt reconstructs from OccurredAt,
--                             which for this fold IS the latest event time.)
--
-- Both tables also gain AppliedEventIds — the executor's redelivery-dedup
-- watermark, persisted next to the row so a retry that reaches a cold cache
-- still recognises a batch it already committed (mirrors 00054). Bounded to the
-- in-flight batch.
--
-- Old rows are NOT read back — the projection version is the discriminator.
--
-- A row written before this migration omits every column above, so ClickHouse
-- supplies the column default (0 / empty array / false / null). Those defaults
-- are indistinguishable from real values, and decoding them into fold state
-- would be actively wrong, not merely lossy:
--
--   * TraceNameUserOverridden false lets ONE late non-root span overwrite a name
--     the user typed — the resolution service no longer returns early.
--   * TraceNameFromFallback false freezes a fallback-named trace: a real root
--     span arriving later can never upgrade the name.
--   * SpanCount 0 resets the MAX_PROCESSED_SPANS cap, so spans whose cost and
--     tokens are already committed are added to the totals a second time.
--   * AnnotationIds empty re-derives HasAnnotation from nothing, downgrading an
--     annotated trace on its next non-annotation event.
--   * StartedAt / CompletedAt null make a `completed` event compute a zero
--     duration over a real one.
--
-- So both folds' version stamps were bumped to 2026-07-27 alongside these
-- columns — the stamp records the projected row SHAPE (ADR-021/022), which is
-- exactly what changed — and each store decodes a row ONLY at that version. Any
-- other stamp is reported as a store MISS, which the folds' restored
-- refoldOnStoreMiss rebuilds from event_log once. The rebuild is written back at
-- the current version, so the row hits from then on: the population self-heals
-- per aggregate on its next event, with no backfill migration, and the
-- transitional net expires on its own once retention has aged the last
-- pre-00056 row out. Steady state is untouched — every row carries the current
-- version, every get() hits, nothing refolds.
--
-- Old builds ignore the new columns entirely (additive schema). During a rolling
-- deploy the gate is symmetric — an old node likewise declines a row a new node
-- stamped — so an aggregate touched by both may refold once per side until the
-- rollout completes. Bounded by the deploy window, and the safe direction:
-- neither build decodes a row shape it does not know.
-- ============================================================================

-- ── trace_analytics ─────────────────────────────────────────────────────────

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS SpanCount UInt32 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS AnnotationIds Array(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- Epoch ms as UInt64 (not DateTime64) — the fold compares this numerically to
-- decide root-span precedence, so an exact round-trip matters. 0 = "no root yet".
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS RootSpanStartTimeMs UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS TraceNameFromFallback Bool DEFAULT 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS RootMetadataFromFallback Bool DEFAULT 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS TraceNameUserOverridden Bool DEFAULT 0;
-- +goose StatementEnd

-- +goose StatementBegin
-- The fold's out-of-order checkpoint, epoch ms. Distinct from OccurredAt (the
-- min span time / partition column), so it needs its own column.
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS LastEventOccurredAt UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS AppliedEventIds Array(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- ── evaluation_analytics ────────────────────────────────────────────────────

-- +goose StatementBegin
-- Epoch ms as UInt64; 0 = "not started yet" (maps back to null in state).
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics
  ADD COLUMN IF NOT EXISTS StartedAt UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- Epoch ms as UInt64; 0 = "not completed yet" (maps back to null in state).
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics
  ADD COLUMN IF NOT EXISTS CompletedAt UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics
  ADD COLUMN IF NOT EXISTS AppliedEventIds Array(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS SpanCount;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS AnnotationIds;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS RootSpanStartTimeMs;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS TraceNameFromFallback;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS RootMetadataFromFallback;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS TraceNameUserOverridden;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS LastEventOccurredAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS AppliedEventIds;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics DROP COLUMN IF EXISTS StartedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics DROP COLUMN IF EXISTS CompletedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics DROP COLUMN IF EXISTS AppliedEventIds;
