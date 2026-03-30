-- +goose Up
-- +goose ENVSUB ON

-- ngrambf_v1 skip indexes for substring search (ILIKE) on computed I/O.
-- Params: ngram_size=4, bloom_filter_size=10240 bytes, hash_functions=3, seed=0
-- ifNull() is required because ngrambf_v1 does not support Nullable(String).

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_input_ngram ifNull(ComputedInput, '') TYPE ngrambf_v1(4, 10240, 3, 0) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_output_ngram ifNull(ComputedOutput, '') TYPE ngrambf_v1(4, 10240, 3, 0) GRANULARITY 1;
-- +goose StatementEnd

-- Materialize indexes for existing data (runs as background mutation, partition-by-partition)
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MATERIALIZE INDEX idx_input_ngram;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MATERIALIZE INDEX idx_output_ngram;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  DROP INDEX IF EXISTS idx_input_ngram;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  DROP INDEX IF EXISTS idx_output_ngram;
-- +goose StatementEnd

-- +goose ENVSUB OFF
