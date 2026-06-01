import { z } from "zod";

/**
 * The minimum retention any override may set. Below this, ClickHouse TTL churn
 * and the orphan sweep stop being worth the storage saved.
 */
export const MIN_RETENTION_DAYS = 30;

/**
 * A single override's day count. `null` is not a valid stored value — a row
 * either exists with a concrete day count or it does not exist (and the next
 * tier in the cascade applies). Indefinite retention is the absence of any row.
 */
export const retentionDaysSchema = z.number().int().min(MIN_RETENTION_DAYS);

export const RETENTION_CATEGORIES = [
  "traces",
  "scenarios",
  "experiments",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export const retentionCategorySchema = z.enum(RETENTION_CATEGORIES);

/**
 * The fully-resolved retention for a project: a concrete day count per
 * category (0 = indefinite, the cascade fell through to no override).
 */
export type ResolvedRetention = Record<RetentionCategory, number>;

/**
 * Which ClickHouse table belongs to which retention category. Drives both the
 * TTL reconciler and the per-category storage breakdown. `as const satisfies`
 * keeps the keys as a string-literal union so consumers like
 * `RETENTION_TABLE_CATEGORY_MAP[someTable]` get narrow typing (typos fail at
 * the call site instead of silently returning undefined).
 */
export const RETENTION_TABLE_CATEGORY_MAP = {
  event_log: "traces",
  stored_spans: "traces",
  stored_log_records: "traces",
  stored_metric_records: "traces",
  trace_summaries: "traces",
  evaluation_runs: "traces",
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
