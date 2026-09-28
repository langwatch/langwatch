/**
 * The LangWatchQL behind the question templates, one statement per answer the
 * picker's questions ask for. Views and columns are the ones the Flight Deck
 * already reads, plus `traces.SatisfactionScore` and the `topics` view.
 */

import { bucketOf, inPeriod, inPeriodAndPrevious, MIDPOINT, START } from "./lwql-period.ts";

export const TRAFFIC_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket, uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const TRACE_COUNT_SQL = `SELECT uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}`;

export const SATISFACTION_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  avg(SatisfactionScore) AS satisfaction
FROM traces
WHERE ${inPeriod("OccurredAt")}
  AND SatisfactionScore IS NOT NULL
GROUP BY bucket
ORDER BY bucket`;

export const SATISFACTION_COMPARISON_SQL = `SELECT
  avgIf(SatisfactionScore, OccurredAt >= ${START}) AS satisfaction,
  avgIf(SatisfactionScore, OccurredAt < ${START}) AS satisfaction_prev
FROM traces
WHERE ${inPeriodAndPrevious("OccurredAt")}
  AND SatisfactionScore IS NOT NULL`;

export const TOKEN_TREND_SQL = `SELECT ${bucketOf("BucketStart")} AS bucket,
  sum(PromptTokensSum) AS prompt_tokens,
  sum(CompletionTokensSum) AS completion_tokens
FROM trace_metrics_by_minute
WHERE ${inPeriod("BucketStart")}
GROUP BY bucket
ORDER BY bucket`;

/** Turns are traces; a conversation that spans buckets counts in each of them. */
export const CONVERSATION_LENGTH_SQL = `SELECT bucket, avg(turns) AS turns, count() AS conversations
FROM (
  SELECT ${bucketOf("OccurredAt")} AS bucket, ConversationId, uniqExact(TraceId) AS turns
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND ConversationId IS NOT NULL
    AND ConversationId != ''
  GROUP BY bucket, ConversationId
)
GROUP BY bucket
ORDER BY bucket`;

export const P95_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  quantileExact(0.95)(TotalDurationMs) AS p95_ms
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const LATENCY_SPREAD_SQL = `SELECT quantileExact(0.5)(TotalDurationMs) AS p50_ms,
  quantileExact(0.9)(TotalDurationMs) AS p90_ms,
  quantileExact(0.95)(TotalDurationMs) AS p95_ms,
  quantileExact(0.99)(TotalDurationMs) AS p99_ms
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}`;

export const LATENCY_PERCENTILES_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  quantileExact(0.5)(TotalDurationMs) AS p50_ms,
  quantileExact(0.9)(TotalDurationMs) AS p90_ms,
  quantileExact(0.99)(TotalDurationMs) AS p99_ms
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const COST_TREND_SQL = `SELECT ${bucketOf("BucketStart")} AS bucket, sum(CostSum) AS cost
FROM trace_metrics_by_minute
WHERE ${inPeriod("BucketStart")}
GROUP BY bucket
ORDER BY bucket`;

export const TOP_MODELS_SQL = `SELECT arrayJoin(Models) AS model, uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY model
ORDER BY traces DESC
LIMIT 10`;

export const MODEL_COSTS_SQL = `SELECT Model AS model, sum(CostSum) AS cost
FROM model_usage_by_minute
WHERE ${inPeriod("BucketStart")}
  AND Model != ''
GROUP BY model
ORDER BY cost DESC
LIMIT 50`;

export const MODEL_SPEND_TOTAL_SQL = `SELECT sum(CostSum) AS cost
FROM model_usage_by_minute
WHERE ${inPeriod("BucketStart")}
  AND Model != ''`;

export const SLOWEST_MODELS_SQL = `SELECT arrayJoin(Models) AS model,
  quantileExact(0.95)(TotalDurationMs) AS p95_ms,
  uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY model
ORDER BY p95_ms DESC
LIMIT 5`;

export const SLOWEST_OPERATIONS_SQL = `SELECT SpanName AS operation,
  sum(DurationMs) AS total_ms,
  quantileExact(0.95)(DurationMs) AS p95_ms,
  count() AS spans
FROM spans
WHERE ${inPeriod("StartTime")}
GROUP BY operation
ORDER BY total_ms DESC
LIMIT 5`;

export const EVALUATION_SUMMARY_SQL = `SELECT countIf(Passed = 1) AS passed, count() AS runs
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND Passed IS NOT NULL`;

export const LOWEST_PASSING_EVALUATORS_SQL = `SELECT EvaluatorName AS evaluator,
  countIf(Passed = 1) / count() AS pass_rate,
  count() AS runs
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND Passed IS NOT NULL
GROUP BY evaluator
ORDER BY pass_rate ASC
LIMIT 5`;

export const LOWEST_SCORES_SQL = `SELECT TraceId AS trace_id,
  EvaluatorName AS evaluator,
  Score AS score,
  Passed AS passed
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND Score IS NOT NULL
  AND TraceId IS NOT NULL
ORDER BY score ASC
LIMIT 8`;

/** Pass rate over the verdicts only; an evaluator that only scores has none. */
export const EVALUATION_COVERAGE_SQL = `SELECT EvaluatorName AS evaluator,
  count() AS runs,
  uniqExact(TraceId) AS traces,
  countIf(Passed = 1) / nullIf(countIf(Passed IS NOT NULL), 0) AS pass_rate
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY evaluator
ORDER BY runs DESC
LIMIT 8`;

export const EVALUATED_TRACES_SQL = `SELECT uniqExact(TraceId) AS traces
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND TraceId IS NOT NULL`;

export const SCENARIO_TREND_SQL = `SELECT ${bucketOf("StartedAt")} AS bucket,
  countIf(Verdict = 'success') / count() AS pass_rate,
  count() AS runs
FROM simulations
WHERE ${inPeriod("StartedAt")}
  AND ArchivedAt IS NULL
  AND Verdict IS NOT NULL
GROUP BY bucket
ORDER BY bucket`;

/** Growth is second-half traces minus first-half traces, to name the topic that grew most. */
export const TOPICS_SQL = `SELECT t.TopicId AS topic_id,
  any(p.TopicName) AS topic,
  uniqExact(t.TraceId) AS traces,
  uniqExactIf(t.TraceId, t.OccurredAt >= ${MIDPOINT})
    - uniqExactIf(t.TraceId, t.OccurredAt < ${MIDPOINT}) AS growth
FROM trace_metrics AS t
LEFT JOIN topics AS p ON p.TopicId = t.TopicId
WHERE ${inPeriod("t.OccurredAt")}
  AND t.TopicId IS NOT NULL
  AND t.TopicId != ''
GROUP BY topic_id
ORDER BY traces DESC
LIMIT 10`;

export const TOPIC_TRACES_SQL = `SELECT uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND TopicId IS NOT NULL
  AND TopicId != ''`;

export const THUMBS_DOWN_SQL = `SELECT TraceId AS trace_id,
  count() AS thumbs_down,
  max(CreatedAt) AS last_at
FROM annotations
WHERE ${inPeriod("CreatedAt")}
  AND IsThumbsUp = false
GROUP BY trace_id
ORDER BY last_at DESC
LIMIT 8`;
