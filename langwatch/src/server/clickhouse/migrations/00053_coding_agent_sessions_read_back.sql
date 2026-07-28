-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions — read-back columns (ADR-066, Pillar 1 adopter #1).
--
-- The session fold's store.get() returned null by design, so every cache miss
-- and every out-of-order delivery refolded the aggregate's WHOLE history from
-- event_log. On a large session that is a 20-100 MB S3-walking read; enough of
-- them starved ClickHouse merges into OOM, stalled event_log part merges, and
-- tripped TOO_MANY_PARTS platform-wide (2026-07-23 outage).
--
-- ADR-066 makes the fold read back its own last committed state instead. The
-- row already carries almost the whole state as typed columns; these five close
-- the round-trip gap so store.get() reconstructs working state without reading
-- event_log — for every row written at the current projection version, which
-- after one event per session is all of them (see the version gate at the end
-- of this header):
--
--   SubAgentIds               — the dedup set behind the SubAgents count; the
--                               row carried the count + types, not the ids.
--   PreviousCallContextTokens — the previous model call's context size, used to
--                               detect the NEXT call's cache rebuild.
--   StepStartedAt             — per-step start times, parallel to Steps. Steps
--                               dropped these on projection, which is the real
--                               reason a read-back step could not be re-ordered.
--   MetricSeries              — the converged metric units the metric-fed fields
--                               are recomputed from (replace-not-increment,
--                               ADR-056 §5). Persisting the map makes the pure
--                               overlay reproduce every metric-fed field on
--                               read-back with no read-path change. (Transitional
--                               per ADR-066 step 2: this map later leaves the
--                               fold for session_metric_series.)
--   LastEventOccurredAt       — the fold's out-of-order checkpoint. CreatedAt /
--                               UpdatedAt already exist (UpdatedAt is the RMT
--                               version), so only this one is new.
--
-- Each ALTER is its own statement block — ClickHouse does not support
-- multi-statement queries.
--
-- Old rows are NOT read back — the projection version is the discriminator.
--
-- A row written before this migration omits every column above, so ClickHouse
-- supplies the column default (empty array / 0). Those defaults are
-- indistinguishable from real values, and decoding them into fold state would be
-- actively wrong, not merely lossy:
--
--   * MetricSeries empty makes the next metric contribution recompute the
--     metric-fed fields (lines of code, commits, PRs, edit decisions, active
--     time) from that ONE series — every unit already converged is dropped from
--     the totals, and the replace-not-increment contract (ADR-056 §5) turns from
--     idempotent into destructive.
--   * SubAgentIds empty makes the next sub-agent span reset SubAgents to 1: the
--     count is the size of the dedup set, so a session with four sub-agents
--     reports one.
--   * StepStartedAt empty starts every decoded step at 0, so later steps can
--     only be appended in ARRIVAL order — the exact "plausible-looking but
--     wrong" sequence this column was added to prevent (spans are batched on the
--     wire and arrive out of start order).
--   * PreviousCallContextTokens 0 is the fold's "first call ever" sentinel, so
--     the next model call can never be scored as a cache rebuild however large
--     its cache-creation tokens are.
--   * LastEventOccurredAt 0 resets the fold's out-of-order checkpoint.
--   * AppliedEventIds (migration 00054) empty leaves a redelivered batch nothing
--     to be recognised by.
--
-- So the fold's version stamp was bumped to 2026-07-27 alongside these columns —
-- the stamp records the projected row SHAPE (ADR-021/022), which is exactly what
-- changed — and the store decodes a row ONLY at that version. Any other stamp is
-- reported as a store MISS (state AND watermark), which the fold's restored
-- refoldOnStoreMiss rebuilds from event_log once. The rebuild is written back at
-- the current version, so the row hits from then on: the population self-heals
-- per session on its next event, with no backfill migration, and the
-- transitional net expires on its own once retention has aged the last
-- pre-00053 row out. Steady state is untouched — every row carries the current
-- version, every get() hits, nothing refolds.
--
-- Old builds ignore the new columns entirely (additive schema). During a rolling
-- deploy the gate is symmetric — an old node likewise declines a row a new node
-- stamped — so a session touched by both may refold once per side until the
-- rollout completes. Bounded by the deploy window, and the safe direction:
-- neither build decodes a row shape it does not know.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS SubAgentIds Array(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS PreviousCallContextTokens UInt64 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS StepStartedAt Array(UInt64) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- (SeriesId, MetricName, Type, Decision, Language, Value). Unnamed tuple so it
-- serialises as a JSON array over JSONEachRow, exactly like the Steps column.
-- Nullable attribute fields ride as empty strings and map back to null.
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS MetricSeries Array(Tuple(String, String, String, String, String, Float64)) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS LastEventOccurredAt DateTime64(3) DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS SubAgentIds;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS PreviousCallContextTokens;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS StepStartedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS MetricSeries;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS LastEventOccurredAt;
