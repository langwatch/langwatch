-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Eleven columns the rewritten trace folds write and no migration ever added,
-- so every insert to either table failed with "no such column": the client
-- sends JSONCompactEachRow with input_format_skip_unknown_fields: 0, which
-- rejects the whole batch rather than dropping the column. Same failure and
-- same shape of fix as 00067, for the two tables it did not cover.
--
-- Additive only. Neither table's PARTITION BY, ORDER BY, engine version nor TTL
-- changes, and no column added here takes a structural role: both tables still
-- partition and expire on OccurredAt (00002 for trace_summaries, 00039/00061
-- for trace_analytics), and both folds' read window prunes on OccurredAt too.
-- AcceptedAt is added as an ordinary column here — the ADR-099 storage-anchor
-- re-key that would make it structural is unaffected and unattempted.
--
-- Every non-nullable add carries an explicit DEFAULT, so a row written before
-- this migration keeps reading. DEFAULT 0 follows 00057's rule: a row that
-- predates the column means "not recorded". The nullable adds default to NULL,
-- which says the same thing.
--
-- AttributesJson does NOT retire the deployed `Attributes` Map. The map still
-- carries the bloom indexes 00035 and 00039 build, and the analytics filters
-- read it with mapContains/Attributes[key], neither of which a JSON string can
-- serve. Both columns coexist; a projection that stops writing the map is a
-- separate, coordinated change.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL on its own; ON CLUSTER
-- against a Replicated database is rejected.
-- ============================================================================

-- trace_summaries.SelectedPromptVersionId — the version of the prompt the fold
-- selected, alongside the id 00021 already added.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS SelectedPromptVersionId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_summaries.RootSpanStartTimeMs — the root span's own start, kept apart
-- from OccurredAt because OccurredAt moves backwards as earlier spans arrive.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS RootSpanStartTimeMs Nullable(UInt64) CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_summaries.TraceNameFromFallback — whether the stored name came from the
-- fallback candidate rather than a root span. false is the honest default: a
-- pre-existing row's name was chosen before the distinction was recorded.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS TraceNameFromFallback Bool DEFAULT false;
-- +goose StatementEnd

-- trace_summaries.TopicAssignedAt — when the topic was assigned, so a later
-- assignment cannot be overwritten by a re-fold that has no topic yet.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS TopicAssignedAt UInt64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_summaries.TraceNameChangedAt — same monotone guard for a user's name
-- override.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS TraceNameChangedAt UInt64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_summaries.AttributesJson — the fold's attribute snapshot as one string.
-- Empty means a row written before it existed, whose attributes are still in the
-- deployed `Attributes` Map.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS AttributesJson String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_summaries.AcceptedAt — the platform's own receipt stamp, as distinct
-- from the customer-supplied OccurredAt this table still partitions on.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS AcceptedAt DateTime64(3) DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- trace_analytics.TopicAssignedAt — as above, on the slim table.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS TopicAssignedAt UInt64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_analytics.TraceNameChangedAt
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS TraceNameChangedAt UInt64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_analytics.AttributesJson
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS AttributesJson String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- trace_analytics.AcceptedAt — 00061 froze what this table writes into
-- OccurredAt but left it the customer's clock; this is the platform stamp that
-- a future storage-anchor re-key would use.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS AcceptedAt DateTime64(3) DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS SelectedPromptVersionId;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS RootSpanStartTimeMs;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS TraceNameFromFallback;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS TopicAssignedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS TraceNameChangedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS AttributesJson;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS AcceptedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS TopicAssignedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS TraceNameChangedAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS AttributesJson;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS AcceptedAt;
