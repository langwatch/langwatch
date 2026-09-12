import type { RetentionCategory } from "./data-retention.ts";

export const RETENTION_TABLE_CATEGORY_MAP = {
  event_log: "traces",
  stored_spans: "traces",
  stored_log_records: "traces",
  log_records: "traces",
  metric_data_points: "traces",
  metric_series: "traces",
  metric_time_rollups: "traces",
  trace_summaries: "traces",
  trace_analytics: "traces",
  trace_analytics_rollup: "traces",
  evaluation_runs: "traces",
  evaluation_analytics: "traces",
  evaluation_analytics_rollup: "traces",
  langy_analytics_events: "traces",
  dspy_steps: "traces",
  simulation_runs: "scenarios",
  suite_runs: "scenarios",
  experiment_runs: "experiments",
  experiment_run_items: "experiments",
} as const satisfies Record<string, RetentionCategory>;

export type RetentionManagedTable = keyof typeof RETENTION_TABLE_CATEGORY_MAP;

export const RETENTION_MANAGED_TABLES = Object.keys(
  RETENTION_TABLE_CATEGORY_MAP,
) as RetentionManagedTable[];

/**
 * Tables that carry the `_retention_days` column but are NOT part of the
 * customer retention cascade — their column DEFAULTS TO 0
 * (`INDEFINITE_RETENTION_DAYS`), so nothing is ever deleted unless a day count
 * is deliberately stamped on a row.
 *
 * These MUST NOT be moved into `RETENTION_TABLE_CATEGORY_MAP`, and the
 * temptation to "tidy" them in is exactly what this comment exists to stop.
 * Three separate things would break:
 *
 *  1. The map's values are `RetentionCategory` — traces / scenarios /
 *     experiments. Governance cost is none of those, so it would have to be
 *     mislabelled as one of them to typecheck.
 *  2. `resolveRetention` floors every mapped category to
 *     PLATFORM_DEFAULT_RETENTION_DAYS (49) when no override exists. Mapping
 *     these tables would therefore turn "keep forever" into "delete after
 *     seven weeks" — the precise inverse of the intent — for money records.
 *  3. Map membership is what enrolls a table in the customer storage meter
 *     (`PRODUCTION_STORAGE_METER_TABLES`). These tables are platform
 *     bookkeeping, not customer payload, and must not be billed as storage.
 *
 * What they DO share with the mapped tables is the TTL mechanism itself: the
 * reconciler installs the same
 * `IF(_retention_days > 0, ... , toDateTime('2106-01-01')) DELETE` clause, and
 * a non-zero value in the column expires the row exactly the same way. The
 * difference is only where the number comes from and what it defaults to.
 *
 * Introduced with the governance cost tables' move off a hardcoded 13-month
 * TTL (migration 00095); see that migration's header for the full reasoning.
 */
export const INDEFINITE_DEFAULT_RETENTION_TABLES = [
  "governance_cost_rollup_1d",
  "governance_cost_rollup_restatement_index",
] as const;

export type IndefiniteDefaultRetentionTable = (typeof INDEFINITE_DEFAULT_RETENTION_TABLES)[number];

/**
 * Every table the TTL reconciler installs a `_retention_days` DELETE clause on.
 *
 * This is the RECONCILER's gate, and it is deliberately wider than
 * `RETENTION_MANAGED_TABLES`, which is the CUSTOMER-facing set (the category
 * cascade, the settings UI, and the storage meter). Anything asking "does a
 * customer's retention policy govern this table?" wants
 * RETENTION_MANAGED_TABLES; only the reconciler, which asks "does this table's
 * TTL reference `_retention_days` at all?", wants this one.
 */
export const RETENTION_TTL_MANAGED_TABLES: readonly string[] = [
  ...RETENTION_MANAGED_TABLES,
  ...INDEFINITE_DEFAULT_RETENTION_TABLES,
];

const SHADOW_METER_TABLES = new Set<RetentionManagedTable>([
  "metric_data_points",
  "metric_series",
  "metric_time_rollups",
]);

const TABLES_WITHOUT_SIZE_COLUMN = new Set<RetentionManagedTable>([
  "trace_analytics",
  "trace_analytics_rollup",
  "evaluation_analytics",
  "evaluation_analytics_rollup",
]);

export const PRODUCTION_STORAGE_METER_TABLES = RETENTION_MANAGED_TABLES.filter(
  (table) => !SHADOW_METER_TABLES.has(table) && !TABLES_WITHOUT_SIZE_COLUMN.has(table),
);
