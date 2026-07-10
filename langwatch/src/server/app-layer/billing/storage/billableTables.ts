import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
  type RetentionManagedTable,
} from "~/server/data-retention/retentionPolicy.schema";

/**
 * The tables whose stored bytes are billable (ADR-039). Explicit by decision,
 * NEVER derived from RETENTION_TABLE_CATEGORY_MAP: deriving it is how a newly
 * added retention-managed table would silently change customer invoices.
 *
 * The `satisfies` constraint plus the partition unit test
 * (billableTables.unit.test.ts) pin the invariant both ways: every entry is a
 * real retention-managed table with a `_size_bytes` column in the ClickHouse
 * DDL, and billable + excluded together cover the whole retention map — so a
 * schema addition forces an explicit decision here instead of a silent one.
 */
export const BILLABLE_STORAGE_TABLES = [
  "event_log",
  "stored_spans",
  "stored_log_records",
  "stored_metric_records",
  "trace_summaries",
  "dspy_steps",
  "simulation_runs",
  "suite_runs",
  "experiment_runs",
  "experiment_run_items",
] as const satisfies readonly RetentionManagedTable[];

export type BillableStorageTable = (typeof BILLABLE_STORAGE_TABLES)[number];

/**
 * Retention-managed tables deliberately OUTSIDE storage billing (ADR-039 v5):
 * - trace_analytics / trace_analytics_rollup: system-derived projections of
 *   already-billed trace data (billing them double-charges) and they carry no
 *   `_size_bytes` column to measure.
 * - evaluation_runs: its billing-age axis (mutable `UpdatedAt`) is decoupled
 *   from its partition axis (`ScheduledAt`), breaking both boundary edges;
 *   excluded by decision owner — revisit after the partition rework (#5209).
 */
export const EXCLUDED_RETENTION_TABLES = [
  "trace_analytics",
  "trace_analytics_rollup",
  "evaluation_runs",
] as const satisfies readonly RetentionManagedTable[];

export const billableCategoryOf = ({
  table,
}: {
  table: BillableStorageTable;
}): RetentionCategory => RETENTION_TABLE_CATEGORY_MAP[table];
