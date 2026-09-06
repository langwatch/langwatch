-- +goose Up
-- +goose ENVSUB ON

-- The coded half of a failed experiment-run row.
--
-- `TargetError` holds the engine's own engineer-facing string
-- (`httpblock: Post "…": no such host`). Live, the stream carries the failure's
-- stable code alongside it (`target_result.domainError`) and the client renders
-- the presentation registry's copy for that code — but nothing persisted the
-- code, so on the next page load the grid fell back to printing the raw string
-- to the customer. ADR-045: what a customer reads comes from the code, not from
-- the engine's words.
--
-- Stores the serialised handled error as JSON (the same shape the SSE frame
-- carries: code, fault, httpStatus, meta, traceId), matching how this table
-- already stores structured payloads — DatasetEntry, Predicted and
-- EvaluationInputs are all JSON strings. One column rather than three loose
-- ones keeps the read-back and the wire the same object, so the client uses one
-- function (`explainSerializedError`) for both.
--
-- Existing rows keep NULL and read back exactly as they do today (raw string
-- fallback), so no reprojection is required.
--
-- `_size_bytes` (00032) is deliberately left alone: changing a MATERIALIZED
-- expression only applies to new parts and would need a full mutation to be
-- consistent, which is not worth it for a short JSON blob written only on
-- failed rows.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS TargetDomainError Nullable(String) CODEC(ZSTD(3))
    AFTER TargetError
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. ALTER TABLE DROP COLUMN
-- is irreversible (data loss). Down migrations are intentionally
-- commented out per LangWatch CLAUDE.md "ClickHouse migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items DROP COLUMN IF EXISTS TargetDomainError;
