import type { AggregationTemporality, MetricKind } from "../schema";
import { isRecord, type UnknownRecord } from "./serialization";

/** The OTLP field name carrying each kind's data container. */
export const METRIC_KIND_DATA_KEY: Record<MetricKind, string> = {
  gauge: "gauge",
  sum: "sum",
  histogram: "histogram",
  exponential_histogram: "exponentialHistogram",
  summary: "summary",
};

const KINDS_BY_DATA_KEY: Array<[string, MetricKind]> = Object.entries(
  METRIC_KIND_DATA_KEY,
).map(([kind, key]) => [key, kind as MetricKind]);

/** A metric must carry exactly one data container; more than one is ambiguous. */
export function metricKind(metric: UnknownRecord): MetricKind | null {
  const present = KINDS_BY_DATA_KEY.filter(([key]) => isRecord(metric[key]));
  return present.length === 1 ? present[0]![1] : null;
}

/** Best-effort count of points an unusable metric would otherwise have contributed. */
export function candidatePointCount(metric: UnknownRecord): number {
  const count = KINDS_BY_DATA_KEY.reduce((total, [key]) => {
    const container = metric[key];
    if (!isRecord(container) || !Array.isArray(container.dataPoints))
      return total;
    return total + container.dataPoints.length;
  }, 0);
  return Math.max(1, count);
}

export function aggregationTemporalityOf(args: {
  metricData: UnknownRecord;
  kind: MetricKind;
}): AggregationTemporality {
  const { metricData, kind } = args;
  if (kind === "gauge" || kind === "summary") return "unspecified";
  const value = metricData.aggregationTemporality;
  if (value === 1 || String(value).endsWith("DELTA")) return "delta";
  if (value === 2 || String(value).endsWith("CUMULATIVE")) return "cumulative";
  return "unspecified";
}
