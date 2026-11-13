/**
 * The application's restricted ClickHouse reader (ADR-202): its names, its settings, and every
 * tenant table its row policies bound with the column naming the owning tenant.
 * @see specs/clickhouse/app-reader-row-policies.feature
 */
import type { LangWatchQLTable } from "../services/langwatch-ql-access-model.service.ts";

/** Names of the app reader's ClickHouse objects; the settings carry the `SQL_` prefix. */
export const APP_READER_NAMES = {
  user: "langwatch_app_reader",
  settingsProfile: "langwatch_app_reader_profile",
  /** Comma-separated tenant ids a read may see; the client sets it per request. */
  tenantSetting: "SQL_langwatch_tenant_ids",
  /** 0 in shadow (every row visible), 1 when enforcing; pinned `CONST` in the profile. */
  enforceSetting: "SQL_langwatch_tenancy_enforce",
} as const;

/** The `custom_settings_prefixes` entry the server must declare for the reader's settings. */
export const APP_READER_SETTINGS_PREFIX = "SQL_";

/**
 * Tenant tables keyed on `TenantId`, as the ClickHouse migrations leave them. The LangWatchQL key
 * map and eventing's log are never granted to the reader; the guard test names them with why.
 */
const TENANT_ID_TABLES = [
  "automation_audit",
  "billable_events",
  "coding_agent_session_events",
  "coding_agent_session_events_id_index",
  "coding_agent_sessions",
  "coding_agent_sessions_id_index",
  "coding_agent_trace_sessions",
  "coding_agent_trace_sessions_id_index",
  "dspy_steps",
  "dspy_steps_id_index",
  "evaluation_analytics",
  "evaluation_analytics_id_index",
  "evaluation_analytics_rollup",
  "evaluation_runs",
  "evaluation_runs_by_trace_id_index",
  "evaluation_runs_id_index",
  "experiment_run_items",
  "experiment_runs",
  "experiment_runs_by_experiment_id_index",
  "experiment_runs_id_index",
  "gateway_budget_ledger_events",
  "gateway_budget_ledger_events_id_index",
  "gateway_budget_scope_totals",
  "gateway_spend",
  "gateway_spend_id_index",
  "governance_cost_rollup_1d",
  "governance_cost_rollup_charges",
  "governance_cost_rollup_restatement_index",
  "governance_kpis",
  "governance_ocsf_events",
  "instant_eval_judgments",
  "instant_eval_runs",
  "langy_analytics_events",
  "langy_messages",
  "log_records",
  "log_usage_estimates",
  "metric_data_points",
  "metric_series",
  "metric_time_rollups",
  "metric_usage_estimates",
  "session_metric_series",
  "simulation_run_metrics",
  "simulation_run_metrics_rollup",
  "simulation_runs",
  "simulation_runs_by_batch_run_id_index",
  "simulation_runs_by_scenario_set_id_index",
  "simulation_runs_id_index",
  "span_analytics",
  "stored_log_records",
  "stored_metric_records",
  "stored_spans",
  "stored_spans_id_index",
  "suite_runs",
  "suite_runs_id_index",
  "trace_analytics",
  "trace_analytics_id_index",
  "trace_analytics_rollup",
  "trace_evaluation_analytics",
  "trace_summaries",
  "trace_summaries_id_index",
  "usage_trace_meter",
] as const;

/**
 * Every table holding tenant rows, in the application's database. A table missing here is read
 * in full by the reader, so a guard test replays the migrations and fails on any table not listed.
 */
export const APP_READER_TENANT_TABLES: readonly LangWatchQLTable[] = [
  ...TENANT_ID_TABLES.map((table) => ({ table, tenantColumn: "TenantId" })),
  { table: "stored_objects", tenantColumn: "project_id" },
];

/**
 * System tables 26.8 grants every user implicitly, which `REVOKE` does not remove. Every tenant
 * shares the reader, so a policy admitting no row hides each one (ADR-202).
 */
export const APP_READER_HIDDEN_SYSTEM_TABLES: readonly { database: string; table: string }[] = [
  { database: "system", table: "user_query_log" },
];
