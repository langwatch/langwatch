/**
 * Overrides for metrics-related datasets.
 *
 * All metric tables are typed-scalar only: timestamps, numeric measures, and
 * low-cardinality enums. No content or cost gating applies.
 *
 * `metric_time_rollups` and `simulation_run_metrics_rollup` are NOT here:
 * both are `AggregatingMergeTree` sources whose engine-key columns need a
 * genuine measure/merge split (`summed`, argMax-style merges) the derived
 * builder does not synthesize — skipped with a reason in `../skippedTables.ts`
 * as a follow-up, same as `gateway_budget_scope_totals`.
 */

import type { Partial } from "lodash";
import type { DatasetOverride } from "../defineDatasetFromTable";

export const METRICS_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  metric_series: {
    name: "metric_series_definitions",
    description:
      "Metric series definitions from OpenTelemetry: name, unit, attributes, kind",
    grain: "one row per SeriesId",
    timeColumn: "LastSeenAt",
    dedup: { versionColumn: "LastSeenAt" },
  },
  metric_data_points: {
    name: "metric_points",
    description:
      "Individual metric data points with gauges, sums, histograms, and summaries",
    grain: "one row per (SeriesId, TimeUnixMs, PointId)",
    timeColumn: "TimeUnixMs",
    dedup: { versionColumn: "DedupVersion" },
    columnUnits: {
      TimeUnixMs: "ms",
    },
  },
  metric_usage_estimates: {
    name: "metric_ingestion_usage",
    description: "Per-tenant metric ingestion usage estimates",
    dedup: { versionColumn: "DedupVersion" },
  },
  session_metric_series: {
    name: "session_metrics",
    description: "Per-session time-series metrics with aggregate statistics",
    grain: "one row per (SessionId, SeriesId)",
    timeColumn: "AsOf",
    dedup: { versionColumn: "UpdatedAt" },
    // See gateway.ts's gateway_spend for why an unfiltered Map is dropped
    // rather than exposed.
    skipColumns: ["Attributes"],
  },
  simulation_run_metrics: {
    name: "simulation_trace_metrics",
    description: "Cost and latency metrics per simulated trace",
    grain: "one row per (ScenarioRunId, TraceId)",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "OccurredAt" },
    skipColumns: ["RoleCosts", "RoleLatencies"],
  },
};
