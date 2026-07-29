-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Re-asserts the Array-column DEFAULTs that 00057 set.
--
-- 00057 fixed the unmaterialised-Array defect (an `ADD COLUMN` of an `Array`
-- without a `DEFAULT` leaves the column unmaterialised in every part written
-- before the ALTER, so a read decodes a size header that was never written and
-- ClickHouse tries to allocate whatever the garbage says — code 173, "Amount of
-- memory requested to allocate is more than allowed ... while reading column
-- X"). Its own header records that all seven MODIFYs were applied BY HAND during
-- the 2026-07-28 incident, ahead of the migration.
--
-- The read-back deployed on 2026-07-29 then failed on
-- `trace_analytics.AnnotationIds` with exactly that error, across three separate
-- parts. Either the hand-applied ALTER did not land everywhere the migration
-- would have, or it did and the surviving failures are parts whose column was
-- physically written from garbage before it. This migration closes the first
-- possibility; it cannot close the second (see below).
--
-- Re-asserting is free when 00057 already applied: `MODIFY COLUMN` that changes
-- only the DEFAULT is a metadata operation — no part is rewritten, no mutation
-- is scheduled — and replaying one already in place is a no-op. That is the
-- whole reason this is safe to run unconditionally rather than gated on an
-- inspection someone has to do first.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL to every node on its own;
-- ON CLUSTER against a Replicated database is rejected.
--
-- Scope is deliberately narrower than 00057's seven: only the three columns on
-- the two analytics tables whose read-back is live. `coding_agent_sessions`
-- carries the same defect class from 00053/00054, but nothing has been observed
-- failing on it and each MODIFY is a metadata write against a live table, so it
-- is left to 00057 rather than re-run speculatively.
-- ============================================================================

-- --- trace_analytics ---------------------------------------------------------

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  MODIFY COLUMN AnnotationIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  MODIFY COLUMN AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- --- evaluation_analytics ----------------------------------------------------

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics
  MODIFY COLUMN AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- ============================================================================
-- NOT run here: forcing the column to exist physically.
--
-- A DEFAULT only helps a part that LACKS the column — the read synthesises the
-- default instead of decoding a header that was never written. It cannot help a
-- part whose column was physically materialised from garbage by a merge that ran
-- between the ADD COLUMN and the fix. If failures persist after this migration,
-- that is the remaining case, and the remedy is to rewrite the column:
--
--   ALTER TABLE langwatch.trace_analytics MATERIALIZE COLUMN AnnotationIds;
--
-- Left as a manual step ON PURPOSE. That is a MUTATION: it rewrites the column
-- in every part of a large, live, continuously-ingested table, competing for
-- exactly the merge and memory budget whose exhaustion is the failure being
-- fixed. It wants a chosen low-traffic window and someone watching
-- `system.mutations`, not an auto-firing migration that lands whenever the next
-- deploy happens to go out.
--
-- The application-side fix that ships with this migration makes that rewrite
-- non-urgent rather than unnecessary: a fold read-back now reports an
-- unreadable row as a store miss and rebuilds the aggregate from `event_log`,
-- which writes the row back readable. So any row that is still being written to
-- heals itself as its next event arrives. A row that never receives another
-- event stays unreadable until either retention ages it out or the MATERIALIZE
-- above is run.
-- ============================================================================

-- +goose Down
-- IRREVERSIBLE: rolling back reinstates the defect. Dropping the DEFAULT puts
-- parts written before the original ADD COLUMN back to decoding a size header
-- that was never written, which is the read-time failure this migration exists
-- to stop. The Down migration is therefore commented out to prevent accidental
-- data loss. To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics      MODIFY COLUMN AnnotationIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics      MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
