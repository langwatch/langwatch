/**
 * Partition columns enabling ClickHouse pruning for time-partitioned tables.
 * Kept in sync by trace-cold-scan-detector.service.unit.test.ts.
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
  // Instant-eval judgements are month-partitioned on `CreatedAt` and kept
  // indefinitely, so the cold end grows without bound. A read by run id alone
  // prunes nothing: `RunId` sits behind `TenantId` and nothing bounds the
  // partition, so every read ranges on `CreatedAt` too.
  instant_eval_judgments: ["CreatedAt"],
} as const satisfies Record<string, readonly string[]>;
