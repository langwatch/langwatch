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
 * The absolute minimum retention any override may persist: 5 weeks (35 days).
 *
 * This is the paid tier's short option ("~1 month"). It is deliberately BELOW
 * the 49-day recovery floor that free and enterprise keep: paid retention is a
 * packaging lever, and a paid org opts into a shorter (35d) window than free
 * (49d) — an inverted-recovery trade-off locked in the plan-gated-menu ADR
 * (v4). The schema alone therefore no longer guarantees ≥49; the 49-day floor
 * for non-paid (enterprise / self-hosted) CUSTOM values is re-enforced in the
 * plan gate (`assertPlanAllowsRetentionValue`), not here. See
 * `ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS`.
 */
export const MIN_RETENTION_DAYS = 35;

/**
 * The floor for any CUSTOM (free-form) retention value on the enterprise /
 * self-hosted tiers, and the recovery floor free/enterprise data keeps. Paid's
 * sub-floor options (`PAID_RETENTION_PRESET_DAYS`) are the only values allowed
 * below this, and only as fixed presets — never as custom input. Gate-enforced,
 * not schema-enforced (the schema floor is `MIN_RETENTION_DAYS = 35`).
 */
export const ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS = 49;

/**
 * The fixed retention menu for PAID (non-enterprise SaaS) organizations:
 * "~1 month" and "~2 months", snapped UP to whole weeks (30→35 = 5wk,
 * 60→63 = 9wk) so both align to the weekly ClickHouse partition key. Paid orgs
 * may pick ONLY these two values — no custom, no other presets. Enterprise also
 * offers these two as its short options, but reaches longer windows via its
 * full preset list plus custom (≥49). The gate treats membership in this list
 * as the sole exception to the enterprise 49-day custom floor.
 */
export const PAID_RETENTION_PRESET_DAYS = [35, 63] as const;

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
 * Fallback starting value for the override drawer when a tier-specific default
 * can't be derived. The drawer itself defaults to the first preset of the
 * caller's plan menu (paid → 35, enterprise → 35); this constant is only the
 * floor-aligned backstop. The value actually stamped when no override exists is
 * PLATFORM_DEFAULT_RETENTION_DAYS (see below), not this.
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
const PRODUCTION_PLATFORM_DEFAULT_RETENTION_DAYS = 49;

/**
 * Resolve the platform retention default, honouring a local-dev override.
 *
 * `LANGWATCH_DEFAULT_RETENTION_DAYS` lets a local stack (haven pins it to 7) run
 * with a tiny default so ClickHouse stays small. It is a DEV-ONLY affordance:
 * shrinking the platform default in production would silently expire customer
 * data, so if the var is set while `NODE_ENV=production` we fail loud at module
 * load rather than honour it. The value must be a positive whole number of weeks
 * (the weekly partition key), enforced the same way `retentionDaysSchema` does.
 *
 * Takes its environment as an argument (defaulting to `process.env`) so the
 * branches are unit-testable without reloading the module.
 */
export function resolvePlatformDefaultRetentionDays(
  env: {
    LANGWATCH_DEFAULT_RETENTION_DAYS?: string;
    NODE_ENV?: string;
  } = process.env,
): number {
  const raw = env.LANGWATCH_DEFAULT_RETENTION_DAYS;
  if (raw == null || raw === "") {
    return PRODUCTION_PLATFORM_DEFAULT_RETENTION_DAYS;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "LANGWATCH_DEFAULT_RETENTION_DAYS must not be set in production: the platform retention default is fixed at " +
        `${PRODUCTION_PLATFORM_DEFAULT_RETENTION_DAYS} days, and lowering it would silently expire customer data. ` +
        "Configure per-tenant retention through RetentionPolicy overrides instead.",
    );
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0 || days % RETENTION_WEEK_DAYS !== 0) {
    throw new Error(
      `LANGWATCH_DEFAULT_RETENTION_DAYS=${raw} is invalid: it must be a positive whole number of weeks ` +
        `(a multiple of ${RETENTION_WEEK_DAYS}) so it aligns with the weekly partition key.`,
    );
  }
  return days;
}

