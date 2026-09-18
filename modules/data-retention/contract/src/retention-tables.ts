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

/**
 * Durable authentication and authorization state is not customer telemetry.
 * These names cover the PostgreSQL projections/row-truth today and reserve
 * their ClickHouse-style spellings against accidental future TTL enrollment.
 */
export const SECURITY_RETENTION_EXEMPT_TABLES = [
  "identity_projection_cursor",
  "identifier",
  "identifier_reservation",
  "sso_connection",
  "join_request",
  "scim_sync_state",
  "scim_external_id",
  "scim_token",
  "authz_projection_cursor",
  "role_binding",
  "grant",
  "grant_usage",
  "role",
  "account",
  "account_credential",
  "passkey",
  "two_factor",
  "mfa_enrollment",
  "organization_user",
  "team_user",
  "group",
  "group_membership",
  "custom_role",
] as const;

const securityRetentionExemptTables = new Set<string>(SECURITY_RETENTION_EXEMPT_TABLES);

for (const table of Object.keys(RETENTION_TABLE_CATEGORY_MAP)) {
  if (securityRetentionExemptTables.has(table)) {
    throw new Error(
      `${table} is durable security state and cannot be enrolled in tenant retention`,
    );
  }
}

export type RetentionManagedTable = keyof typeof RETENTION_TABLE_CATEGORY_MAP;

export const RETENTION_MANAGED_TABLES = Object.keys(
  RETENTION_TABLE_CATEGORY_MAP,
) as RetentionManagedTable[];

/**
 * Tables with indefinite default retention (0 days); must not be moved into
 * RETENTION_TABLE_CATEGORY_MAP as it would change their TTL behavior.
 */
export const INDEFINITE_DEFAULT_RETENTION_TABLES = [
  "governance_cost_rollup_1d",
  "governance_cost_rollup_restatement_index",
] as const;

export type IndefiniteDefaultRetentionTable = (typeof INDEFINITE_DEFAULT_RETENTION_TABLES)[number];

/**
 * Every table the TTL reconciler manages; wider than RETENTION_MANAGED_TABLES
 * to include indefinite-default tables.
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
