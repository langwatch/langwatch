/** ClickHouse safety settings shared by Analytics-owned reads. */
export const ANALYTICS_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};
