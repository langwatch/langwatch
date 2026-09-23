/** Overrides for metrics-related views. */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const METRICS_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  metric_series: {
    name: "metric_series_definitions",
    description: "Metric series definitions from OpenTelemetry: name, unit, attributes, kind",
    grain: "one row per SeriesId",
    timeColumn: "LastSeenAt",
    dedup: { versionColumn: "LastSeenAt" },
  },
  metric_data_points: {
    name: "metric_points",
    description: "Individual metric data points with gauges, sums, histograms, and summaries",
    grain: "one row per (SeriesId, TimeUnixMs, PointId)",
    timeColumn: "TimeUnixMs",
    dedup: { versionColumn: "DedupVersion" },
    // Both content permissions, matching logs.CanonicalPayload: the validator gates by bare column
    // name across the catalog, so the wider set already applies to this column at query time and
    // the schema door must say so.
    columnGates: { CanonicalPayload: ["input", "output"] },
    columnUnits: {
      TimeUnixMs: "ms",
    },
  },
  metric_time_rollups: {
    name: "metric_rollups",
    description:
      "Time-bucketed rollups of a metric series: per-bucket min, max, sum, count and histogram buckets.",
    grain: "one row per (SeriesId, BucketStart)",
    timeColumn: "BucketStart",
    dedup: { versionColumn: "UpdatedAt" },
  },
  metric_usage_estimates: {
    name: "metric_ingestion_usage",
    description: "Per-tenant metric ingestion usage estimates",
    timeColumn: "AcceptedAt",
    dedup: { versionColumn: "DedupVersion" },
  },
  session_metric_series: {
    name: "session_metrics",
    description: "Per-session time-series metrics with aggregate statistics",
    grain: "one row per (SessionId, SeriesId)",
    timeColumn: "AsOf",
    // `ReplacingMergeTree(AsOf)`: the engine collapses on AsOf, so that is the
    // version — not the bookkeeping UpdatedAt.
    dedup: { versionColumn: "AsOf" },
  },
  simulation_run_metrics: {
    name: "simulation_trace_metrics",
    description: "Cost and latency metrics per simulated trace",
    grain: "one row per (ScenarioRunId, TraceId)",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "OccurredAt" },
  },
  simulation_run_metrics_rollup: {
    name: "simulation_metric_rollups",
    description:
      "Per-trace simulation cost and latency, merged from the aggregating rollup: total cost and per-role cost and latency maps.",
    // AggregatingMergeTree: each measure is an AggregateFunction state the
    // builder finalises with its merge combinator (argMaxMerge, maxMerge) under
    // a GROUP BY the engine key.
    dedup: { aggregating: true },
    // The source partitions by PartitionMonth (a plain YYYYMM anchor), not by
    // OccurredAt — OccurredAt is the merged AggregateFunction state exposed
    // for reading, but it prunes nothing. PartitionMonth is the column a
    // caller filters on to skip partitions.
    timeColumn: "PartitionMonth",
  },
};
