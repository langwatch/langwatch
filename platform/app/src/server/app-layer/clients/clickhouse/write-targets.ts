/**
 * The engine behind each table, which is what decides whether a failed insert
 * may be re-sent (ADR-109 decision 4, ADR-104 §2).
 *
 * One table rather than a `target:` literal at each call site, because the
 * answer is a fact about the schema and not about the caller: two repositories
 * writing `trace_analytics` must not be able to disagree about whether a retry
 * duplicates. A literal at the call site is a guess someone makes while
 * thinking about something else, and the two ways to guess wrong are "duplicate
 * every row on a blip" and "never retry anything".
 *
 * Values were read from `system.tables.engine` on a migrated database, not
 * inferred from the migration files, so a table whose engine was changed by a
 * later migration is recorded as what it actually is.
 *
 * `append` does not appear here. Every table this application writes through
 * hand-written SQL is either `ReplacingMergeTree` or `AggregatingMergeTree`;
 * the append-shaped tables are written through `@langwatch/clickhouse`'s own
 * `clickhouseAppend` store, which derives its target from the `defineTable`
 * declaration and never consults this map.
 */

import type { WriteTarget } from "@langwatch/clickhouse";

/**
 * A `ReplacingMergeTree`. A duplicate insert collapses at merge onto the same
 * sort key, so the write is retryable.
 */
const REPLACING: WriteTarget = { kind: "replacing" };

/**
 * An `AggregatingMergeTree`. Merging *adds*, so a duplicate insert silently
 * inflates the aggregate and can never be collapsed back out. Never retried.
 */
const AGGREGATING: WriteTarget = { kind: "aggregating" };

const WRITE_TARGETS = {
  automation_audit: REPLACING,
  billable_events: REPLACING,
  coding_agent_sessions: REPLACING,
  coding_agent_trace_sessions: REPLACING,
  dspy_steps: REPLACING,
  evaluation_analytics: REPLACING,
  evaluation_analytics_rollup: AGGREGATING,
  evaluation_runs: REPLACING,
  event_log: REPLACING,
  experiment_run_items: REPLACING,
  experiment_runs: REPLACING,
  gateway_budget_ledger_events: REPLACING,
  gateway_budget_scope_totals: AGGREGATING,
  governance_kpis: REPLACING,
  governance_ocsf_events: REPLACING,
  langy_analytics_events: REPLACING,
  langy_messages: REPLACING,
  log_records: REPLACING,
  log_usage_estimates: REPLACING,
  metric_data_points: REPLACING,
  metric_series: REPLACING,
  metric_time_rollups: REPLACING,
  metric_usage_estimates: REPLACING,
  session_metric_series: REPLACING,
  simulation_runs: REPLACING,
  stored_log_records: REPLACING,
  stored_metric_records: REPLACING,
  stored_objects: REPLACING,
  stored_spans: REPLACING,
  suite_runs: REPLACING,
  trace_analytics: REPLACING,
  trace_analytics_rollup: AGGREGATING,
  trace_summaries: REPLACING,
} as const satisfies Record<string, WriteTarget>;

export type WritableTable = keyof typeof WRITE_TARGETS;

/**
 * The write target for a table this application inserts into.
 *
 * Typed rather than a string lookup returning `undefined`, so a table missing
 * from the map is a compile error at the call site — which is the moment
 * someone adding a table is in a position to say what its engine is — instead
 * of a runtime `undefined` that would have to be defaulted, and any default
 * here is one of the two wrong guesses.
 */
export function writeTargetFor(table: WritableTable): WriteTarget {
  return WRITE_TARGETS[table];
}
