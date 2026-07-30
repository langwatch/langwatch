-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- experiment_runs — durable dedup watermark (ADR-066, sequencing step 4).
--
-- Same change 00054 made for coding_agent_sessions, for the last accumulating
-- fold that still lacked it.
--
-- `experimentRunState` folds counters: `CompletedCount`/`FailedCount` and
-- `Progress` are `+= 1` per delivered target result, and `TotalScoreSum` /
-- `ScoreCount` / `PassedCount` / `GradedCount` accumulate per evaluator
-- result. Those counters are correct as long as the executor can tell a
-- redelivered event from a fresh one, which it does with the applied-event-id
-- set that `CachedFoldStore` keeps on its cache entry.
--
-- That set lived ONLY in the cache entry for this projection, so a committed
-- write followed by a lost cache (TTL, eviction, restart) let a retry re-fold
-- the same batch onto state that already contained it. The run's progress bar
-- then read past its own total — 11/10 beside ten item rows — and with
-- `refoldOnOutOfOrder: false` and no `refoldOnStoreMiss` nothing ever
-- re-derived it. The drift was permanent.
--
-- This column rides the set next to the state row so redelivery dedup survives
-- cache loss. Bounded to the in-flight batch (MAX_APPLIED_EVENT_IDS = 1000).
--
-- DEFAULT [] so a row written before this migration — and any row written by an
-- old replica mid-rolling-deploy, which omits the column — reads back as an
-- empty watermark rather than NULL. An empty watermark is exactly the
-- pre-migration behaviour: nothing is recognised as a redelivery, so the fold
-- degrades to a blind re-apply rather than to something worse.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS AppliedEventIds;
