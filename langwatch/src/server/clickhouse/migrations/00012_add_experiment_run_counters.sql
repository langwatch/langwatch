-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
    ADD COLUMN IF NOT EXISTS TotalScoreSum Float64 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ScoreCount UInt32 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS PassedCount UInt32 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS PassFailCount UInt32 DEFAULT 0;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
    DROP COLUMN IF EXISTS TotalScoreSum,
    DROP COLUMN IF EXISTS ScoreCount,
    DROP COLUMN IF EXISTS PassedCount,
    DROP COLUMN IF EXISTS PassFailCount;

-- +goose StatementEnd
-- +goose ENVSUB OFF
