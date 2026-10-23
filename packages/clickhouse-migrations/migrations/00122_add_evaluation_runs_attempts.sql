-- +goose Up
-- +goose ENVSUB ON

-- An evaluation's failed attempts while the evaluator service was not up, folded
-- from lw.evaluation.attempt_failed: how many failed, when the last one ran and
-- why, and when the next one is due (NULL once the run ends).
--
-- No backfill: rows folded before this migration read 0 and NULL, which means
-- no attempt failed, as was true of every run before the event existed.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS Attempts UInt16 DEFAULT 0 CODEC(ZSTD(1))
    AFTER CostId
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS LastAttemptAt Nullable(DateTime64(3)) DEFAULT NULL
    CODEC(Delta(8), ZSTD(1))
    AFTER Attempts
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS LastAttemptError Nullable(String) DEFAULT NULL CODEC(ZSTD(3))
    AFTER LastAttemptAt
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS NextAttemptAt Nullable(DateTime64(3)) DEFAULT NULL
    CODEC(Delta(8), ZSTD(1))
    AFTER LastAttemptError
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS NextAttemptAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS LastAttemptError;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS LastAttemptAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS Attempts;
