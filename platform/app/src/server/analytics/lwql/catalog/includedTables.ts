/**
 * The ClickHouse tables the derived-view catalog exposes.
 *
 * The catalog is opt-*in*: {@link ./defineDatasetFromTable#deriveDefaultCatalog}
 * turns a manifest table into a view only when the table is named here (and is
 * not already hand-written). This list is the one and only way a table enters
 * the derived catalog — a table not on it is simply not queryable through
 * LangWatchQL, and needs no entry anywhere else to stay off. There is no skip
 * list and no per-table reason string to write: absence is the default, and
 * inclusion is the deliberate act. See
 * {@link ../../../../../../dev/docs/adr/142-lwql-catalog-inclusion-is-opt-in.md}.
 *
 * A `*_mv` / `.inner` materialised-view internal is simply left off, rather than
 * matched by a skip pattern; the same goes for engine-internal bookkeeping and
 * for anything reached through another surface. The only remaining skip
 * mechanism is column-level: an override's `skipColumns` still strips individual
 * columns from a table that is otherwise included.
 *
 * A table named here that the manifest does not carry — or one that is also
 * hand-written — fails the build loudly: the derivation throws naming the entry,
 * and {@link ./__tests__/tenantTableCoverage.unit.test.ts} pins the count.
 *
 * `governance_*` tables are on the list: every row of them is written under the
 * org's hidden `internal_governance` project, so visibility is a row-policy
 * question decided in `catalog/overrides/governance.ts`, not a cataloguing one.
 *
 * @see ./defineDatasetFromTable.ts — what the include list turns into views
 * @see ./postgresIncludedModels.ts — the Postgres half this mirrors
 */

/**
 * Every ClickHouse manifest table the catalog derives, grouped by domain for
 * review. Order does not affect the output (the derivation filters the manifest
 * in manifest order); the grouping is only for a reader.
 */
export const LWQL_CLICKHOUSE_INCLUDED_TABLES: readonly string[] = [
  // Governance and gateway audit
  "automation_audit",
  "billable_events",
  // Coding-agent trace sessions
  "coding_agent_trace_sessions",
  // Optimization-studio steps
  "dspy_steps",
  // Event log
  "event_log",
  // Experiment runs
  "experiment_run_items",
  "experiment_runs",
  // Gateway budgets and spend
  "gateway_budget_ledger_events",
  "gateway_budget_scope_totals",
  "gateway_spend",
  // Governance cost rollups and KPIs
  "governance_cost_rollup_1d",
  "governance_cost_rollup_restatement_index",
  "governance_kpis",
  "governance_ocsf_events",
  // Langy analytics and messages
  "langy_analytics_events",
  "langy_messages",
  // Logs
  "log_records",
  "log_usage_estimates",
  // Metrics
  "metric_data_points",
  "metric_series",
  "metric_time_rollups",
  "metric_usage_estimates",
  "session_metric_series",
  // Simulation metrics
  "simulation_run_metrics",
  "simulation_run_metrics_rollup",
  // Stored records and objects
  "stored_log_records",
  "stored_metric_records",
  "stored_objects",
  // Suite runs
  "suite_runs",
];
