import { z } from "zod";

/**
 * Every retention-managed ClickHouse table is partitioned weekly
 * (`PARTITION BY toYearWeek(...)`, see migration 00002), so a partition is the
 * unit ClickHouse can prune cheaply. Retention is therefore expressed in whole
 * weeks: a day count that isn't a multiple of 7 straddles a partition boundary
 * and buys nothing the next aligned value wouldn't. All bounds below are
 * multiples of `RETENTION_WEEK_DAYS`, and `retentionDaysSchema` rejects values
 * that aren't.
 */
export const RETENTION_WEEK_DAYS = 7;

/**
 * The minimum retention any override may set: 7 weeks. Below this, ClickHouse
 * TTL churn and the orphan sweep stop being worth the storage saved.
 */
export const MIN_RETENTION_DAYS = 49;

/**
 * The maximum retention any override may set. Retention is persisted to the
 * ClickHouse `_retention_days` column, a `UInt16` (see migration 00032), so a
 * day count above 65535 would silently wrap on write — ingestion and
 * retroactive mutations would stamp a corrupted value. Cap at the largest whole
 * week that still fits the column (9362 weeks). Indefinite retention is
 * expressed as the absence of a row, not a very large day count, so this bound
 * costs no real-world configuration.
 */
export const MAX_RETENTION_DAYS = 65534;

/**
 * The default retention proposed when creating an override: 7 weeks, the same
 * as the minimum. The absence of any override still means indefinite retention
 * — this is only the suggested starting value in the UI, not an automatically
 * applied policy.
 */
export const DEFAULT_RETENTION_DAYS = MIN_RETENTION_DAYS;

/**
 * The retention a data migration stamps onto pre-existing rows / seeds as the
 * org default when retention is first rolled out: ~10 months (44 weeks). It's
 * deliberately generous so the rollout never deletes data a customer didn't
 * opt into shrinking — distinct from the UI default, which starts at the
 * minimum.
 */
export const MIGRATION_DEFAULT_RETENTION_DAYS = 308;

/**
 * A single override's day count. `null` is not a valid stored value — a row
 * either exists with a concrete day count or it does not exist (and the next
 * tier in the cascade applies). Indefinite retention is the absence of any row.
 * Must be a whole number of weeks so it aligns with the weekly partition key.
 */
export const retentionDaysSchema = z
  .number()
  .int()
  .min(MIN_RETENTION_DAYS)
  .max(MAX_RETENTION_DAYS)
  .refine((days) => days % RETENTION_WEEK_DAYS === 0, {
    message: `Retention must be a whole number of weeks (a multiple of ${RETENTION_WEEK_DAYS} days), to align with weekly ClickHouse partitions.`,
  });

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
