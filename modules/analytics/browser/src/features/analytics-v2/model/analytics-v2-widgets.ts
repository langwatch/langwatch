/**
 * The nine Analytics v2 widget definitions — inline, never persisted; each a
 * valid version-1 DashboardWidgetDefinition bound only to the reserved
 * {dashboard_context_period_*} placeholders. Author code: ./analytics-v2-widget-code.
 */

import type { DashboardWidgetDefinition } from "../../../model/dashboard-widget-definition.ts";
import {
  avgTracesPerThreadCode,
  evaluationPassRateCode,
  latencyCode,
  satisfactionCode,
  tokensCode,
  topModelsCode,
  topTopicsCode,
  totalCostCode,
  traceCountCode,
} from "./analytics-v2-widget-code.ts";

export { ANALYTICS_V2_EMPTY_STATE_TEXT } from "./analytics-v2-widget-code.ts";

export const ANALYTICS_V2_WIDGET_IDS = [
  "trace-count-over-time",
  "total-cost-over-time",
  "tokens-over-time",
  "latency-percentiles",
  "satisfaction-over-time",
  "evaluation-pass-rate",
  "average-traces-per-thread",
  "top-models",
  "top-topics",
] as const;

export type AnalyticsV2WidgetId = (typeof ANALYTICS_V2_WIDGET_IDS)[number];

export type AnalyticsV2Widget = {
  id: AnalyticsV2WidgetId;
  title: string;
  definition: DashboardWidgetDefinition;
};

/** Build a single-query, version-1 definition with the reserved-period contract. */
function definition(code: string, sql: string): DashboardWidgetDefinition {
  return { version: 1, code, queries: [{ name: "main", sql, parameters: [] }] };
}

export const ANALYTICS_V2_WIDGETS: readonly AnalyticsV2Widget[] = [
  {
    id: "trace-count-over-time",
    title: "Trace count over time",
    definition: definition(
      traceCountCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket, uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  // Cost and tokens sum from the per-minute rollup (trace_metrics_by_minute)
  // for exact parity with legacy analytics; trace count and latency stay on
  // trace_metrics, matching legacy's distinct-trace-id count and percentiles.
  {
    id: "total-cost-over-time",
    title: "Total cost over time",
    definition: definition(
      totalCostCode,
      `SELECT toStartOfDay(BucketStart) AS bucket, sum(CostSum) AS cost
FROM trace_metrics_by_minute
WHERE BucketStart >= {dashboard_context_period_start:DateTime} AND BucketStart < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "tokens-over-time",
    title: "Tokens over time",
    definition: definition(
      tokensCode,
      `SELECT toStartOfDay(BucketStart) AS bucket,
  sum(PromptTokensSum) AS prompt_tokens,
  sum(CompletionTokensSum) AS completion_tokens
FROM trace_metrics_by_minute
WHERE BucketStart >= {dashboard_context_period_start:DateTime} AND BucketStart < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "latency-percentiles",
    title: "Latency percentiles",
    definition: definition(
      latencyCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket,
  quantileExact(0.5)(TotalDurationMs) AS p50,
  quantileExact(0.9)(TotalDurationMs) AS p90,
  quantileExact(0.99)(TotalDurationMs) AS p99
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "satisfaction-over-time",
    title: "Satisfaction over time",
    definition: definition(
      satisfactionCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket, avg(SatisfactionScore) AS satisfaction
FROM traces
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND SatisfactionScore IS NOT NULL
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "evaluation-pass-rate",
    title: "Evaluation pass rate",
    definition: definition(
      evaluationPassRateCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket,
  countIf(Passed = 1) AS passed,
  countIf(isNotNull(Passed)) AS scored
FROM evaluation_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "average-traces-per-thread",
    title: "Average traces per thread",
    definition: definition(
      avgTracesPerThreadCode,
      `SELECT day, avg(trace_count) AS avg_traces_per_thread
FROM (
  SELECT toStartOfDay(OccurredAt) AS day, ConversationId, uniqExact(TraceId) AS trace_count
  FROM trace_metrics
  WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
    AND ConversationId IS NOT NULL
    AND ConversationId != ''
  GROUP BY day, ConversationId
)
GROUP BY day
ORDER BY day`,
    ),
  },
  {
    id: "top-models",
    title: "Top models",
    definition: definition(
      topModelsCode,
      `SELECT model, uniqExact(TraceId) AS traces
FROM (
  SELECT TraceId, arrayJoin(Models) AS model
  FROM trace_metrics
  WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
)
GROUP BY model
ORDER BY traces DESC
LIMIT 10`,
    ),
  },
  {
    id: "top-topics",
    title: "Top topics",
    definition: definition(
      topTopicsCode,
      `SELECT if(t.TopicName IS NULL OR t.TopicName = '', x.TopicId, t.TopicName) AS topic, x.traces AS traces
FROM (
  SELECT TopicId, uniqExact(TraceId) AS traces
  FROM trace_metrics
  WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
    AND TopicId IS NOT NULL AND TopicId != ''
  GROUP BY TopicId
) AS x
LEFT JOIN topics AS t ON t.TopicId = x.TopicId
ORDER BY traces DESC
LIMIT 10`,
    ),
  },
];
