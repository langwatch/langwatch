-- Smoke-test for issue #3754 — DO NOT MERGE.
-- Expect semgrep `clickhouse-no-qualified-table` to flag both lines.

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.smoke_test_traces (
  id UUID,
  ts DateTime
) ENGINE = MergeTree() ORDER BY ts;

SELECT * FROM langwatch.smoke_test_traces LIMIT 1;
