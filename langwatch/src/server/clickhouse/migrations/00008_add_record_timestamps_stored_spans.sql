-- +goose Up
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
    ADD COLUMN IF NOT EXISTS CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
    ADD COLUMN IF NOT EXISTS UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
    DROP COLUMN IF EXISTS CreatedAt;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
    DROP COLUMN IF EXISTS UpdatedAt;
-- +goose StatementEnd

-- +goose ENVSUB OFF
