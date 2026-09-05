/**
 * Settings sent with an ad-hoc EXPLAIN so a mistyped query cannot cost the
 * cluster: read-only, ten seconds, ten megabytes back, one gigabyte of memory.
 */
export const CLICKHOUSE_GUARDRAILS = {
  readonly: "1",
  max_execution_time: 10,
  max_result_bytes: "10000000",
  max_memory_usage: "1073741824",
} as const;
