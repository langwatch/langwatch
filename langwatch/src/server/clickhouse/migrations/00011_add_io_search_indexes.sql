-- +goose Up
-- +goose ENVSUB ON

-- ngrambf_v1 skip indexes for case-insensitive substring search on computed I/O.
-- lower(ifNull(...)) ensures the index matches the query expression exactly.
-- Params: ngram_size=3 (supports 3+ char queries), bloom_filter_size=10240, hash_functions=3, seed=0

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_input_ngram lower(ifNull(ComputedInput, '')) TYPE ngrambf_v1(3, 10240, 3, 0) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_output_ngram lower(ifNull(ComputedOutput, '')) TYPE ngrambf_v1(3, 10240, 3, 0) GRANULARITY 1;
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
