/**
 * The LangWatchQL text behind every dashboard block. Each statement reads only
 * catalog views and binds the page period through the reserved parameters, so
 * the host owns the window and the grain (ADR-130).
 */

const START = "{dashboard_context_period_start:DateTime}";
const END = "{dashboard_context_period_end:DateTime}";
const GRAIN = "{dashboard_context_granularity_seconds:UInt32}";
/** The start of the equally long window right before the page period. */
const PREVIOUS_START = `subtractSeconds(${START}, dateDiff('second', ${START}, ${END}))`;

const inPeriod = (column: string) => `${column} >= ${START} AND ${column} < ${END}`;
const bucketOf = (column: string) => `toStartOfInterval(${column}, INTERVAL ${GRAIN} SECOND)`;

export const TRACE_COUNT_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket, uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const TOTAL_COST_SQL = `SELECT ${bucketOf("BucketStart")} AS bucket, sum(CostSum) AS cost
FROM trace_metrics_by_minute
WHERE ${inPeriod("BucketStart")}
GROUP BY bucket
ORDER BY bucket`;

export const TOKENS_SQL = `SELECT ${bucketOf("BucketStart")} AS bucket,
  sum(PromptTokensSum) AS prompt_tokens,
  sum(CompletionTokensSum) AS completion_tokens
FROM trace_metrics_by_minute
WHERE ${inPeriod("BucketStart")}
GROUP BY bucket
ORDER BY bucket`;

export const LATENCY_PERCENTILES_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  quantileExact(0.5)(TotalDurationMs) AS p50,
  quantileExact(0.9)(TotalDurationMs) AS p90,
  quantileExact(0.99)(TotalDurationMs) AS p99
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const SATISFACTION_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket, avg(SatisfactionScore) AS satisfaction
FROM traces
WHERE ${inPeriod("OccurredAt")}
  AND SatisfactionScore IS NOT NULL
GROUP BY bucket
ORDER BY bucket`;

export const EVALUATION_PASS_RATE_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  countIf(Passed = 1) / count() AS pass_rate
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND Passed IS NOT NULL
GROUP BY bucket
ORDER BY bucket`;

export const TRACES_PER_THREAD_SQL = `SELECT bucket, avg(trace_count) AS traces_per_thread
FROM (
  SELECT ${bucketOf("OccurredAt")} AS bucket, ConversationId, uniqExact(TraceId) AS trace_count
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND ConversationId IS NOT NULL
    AND ConversationId != ''
  GROUP BY bucket, ConversationId
)
GROUP BY bucket
ORDER BY bucket`;

export const TOP_MODELS_SQL = `SELECT model, uniqExact(TraceId) AS traces
FROM (
  SELECT TraceId, arrayJoin(Models) AS model
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
)
GROUP BY model
ORDER BY traces DESC
LIMIT 10`;

export const TOP_TOPICS_SQL = `SELECT if(t.TopicName IS NULL OR t.TopicName = '', x.TopicId, t.TopicName) AS topic, x.traces AS traces
FROM (
  SELECT TopicId, uniqExact(TraceId) AS traces
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND TopicId IS NOT NULL AND TopicId != ''
  GROUP BY TopicId
) AS x
LEFT JOIN topics AS t ON t.TopicId = x.TopicId
ORDER BY traces DESC
LIMIT 10`;

export const ERROR_RATE_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket, countIf(HasError) / count() AS error_rate
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const P95_LATENCY_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket, quantileExact(0.95)(TotalDurationMs) AS p95_ms
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

/** Current and previous period side by side, one row: the Status tiles and their deltas. */
export const PERIOD_COMPARISON_SQL = `SELECT
  uniqExactIf(TraceId, OccurredAt >= ${START}) AS requests,
  uniqExactIf(TraceId, OccurredAt < ${START}) AS requests_prev,
  uniqExactIf(TraceId, OccurredAt >= ${START} AND HasError) AS errors,
  uniqExactIf(TraceId, OccurredAt < ${START} AND HasError) AS errors_prev,
  quantileExactIf(0.95)(TotalDurationMs, OccurredAt >= ${START}) AS p95_ms,
  quantileExactIf(0.95)(TotalDurationMs, OccurredAt < ${START}) AS p95_ms_prev,
  sumIf(TotalCost, OccurredAt >= ${START}) AS cost,
  sumIf(TotalCost, OccurredAt < ${START}) AS cost_prev
FROM trace_metrics
WHERE OccurredAt >= ${PREVIOUS_START} AND OccurredAt < ${END}`;

export const SCENARIO_PASS_RATE_SQL = `SELECT ${bucketOf("StartedAt")} AS bucket,
  countIf(Verdict = 'success') / count() AS pass_rate
FROM simulations
WHERE ${inPeriod("StartedAt")}
  AND ArchivedAt IS NULL
  AND Verdict IS NOT NULL
GROUP BY bucket
ORDER BY bucket`;

