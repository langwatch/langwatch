-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- governance_cost_rollup_1d: the two markers a reader needs to know how much
-- to trust a day's figure (ADR-128 wave 2, §15).
--
--   RevisedAt:      when a provider last restated this cell to a DIFFERENT
--                   figure. NULL until one does, which is what makes "is this
--                   day revised" a NULL check rather than a count comparison.
--   LastObservedAt: when a pull last TOUCHED this cell — including a re-pull
--                   that confirmed an unchanged figure, which is the case the
--                   provisional test exists to see.
--
-- The prior amount is NOT added here. `PreviousAmountNanoUsd` and
-- `RevisionCount` already shipped with the table in 00087; a second
-- prior-amount money column would leave a reader guessing which one is
-- authoritative. §15's "was $X" reads the shipped one.
--
-- `LastObservedAt` backfills to the epoch, so every row written before this
-- migration reads as long since observed and therefore SETTLED. That is the
-- right answer rather than a compromise: the pullers look 30 days back, so any
-- day still genuinely inside its settling window is re-stamped by the next
-- daily pull, and any day the backfill called settled was one no pull was ever
-- going to touch again.
--
-- Both are written from the PULL'S OWN OBSERVATION TIMESTAMP carried on the
-- event, never the wall clock at fold time. Taking the clock would stamp every
-- day with today on a replay, breaking "rebuild = replay", and would let a
-- delete-then-replay erasure flip long-settled days back to provisional just
-- because somebody was erased.
--
-- Neither is a dimension: they are facts ABOUT the cell, not facts the cell is
-- distinguished BY, so they are payload and the sort key is untouched. Both
-- are read with `argMax(..., EventTimestamp)` like every other payload column
-- (ADR-015) — the table is a ReplacingMergeTree and its dedup is eventual.
--
-- The fold's schema stamp (`Version`) is deliberately NOT bumped alongside
-- this. The fold has no re-fold path, so the store answers an unrecognized
-- stamp by refusing rather than rebuilding, and a bump would make every cell
-- already in the table throw on its next event. Reading the defaults above is
-- exactly what this migration is designed for.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d
  ADD COLUMN IF NOT EXISTS RevisedAt Nullable(DateTime) DEFAULT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d
  ADD COLUMN IF NOT EXISTS LastObservedAt DateTime DEFAULT toDateTime(0) CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets every
-- restatement marker and every record of when a pull last touched a day —
-- neither of which the fold can re-derive without replaying the whole log.
-- `up` is idempotent (`ADD COLUMN IF NOT EXISTS`), so `down` is deliberately a
-- no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d DROP COLUMN IF EXISTS RevisedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d DROP COLUMN IF EXISTS LastObservedAt;
