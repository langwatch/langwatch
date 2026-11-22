-- +goose Up
-- +goose ENVSUB ON

-- Which rows of a run the run actually produced.
--
-- A run now holds a snapshot of the whole workbench board: the cells outside
-- the execution scope are copied in from the board so the results page can draw
-- every column, and the cells being run fill in as they execute. A copied cell
-- was paid for by the run that produced it, so the run's folded `TotalCost` and
-- `TotalDurationMs` must leave it out, and so must `CompletedCount` (which is
-- counted against the cells the run dispatched).
--
-- Verdicts are the other way round. A carried verdict still counts toward the
-- run's pass rate and average score, because the run stands for the board and a
-- reader comparing two columns needs both sides. Money and time belong to this
-- run; verdicts and scores belong to the board.
--
-- Existing rows keep 0 and read back exactly as they do today, so no
-- reprojection is required.
--
-- `_size_bytes` (00032) is deliberately left alone: changing a MATERIALIZED
-- expression only applies to new parts and would need a full mutation to be
-- consistent, which is not worth it for one byte per row.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS CarriedOver UInt8 DEFAULT 0
    AFTER EvaluationDurationMs
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. ALTER TABLE DROP COLUMN
-- is irreversible (data loss). Down migrations are intentionally
-- commented out per LangWatch CLAUDE.md "ClickHouse migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items DROP COLUMN IF EXISTS CarriedOver;