/**
 * The platform retention default, fixed at 49 days in production and overridable
 * only by a local-dev stack via `LANGWATCH_DEFAULT_RETENTION_DAYS` (see
 * `resolvePlatformDefaultRetentionDays`). Read once at module load.
 */
export const PLATFORM_DEFAULT_RETENTION_DAYS =
  resolvePlatformDefaultRetentionDays();

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
  })
  // Defense-in-depth for the tier-dependent floor: the only value the schema
  // accepts below ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS is a fixed paid preset.
  // The plan gate still owns the per-tier rule (a paid preset isn't valid for
  // *every* tier), but this stops any path — now or a future ungated caller —
  // from persisting an arbitrary sub-floor value like 42. Without it, dropping
  // MIN to 35 would let 35–48 through the type boundary unchecked.
  .refine(
    (days) =>
      (PAID_RETENTION_PRESET_DAYS as readonly number[]).includes(days) ||
      days >= ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
    {
      message: `Retention under ${ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS} days is only available as a fixed plan option (${PAID_RETENTION_PRESET_DAYS.join(
        " or ",
      )} days).`,
    },
  );

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
 * Accepted input for setting an override: either a finite retention (a paid
 * preset, or ≥ 49 days, always whole weeks — see `retentionDaysSchema`) or the
 * indefinite sentinel (0 = keep forever). Allowing 0 here is structural only —
 * authorization for the indefinite case is enforced separately in the route
 * (platform admins only), never by this schema.
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
  log_records: "traces",
  metric_data_points: "traces",
  metric_series: "traces",
  metric_time_rollups: "traces",
  trace_summaries: "traces",
  // ADR-034: both analytics projections derive from trace events and age with
  // the same per-project retention policy as trace_summaries.
  trace_analytics: "traces",
  trace_analytics_rollup: "traces",
  evaluation_runs: "traces",
  // ADR-034 Phase 6: eval analytics tables age with the same per-project
  // retention policy as evaluation_runs (and trace_summaries — both currently
  // categorised "traces" until eval split-out lands).
  evaluation_analytics: "traces",
  evaluation_analytics_rollup: "traces",
  // Content-free Langy event analytics derives from the canonical event log
  // and ages/meters with the same project trace-retention policy.
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
 * Tables included in the customer-visible production storage meter. Canonical
 * metrics follow trace retention, but remain shadow-only for pricing: their
 * raw source bytes and derived rows must not affect billed storage totals.
 *
 * `log_records` is deliberately NOT shadowed, and that asymmetry is the point:
 * logs were already billed here via `stored_log_records`, which canonical logs
 * replace, so shadowing them would stop billing log storage entirely once the
 * legacy table drains. Metrics are a new data type that was never billed, so
 * they stay shadowed until priced.
 *
 * This does not make the cutover a price rise. Both tables meter the record's
 * *content*, not its physical row: `stored_log_records._size_bytes` is
 * `MATERIALIZED byteSize(Body, Attributes, ResourceAttributes, …)` (00032),
 * while `log_records._size_bytes` is app-supplied `canonicalSizeBytes` — the
 * byte length of the canonical payload alone. The canonical row denormalises
 * that content into BodyJson/BodyText, Attributes{,Flat}Json and a ZSTD(6)
 * CanonicalPayload, and none of that duplication is billed; the delta is JSON
 * serialisation overhead, not a multiple. Supplying `_size_bytes` from the app
 * is a deliberate exception to 00032's "never pass _size_bytes in INSERTs" —
 * possible only because these columns are DEFAULT 0 rather than MATERIALIZED.
 */
const SHADOW_METRIC_STORAGE_TABLES = new Set<RetentionManagedTable>([
  "metric_data_points",
  "metric_series",
  "metric_time_rollups",
]);

export const PRODUCTION_STORAGE_METER_TABLES = RETENTION_MANAGED_TABLES.filter(
  (table) => !SHADOW_METRIC_STORAGE_TABLES.has(table),
);
