-- +goose Up
-- +goose ENVSUB ON

-- Per-field blob references for over-threshold span attribute values offloaded
-- to object storage (issue #4215 / ADR-021). Sibling to SpanAttributes, keyed by
-- the same attribute name: attrKey -> JSON ref {"key","size","sha256","encoding"}.
-- The full value lives in S3; SpanAttributes keeps a bounded preview in its place.
-- Empty for spans with no offloaded field (the common case), so this is additive:
-- existing inserts that omit the column get the default empty Map.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS SpanBlobRefs Map(String, String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS SpanBlobRefs;
-- +goose StatementEnd

-- +goose ENVSUB OFF
