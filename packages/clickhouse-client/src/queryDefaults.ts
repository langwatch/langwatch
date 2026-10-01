/**
 * Default ClickHouse query settings, capping memory so one query can't OOM
 * the server. `max_memory_usage` is omitted on purpose — the server's
 * Terraform profile already caps it per-query; client-side would only raise it.
 */
export const DEFAULT_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};

/**
 * `wait_for_async_insert`: avoids a stale Redis-miss read racing the flush.
 * `input_format_skip_unknown_fields: 0`: fails loudly on a migration-race
 * schema mismatch, instead of silently corrupting a row past the version gate.
 */
export const READ_BACK_FOLD_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;
