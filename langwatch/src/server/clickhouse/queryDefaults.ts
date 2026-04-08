/**
 * Default ClickHouse query settings applied to all non-analytics queries.
 *
 * These settings prevent any single query from consuming unbounded memory
 * on the ClickHouse server, which could cause OOM and impact all tenants.
 *
 * max_memory_usage is intentionally omitted here: the ClickHouse server
 * profile already enforces a per-query memory cap via Terraform (1.5–2 GiB
 * depending on cluster). Setting it client-side would override that cap
 * upward, which is counterproductive.
 *
 * max_bytes_before_external_group_by: When GROUP BY intermediate state
 * exceeds this threshold (500 MB), ClickHouse spills to disk instead
 * of failing with OOM.
 */
export const DEFAULT_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};
