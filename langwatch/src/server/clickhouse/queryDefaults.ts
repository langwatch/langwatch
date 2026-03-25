/**
 * Default ClickHouse query settings applied to all non-analytics queries.
 *
 * These settings prevent any single query from consuming unbounded memory
 * on the ClickHouse server, which could cause OOM and impact all tenants.
 *
 * max_memory_usage: Hard cap (2 GiB) on per-query memory. Non-analytics
 * queries (single-trace lookups, projection reads, event log fetches)
 * should never approach this limit under normal operation.
 *
 * max_bytes_before_external_group_by: When GROUP BY intermediate state
 * exceeds this threshold (500 MB), ClickHouse spills to disk instead
 * of failing with OOM.
 */
export const DEFAULT_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_memory_usage: 2_000_000_000,
  max_bytes_before_external_group_by: 500_000_000,
};
