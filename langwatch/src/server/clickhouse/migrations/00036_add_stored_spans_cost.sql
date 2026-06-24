-- +goose Up
-- +goose ENVSUB ON

-- Per-span cost on stored_spans.
--
-- Cost is the span's LLM cost (USD), computed at projection time from the
-- span's tokens x pricing via the same SpanCostService the trace-summary fold
-- uses, so a span's stored Cost matches its contribution to the trace total.
-- NULL when the span carries no costable usage (no tokens / no explicit cost).
--
-- NonBilledCost is the portion of Cost covered by a flat plan rather than
-- billed per token (the span's / resource's `langwatch.cost.non_billable`
-- marker). It equals Cost for a fully-bundled span and NULL for a fully-billed
-- one, mirroring how trace_summaries.NonBilledCost is summed in the fold. The
-- billed portion is `Cost - NonBilledCost`.
--
-- Existing rows keep NULL in both columns (no reprojection required); this is
-- foundational for the ADR-034 analytics rollup, which will later sum these
-- via a materialized view, and independently useful as a queryable per-span
-- column.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS Cost Nullable(Float64) CODEC(ZSTD(1))
    AFTER DroppedLinksCount;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS NonBilledCost Nullable(Float64) CODEC(ZSTD(1))
    AFTER Cost;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. ALTER TABLE DROP COLUMN
-- is irreversible (data loss). Down migrations are intentionally
-- commented out per LangWatch CLAUDE.md "ClickHouse migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS NonBilledCost;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS Cost;