export const THROUGHPUT_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  uniqExact(TraceId) AS throughput,
  quantileExact(0.95)(TotalDurationMs) AS p95_ms,
  countIf(HasError) / count() AS error_rate
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const COST_SUMMARY_SQL = `SELECT
  uniqExact(TraceId) AS traces,
  sum(TotalCost) AS cost,
  countIf(NOT HasError) AS successes,
  sum(PromptTokens) AS tokens_in,
  sum(CompletionTokens) AS tokens_out
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}`;

export const COST_BY_MODEL_SQL = `SELECT Model AS model, sum(CostSum) AS cost
FROM model_usage_by_minute
WHERE ${inPeriod("BucketStart")}
  AND Model != ''
GROUP BY model
ORDER BY cost DESC
LIMIT 5`;

/** Error spans grouped by exception type, else error type; OTel status 2 is ERROR. */
export const FAILURES_SQL = `SELECT
  coalesce(nullIf(SpanAttributes['exception.type'], ''), nullIf(SpanAttributes['error.type'], ''), 'Unclassified error') AS category,
  SpanName AS operation,
  min(StartTime) AS first_seen,
  count() AS failures
FROM spans
WHERE ${inPeriod("StartTime")}
  AND StatusCode = 2
GROUP BY category, operation
ORDER BY failures DESC
LIMIT 7`;

export const SCENARIO_SUMMARY_SQL = `SELECT countIf(Verdict = 'success') AS passed, count() AS runs
FROM simulations
WHERE ${inPeriod("StartedAt")}
  AND ArchivedAt IS NULL
  AND Verdict IS NOT NULL`;

export const SCENARIO_SUITES_SQL = `SELECT ScenarioSetId AS suite, countIf(Verdict = 'success') AS passed, count() AS runs
FROM simulations
WHERE ${inPeriod("StartedAt")}
  AND ArchivedAt IS NULL
  AND Verdict IS NOT NULL
GROUP BY suite
ORDER BY runs DESC
LIMIT 5`;

export const FEEDBACK_SUMMARY_SQL = `SELECT countIf(IsThumbsUp = true) AS thumbs_up, countIf(IsThumbsUp = false) AS thumbs_down
FROM annotations
WHERE ${inPeriod("CreatedAt")}`;

export const FEEDBACK_RATE_SQL = `SELECT ${bucketOf("CreatedAt")} AS bucket, countIf(IsThumbsUp = true) / count() AS positive_rate
FROM annotations
WHERE ${inPeriod("CreatedAt")}
  AND IsThumbsUp IS NOT NULL
GROUP BY bucket
ORDER BY bucket`;

export const GATEWAY_ROUTES_SQL = `SELECT VirtualKeyId AS virtual_key, sum(CostNanoUSD) / 1000000000 AS cost, count() AS requests
FROM gateway_request_spend
WHERE ${inPeriod("OccurredAt")}
GROUP BY virtual_key
ORDER BY cost DESC
LIMIT 5`;

/** A session succeeded when it hit no API, internal or retry-exhausted failure. */
export const CODING_AGENTS_SQL = `SELECT Agent AS agent,
  count() AS sessions,
  sum(InputTokens + OutputTokens) AS tokens,
  sum(CostUsd) AS cost,
  countIf(ApiErrors = 0 AND InternalErrors = 0 AND RetriesExhausted = 0) / count() AS success_rate
FROM coding_sessions
WHERE ${inPeriod("StartedAt")}
GROUP BY agent
ORDER BY cost DESC`;

export const CODING_AGENT_TREND_SQL = `SELECT Agent AS agent, ${bucketOf("StartedAt")} AS bucket, count() AS sessions
FROM coding_sessions
WHERE ${inPeriod("StartedAt")}
GROUP BY agent, bucket
ORDER BY bucket`;

/**
 * Impact 0-100: error 40, latency against p95 up to 25, cost against p95 up
 * to 20, thumbs down 15.
 */
export const IMPACTFUL_TRACES_SQL = `SELECT trace_id, operation, has_error, latency_ms, cost, feedback, p95_latency,
  round(40 * has_error
    + 25 * least(ifNull(latency_ms / nullIf(p95_latency, 0), 0), 2) / 2
    + 20 * least(ifNull(cost / nullIf(p95_cost, 0), 0), 2) / 2
    + 15 * (feedback = 'down')) AS impact
FROM (
  SELECT t.TraceId AS trace_id,
    t.TraceName AS operation,
    if(t.HasError, 1, 0) AS has_error,
    t.TotalDurationMs AS latency_ms,
    ifNull(t.TotalCost, 0) AS cost,
    multiIf(a.thumbs_down > 0, 'down', a.thumbs_up > 0, 'up', '') AS feedback,
    quantileExact(0.95)(t.TotalDurationMs) OVER () AS p95_latency,
    quantileExact(0.95)(ifNull(t.TotalCost, 0)) OVER () AS p95_cost
  FROM trace_metrics AS t
  LEFT JOIN (
    SELECT TraceId, countIf(IsThumbsUp = true) AS thumbs_up, countIf(IsThumbsUp = false) AS thumbs_down
    FROM annotations
    GROUP BY TraceId
  ) AS a ON a.TraceId = t.TraceId
  WHERE ${inPeriod("t.OccurredAt")}
)
ORDER BY impact DESC
LIMIT 10`;
