-- +goose Up
-- +goose ENVSUB ON

-- Split the span timing baseline out of trace_summaries.OccurredAt.
--
-- OccurredAt is the table's weekly partition key and TTL anchor. It previously
-- also held min(span.startTimeUnixMs), so a log-only trace persisted it as the
-- epoch: partition 196952 with an already-expired TTL. It also moved whenever
-- an earlier-starting span arrived late. The projection now freezes OccurredAt
-- on the first usable contribution time and stores the running span minimum in
-- this additive column. Existing rows decode their pre-split OccurredAt as both
-- values and heal on their next ordinary write; no population refold is needed.
--
-- No ON CLUSTER: the Replicated database propagates DDL itself.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS EarliestSpanStartMs UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- IRREVERSIBLE: after the split, OccurredAt no longer contains the timing
-- baseline, so dropping this column would require replaying trace history.
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS EarliestSpanStartMs;
