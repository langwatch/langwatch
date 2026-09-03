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

/**
 * Write settings for the ADR-066 read-back folds' `INSERT` path.
 *
 * NOTE these are NOT applied automatically: the managed client applies them
 * only to `.query`, so `insert` never receives {@link DEFAULT_CLICKHOUSE_SETTINGS}
 * or anything else. Every insert that needs a setting must pass it explicitly,
 * which is why this constant is shared rather than repeated per repository.
 *
 * `async_insert` / `wait_for_async_insert` — wait for the async-insert flush.
 * These are the executors' live write paths (`store.store()`), and under ADR-066
 * the very next delivery may read the row back on a Redis miss. Returning before
 * the flush lets that read see the previous version, so the fold would resume
 * from stale state and rewrite it with a higher `UpdatedAt` — silently dropping
 * the batch's contributions and its applied-id watermark.
 *
 * `input_format_skip_unknown_fields: 0` — fail the insert when the record
 * carries a column the table does not have, instead of dropping it. ClickHouse
 * defaults this ON, and the workers Deployment overrides the entrypoint
 * (`charts/langwatch/templates/workers/deployment.yaml`) so it never runs the
 * migration step: migrations execute during the APP pod's boot, and the two
 * Deployments roll concurrently. In that window a worker can write a row whose
 * new read-back columns silently vanish — and the row still lands stamped at the
 * CURRENT projection version. Once the migration applies, that row PASSES the
 * store's version gate and decodes as all-defaults, which for these folds is not
 * "empty" but actively wrong (a zeroed span count re-adds committed cost, a
 * false name-resolution latch lets a late span overwrite a user's rename). And
 * because it wears the current stamp, `refoldOnStoreMiss` never rebuilds it: the
 * corruption launders itself past the very gate that exists to reject it.
 * Failing loudly instead makes the job retry on the queue's normal backoff and
 * recover the moment the migration lands — the same fail-and-retry shape the
 * read half already has (its `ORDER BY` references the new columns, so it throws
 * `UNKNOWN_IDENTIFIER` in the same window).
 *
 * This cannot misfire in the other direction. A column the table HAS but the
 * record omits (new column, old writer) is not an *unknown field* — it is an
 * omitted one, governed by `input_format_defaults_for_omitted_fields`, which
 * stays at its default of 1. Column defaults still apply.
 */
export const READ_BACK_FOLD_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;
