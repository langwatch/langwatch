/**
 * Source-classification for analytics metric keys — ADR-034 Phase 3/6.
 * `pickAnalyticsTable` needs to know whether a metric reads off the trace
 * or evaluation pipeline, to pick the right table, fallback, and triggers.
 */

/** The upstream pipeline whose fold a metric reads from. */
export type AnalyticsMetricSource = "trace" | "evaluation";

/**
 * Source of a registry metric key, by prefix heuristic on the registry
 * group (`evaluations.*` is eval-domain, else trace-domain); `undefined`
 * means a legacy-only group with no fast-path mapping.
 */
export function classifyMetricSource(metricKey: string): AnalyticsMetricSource | undefined {
  const TRACE_METRIC_PREFIXES = ["performance.", "metadata.", "topics.", "traces."];
  const TRACE_METRIC_KEYS = ["models", "trace_name"];
  const isTraceMetric =
    TRACE_METRIC_PREFIXES.some((prefix) => metricKey.startsWith(prefix)) ||
    TRACE_METRIC_KEYS.includes(metricKey);
  if (isTraceMetric) {
    return "trace";
  }
  if (metricKey.startsWith("evaluations.")) {
    return "evaluation";
  }
  return undefined;
}
