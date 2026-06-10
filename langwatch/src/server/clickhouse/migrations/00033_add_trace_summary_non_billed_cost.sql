-- +goose Up
-- +goose ENVSUB ON

-- Per-span billed-vs-bundled cost rollup.
--
-- A trace's LLM cost splits into two real amounts: the portion actually
-- billed per token (gateway / pay-per-token usage) and the bundled portion
-- covered by a flat subscription (e.g. Claude Max), which is theoretical.
-- This used to be derived all-or-nothing from a single trace-level boolean
-- (`Attributes['langwatch.cost.non_billable']`), which cannot represent a
-- trace that mixes billed and bundled spans.
--
-- NonBilledCost is the fold-time sum of the bundled portion of each span's
-- cost (classified per span: a span/resource `langwatch.cost.non_billable`
-- marker). The billed portion is `TotalCost - NonBilledCost`. Existing rows
-- keep NULL here and the read layer falls back to the legacy boolean, so no
-- reprojection is required.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS NonBilledCost Nullable(Float64) CODEC(ZSTD(1))
    AFTER TotalCost;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. ALTER TABLE DROP COLUMN
-- is irreversible (data loss). Down migrations are intentionally
-- commented out per LangWatch CLAUDE.md "ClickHouse migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS NonBilledCost;
