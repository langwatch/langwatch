/**
 * Overrides for metrics-related datasets.
 *
 * All metric tables are typed-scalar only: timestamps, numeric measures, and
 * low-cardinality enums. No content or cost gating applies.
 */

import type { Partial } from "lodash";
import type { DatasetOverride } from "../defineDatasetFromTable";

export const METRICS_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  metric_series: {
    description:
      "Metric series definitions from OpenTelemetry: name, unit, attributes, kind",
    grain: "one row per SeriesId",
    timeColumn: "LastSeenAt",
  },
  metric_data_points: {
    description:
      "Individual metric data points with gauges, sums, histograms, and summaries",
    grain: "one row per (SeriesId, TimeUnixMs, PointId)",
    timeColumn: "TimeUnixMs",
  },
  metric_time_rollups: {
    description: "Time-bucketed aggregates of metric data points",
    grain: "one row per (SeriesId, BucketStart)",
    timeColumn: "BucketStart",
    dedup: {
      aggregating: true,
    },
  },
  session_metric_series: {
    description: "Per-session time-series metrics with aggregate statistics",
    grain: "one row per (SessionId, SeriesId)",
    timeColumn: "AsOf",
  },
  simulation_run_metrics: {
    description: "Cost and latency metrics per simulated trace",
    grain: "one row per (ScenarioRunId, TraceId)",
    timeColumn: "OccurredAt",
  },
  simulation_run_metrics_rollup: {
    description:
      "Latest cost and latency metrics per simulated trace (aggregated)",
    grain: "one row per (ScenarioRunId, TraceId)",
    timeColumn: "OccurredAt",
    dedup: {
      aggregating: true,
    },
  },
};
