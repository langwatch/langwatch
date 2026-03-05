-- +goose Up
-- +goose ENVSUB ON

-- event_log: add occurred-at column for business timestamps
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log ADD COLUMN IF NOT EXISTS
  EventOccurredAt UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- experiment_runs: system timestamps via DEFAULT, add StartedAt business timestamp
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs MODIFY COLUMN CreatedAt DateTime64(3) DEFAULT now64(3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs MODIFY COLUMN UpdatedAt DateTime64(3) DEFAULT now64(3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs ADD COLUMN IF NOT EXISTS
  StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- experiment_run_items: system timestamp via DEFAULT, add OccurredAt business timestamp
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items MODIFY COLUMN CreatedAt DateTime64(3) DEFAULT now64(3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items ADD COLUMN IF NOT EXISTS
  OccurredAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- evaluation_states: add CreatedAt (already has UpdatedAt DEFAULT now64(3))
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_states ADD COLUMN IF NOT EXISTS
  CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- NOTE: MODIFY COLUMN DEFAULT changes from the Up migration are not reverted here.
-- ClickHouse does not support removing a DEFAULT once set, and the now64(3) defaults
-- are harmless if left in place.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_states DROP COLUMN IF EXISTS CreatedAt;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items DROP COLUMN IF EXISTS OccurredAt;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS StartedAt;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log DROP COLUMN IF EXISTS EventOccurredAt;
-- +goose StatementEnd

-- +goose ENVSUB OFF
