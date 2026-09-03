/**
 * Tables partitioned by a time expression, mapped to the column names that, when
 * used in a WHERE/PREWHERE comparison, let ClickHouse prune partitions.
 *
 * Several of our largest tables tier old partitions to S3 (see the
 * clickhouse-serverless storage policy), so a query against one of these
 * WITHOUT a predicate on its partition time column cannot prune and walks
 * every partition including the cold ones — the dominant driver of our S3
 * request bill. Two callers read this same fact from two different angles:
 * the trace-server cold-scan detector flags a query missing the predicate
 * entirely, and the analytics-server JOIN guard checks that a range bound
 * names one of these columns rather than a column the bounded table hasn't
 * got (which ClickHouse resolves against the enclosing scope instead of
 * failing). One map, so the two can't drift.
 *
 * Kept in sync with the migrations in `../migrations` by
 * `trace-cold-scan-detector.service.unit.test.ts`, which parses every
 * `PARTITION BY` out of the migration files and fails when one is missing
 * here. That test exists because the failure mode is SILENT: a table absent
 * from this map is treated as not time-partitioned and is never flagged, so a
 * new table gets no cold-scan detection at all and nobody finds out.
 *
 * Not hypothetical — this map covered 11 of 35 partitioned tables until the
 * coverage test was added, and the 24 missing ones included `trace_analytics`
 * and `trace_summaries`, whose unwindowed reads were running as UNDETECTED cold
 * scans at ~350/min in production.
 */
export const TIME_PARTITIONED_TABLES = {
  stored_spans: ["StartTime"],
  stored_log_records: ["TimeUnixMs"],
  stored_metric_records: ["TimeUnixMs"],
  log_records: ["TimeUnixMs"],
  metric_data_points: ["TimeUnixMs"],
  metric_series: ["LastSeenAt"],
  metric_time_rollups: ["BucketStart"],
  metric_usage_estimates: ["AcceptedAt", "AcceptedHour"],
  log_usage_estimates: ["AcceptedAt", "AcceptedHour"],
  event_log: ["EventOccurredAt"],
  billable_events: ["EventTimestamp"],
  governance_ocsf_events: ["EventTime"],

  // Fold / projection tables. Read by aggregate id, which is NOT a sort-key
  // prefix on several of them, so an unwindowed read is a tenant-wide scan
  // across every partition — exactly what this detector exists to surface.
  trace_analytics: ["OccurredAt"],
  trace_analytics_rollup: ["BucketStart"],
  trace_summaries: ["OccurredAt"],
  evaluation_analytics: ["OccurredAt"],
  evaluation_analytics_rollup: ["BucketStart"],
  evaluation_runs: ["ScheduledAt"],
  coding_agent_sessions: ["StartedAt"],
  coding_agent_trace_sessions: ["OccurredAt"],
  coding_agent_session_events: ["TimeUnixMs"],
  session_metric_series: ["AsOf"],

  // Run / experiment tables.
  experiment_runs: ["StartedAt"],
  experiment_run_items: ["OccurredAt"],
  simulation_runs: ["StartedAt"],
  simulation_run_metrics: ["OccurredAt"],
  // The rollup prunes on its plain `PartitionMonth` anchor, not `OccurredAt`:
  // that column is an AggregateFunction state there and cannot be a partition
  // expression.
  simulation_run_metrics_rollup: ["PartitionMonth"],
  suite_runs: ["StartedAt"],
  dspy_steps: ["CreatedAt"],

  // Gateway / governance / misc.
  gateway_budget_ledger_events: ["OccurredAt"],
  // The spend record: month-partitioned on OccurredAt with a fixed
  // 13-month TTL; the pull surface is ranged by contract, and any
  // unwindowed read here walks all 13 months under FINAL.
  gateway_spend: ["OccurredAt"],
  gateway_budget_scope_totals: ["PeriodStart"],
  governance_kpis: ["HourBucket"],
  automation_audit: ["OccurredAt"],
  langy_analytics_events: ["OccurredAt"],
  langy_messages: ["CreatedAt"],
  stored_objects: ["created_at"],
} as const satisfies Record<string, readonly string[]>;
