-- +goose Up
-- +goose ENVSUB ON

-- Persist `merge_max_block_size_bytes = 256 MiB` into per-table DDL.
--
-- Background. During the 2026-06-20 fat-row merge OOM incident, this byte
-- cap was applied as a live `ALTER TABLE ... MODIFY SETTING` to the heavy
-- tables so background merges bound a block by bytes instead of the
-- row-denominated default (`merge_max_block_size = 8192`). Live ALTERs
-- survive until a table is recreated; encoding the value into a migration
-- makes it durable for fresh deploys (self-hosted, dev, new clusters) and
-- recreates.
--
-- Why this is the only setting the migration touches. The corrected fix
-- (per the 2026-06-21 cold review of the incident docs) has two levers:
--   1. Vertical-merge activation gates — already durably set at the server
--      scope in infrastructure/clickhouse.tf
--      (`vertical_merge_algorithm_min_rows_to_activate = 1`,
--       `vertical_merge_algorithm_min_columns_to_activate = 1`).
--   2. Byte cap on the merge block — this migration.
-- The earlier draft plan also proposed raising
-- `min_bytes_for_wide_part` and `vertical_merge_algorithm_min_bytes_to_activate`;
-- both are wrong for the fat-row regime (they would make vertical LESS
-- likely, not more) and are deliberately NOT applied.
--
-- Scope. The five tables whose rows are large enough for an unbounded
-- 8192-row merge block to risk OOM:
--   * stored_spans       — SpanAttributes ~13 KiB avg, 246 KiB max
--   * trace_summaries    — Attributes-heavy, 238 KiB max row
--   * evaluation_runs    — Inputs column 7.9 KiB avg / 17.85 MiB max
--   * event_log          — EventPayload up to 814 KiB
--   * simulation_runs    — Messages.* arrays up to 842 KiB
-- Tables deliberately omitted:
--   * stored_log_records — max row 53 KiB; server default cap protective
--   * experiment_run_items, stored_metric_records, experiment_runs,
--     dspy_steps — narrow rows (≤ 1 KiB avg). Their stuck zero-copy
--     mutations are an independent issue tracked separately.
--
-- Idempotency. On prod the five tables already carry this setting from the
-- live ALTER, so the migration is a no-op there. On any cluster without it
-- (fresh deploy, recreated table) the migration applies the cap.
--
-- Cost. MODIFY SETTING is metadata-only; it does not rewrite existing parts.
-- `alter_sync = 1, mutations_sync = 0` waits only on the local replica and
-- never queues behind unrelated mutations.
--
-- Slot. 00034 is taken by #5000 (add_query_pruning_indexes — includes inline
-- MATERIALIZE INDEX on stored_log_records / stored_metric_records). 00035 is
-- taken by #4854 (add_trace_summary_conversation_id_index — ADD INDEX only,
-- materialize gated to a runbook). This migration is intentionally cheaper
-- than #5000 and safe to deploy ahead of the stuck-mutation drain runbook.

-- stored_spans
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  MODIFY SETTING merge_max_block_size_bytes = 268435456
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- trace_summaries
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY SETTING merge_max_block_size_bytes = 268435456
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- evaluation_runs
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  MODIFY SETTING merge_max_block_size_bytes = 268435456
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- event_log
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  MODIFY SETTING merge_max_block_size_bytes = 268435456
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- simulation_runs
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  MODIFY SETTING merge_max_block_size_bytes = 268435456
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans      RESET SETTING merge_max_block_size_bytes;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries   RESET SETTING merge_max_block_size_bytes;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs   RESET SETTING merge_max_block_size_bytes;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log         RESET SETTING merge_max_block_size_bytes;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs   RESET SETTING merge_max_block_size_bytes;
-- +goose StatementEnd
