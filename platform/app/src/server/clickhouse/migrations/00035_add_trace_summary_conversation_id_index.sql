-- +goose Up
-- +goose ENVSUB ON

-- trace_summaries is ORDER BY (TenantId, TraceId) and PARTITION BY a weekly
-- bucket of OccurredAt. Resolving a conversation thread to its traces
-- (getTracesByThreadId / getTracesWithSpansByThreadIds in
-- clickhouse-trace.service.ts) filters by the conversation id held inside the
-- Attributes map:
--   SELECT DISTINCT TraceId FROM trace_summaries
--   WHERE TenantId = {tenantId}
--     AND Attributes['gen_ai.conversation.id'] = {threadId}   -- or IN (...)
-- The thread view carries no time range (a conversation can span any period),
-- so there is no OccurredAt predicate to prune partitions, and the
-- conversation id lives in the Attributes map rather than a sort-key column.
-- The read therefore decodes the Attributes map for every granule of every
-- partition the tenant occupies — in production this shape read ~0.5-0.7 GB
-- per call and ran 1-2.5s.
--
-- Add a bloom_filter skip-index on the conversation-id map element (matching
-- the existing idx_models / idx_topic_id granularity) so a thread lookup skips
-- the granule-blocks that cannot contain the id. The equality and IN forms
-- both use a bloom_filter index.
--
-- This ADD INDEX only attaches the index to NEW parts. To backfill existing
-- parts, the reviewer should run (out of band, it is a heavy mutation that
-- reads the Attributes column across all parts — plan it for a low-traffic
-- window):
--   ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries MATERIALIZE INDEX idx_conversation_id;

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_conversation_id `Attributes`['gen_ai.conversation.id']
    TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually:
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_conversation_id;
