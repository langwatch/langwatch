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
 * as the minimum. This is only the suggested starting value in the UI; the
 * value actually stamped when no override exists is PLATFORM_DEFAULT_RETENTION_DAYS
 * (see below), not indefinite.
 */
export const DEFAULT_RETENTION_DAYS = MIN_RETENTION_DAYS;

/**
 * The retention actually stamped on a tenant's data when no override exists
 * anywhere in its scope cascade: 7 weeks. Retention is default-on — absence of
 * an override does NOT mean indefinite, it means "use the platform default".
 * This is the value `resolveRetention` returns for an unconfigured category and
 * the fallback every ingestion write path stamps when a resolved value is
 * unavailable, so new rows are never silently left to the migration column
 * default. Distinct from MIGRATION_DEFAULT_RETENTION_DAYS, which only
 * grandfathers data that predates the column. Must stay a whole number of weeks
 * (weekly partition key).
 */
export const PLATFORM_DEFAULT_RETENTION_DAYS = 49;

/**
 * The ClickHouse `_retention_days` column DEFAULT (migration 00032): the value
 * pre-existing rows read lazily because they were written before the column
 * existed. ~10 months (44 weeks), deliberately generous so first rollout never
 * shrinks data a customer didn't opt into shrinking. Distinct from
 * PLATFORM_DEFAULT_RETENTION_DAYS (what new inserts are stamped) and from
 * DEFAULT_RETENTION_DAYS (the UI's suggested starting value for a new override).
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

/**
 * The sentinel day-count meaning "keep data indefinitely" — exempt from TTL
 * deletion. The TTL expression maps 0 to the year-2106 sentinel, so a row
 * stamped 0 is never deleted (see ttlReconciler). This is NOT a
 * customer-configurable tier: `retentionDaysSchema` (a tier override's value)
 * rejects it. Only `retentionDaysInputSchema` accepts it, and the mutation
 * route authorizes the indefinite case for platform admins only — see
 * `assertCanDisableRetention`.
 */
export const INDEFINITE_RETENTION_DAYS = 0;

/**
 * Accepted input for setting an override: either a finite retention (≥ 49 days,
 * whole weeks) or the indefinite sentinel (0 = keep forever). Allowing 0 here
 * is structural only — authorization for the indefinite case is enforced
 * separately in the route (platform admins only), never by this schema.
 */
export const retentionDaysInputSchema = z.union([
  z.literal(INDEFINITE_RETENTION_DAYS),
  retentionDaysSchema,
]);

export const RETENTION_CATEGORIES = [
  "traces",
  "scenarios",
  "experiments",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export const retentionCategorySchema = z.enum(RETENTION_CATEGORIES);

/**
 * The fully-resolved retention for a project: a concrete day count per
 * category. `resolveRetention` floors every category to
 * PLATFORM_DEFAULT_RETENTION_DAYS when no override exists in the cascade, so a
 * resolved value is never 0 — 0 (indefinite) is only a TTL-expression sentinel,
 * not a value the resolver ever returns.
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
