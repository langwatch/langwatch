/**
 * The LangWatchQL behind the org Flight deck: three statements per project, shared by every
 * widget, run once per project the member can see (`scope: "organization"`). Production traffic
 * only, so LangWatch's own Langy traces, evaluations and simulations stay out.
 */

import { bucketOf, END, inPeriod, START } from "../../templates/model/lwql-period.ts";
import { PRESENCE_DAYS } from "../../templates/model/source-presence-queries.ts";
import { OUTCOME_JUDGE } from "./flight-deck-costs-queries.ts";

/** The agent a trace names, then its service; empty when neither, and the project stands in. */
const agentOf = (table: string) => `coalesce(nullIf(${table}Attributes['gen_ai.agent.name'], ''),
      nullIf(${table}Attributes['agent.name'], ''),
      nullIf(${table}Attributes['service.name'], ''), '')`;

/** What the customer's agents did: not Langy, evaluations or simulations. */
const productionOf = (table: string) =>
  `${table}Attributes['langwatch.origin'] IN ('', 'application', 'gateway')`;

/** Whole weeks back to each earlier window: one for a day or a week, five for a month. */
const STEP_DAYS = `7 * greatest(1, toUInt32(ceil(dateDiff('second', ${START}, ${END}) / 604800)))`;
/** The board's period is `wk` 0; `wk` 1 to 4 are the same window one to four steps earlier. */
const WEEKS = "arrayJoin([0, 1, 2, 3, 4])";
const LOOKBACK_START = `subtractDays(${START}, 4 * ${STEP_DAYS})`;
const inWeek = (column: string) =>
  `${column} >= subtractDays(${START}, wk * ${STEP_DAYS})
    AND ${column} < subtractDays(${END}, wk * ${STEP_DAYS})`;

/** Checks passed and judged per trace, guardrails left out. */
const checksSince = (from: string) => `SELECT TraceId, countIf(Passed = 1) AS passed,
    count() AS judged
  FROM evaluation_metrics
  WHERE OccurredAt >= ${from}
    AND Passed IS NOT NULL
    AND NOT IsGuardrail
  GROUP BY TraceId`;

/**
 * Per agent and window: traffic, errors, p95 latency, cost, traces on a model with no price and
 * traces with no cost or model at all, checks passed and judged, and the last trace.
 */
export const DECK_SQL = `SELECT agent, wk,
  uniqExact(trace_id) AS traces,
  uniqExactIf(trace_id, has_error) AS errors,
  quantileExact(0.95)(duration_ms) AS p95_ms,
  sum(cost) AS cost,
  uniqExactIf(trace_id, unpriced) AS unpriced,
  uniqExactIf(trace_id, cost IS NULL) AS no_cost,
  uniqExactIf(trace_id, no_model) AS no_model,
  sum(passed) AS passed,
  sum(judged) AS judged,
  max(at) AS last_trace
FROM (
  SELECT t.wk AS wk, t.agent AS agent, t.TraceId AS trace_id, t.OccurredAt AS at,
    t.ContainsErrorStatus AS has_error, t.TotalDurationMs AS duration_ms, t.TotalCost AS cost,
    t.UnpricedSpanCount > 0 AS unpriced, empty(t.Models) AS no_model,
    e.passed AS passed, e.judged AS judged
  FROM (
    SELECT ${WEEKS} AS wk, TraceId, OccurredAt, ContainsErrorStatus, TotalDurationMs, TotalCost,
      UnpricedSpanCount, Models, ${agentOf("")} AS agent
    FROM traces
    WHERE OccurredAt >= ${LOOKBACK_START}
      AND OccurredAt < ${END}
      AND ${productionOf("")}
  ) AS t
  LEFT JOIN (${checksSince(LOOKBACK_START)}) AS e ON e.TraceId = t.TraceId
  WHERE ${inWeek("t.OccurredAt")}
)
GROUP BY agent, wk`;

/** Traces the outcome judge labelled resolved, or that sent a resolved outcome themselves. */
const RESOLVED = `SELECT TraceId, 1 AS resolved
  FROM (
    SELECT TraceId
    FROM evaluation_metrics
    WHERE OccurredAt >= ${START}
      AND EvaluatorName = '${OUTCOME_JUDGE}'
      AND Label = 'resolved'
    UNION ALL
    SELECT TraceId
    FROM traces
    WHERE ${inPeriod("OccurredAt")}
      AND Attributes['metadata.outcome'] = 'resolved'
  )
  GROUP BY TraceId`;

/** Per bucket and agent over the period: traffic, errors, p95, cost, checks and resolved traces. */
export const DECK_TREND_SQL = `SELECT bucket, agent,
  uniqExact(trace_id) AS traces,
  uniqExactIf(trace_id, has_error) AS errors,
  quantileExact(0.95)(duration_ms) AS p95_ms,
  sum(cost) AS cost,
  uniqExactIf(trace_id, unpriced) AS unpriced,
  sum(passed) AS passed,
  sum(judged) AS judged,
  sum(resolved) AS resolved
FROM (
  SELECT ${bucketOf("t.OccurredAt")} AS bucket, ${agentOf("t.")} AS agent,
    t.TraceId AS trace_id, t.ContainsErrorStatus AS has_error, t.TotalDurationMs AS duration_ms,
    t.TotalCost AS cost, t.UnpricedSpanCount > 0 AS unpriced,
    e.passed AS passed, e.judged AS judged, o.resolved AS resolved
  FROM traces AS t
  LEFT JOIN (${checksSince(START)}) AS e ON e.TraceId = t.TraceId
  LEFT JOIN (${RESOLVED}) AS o ON o.TraceId = t.TraceId
  WHERE ${inPeriod("t.OccurredAt")}
    AND ${productionOf("t.")}
)
GROUP BY bucket, agent
ORDER BY bucket`;

/** Per agent and tool: the tool calls its traces made over the period, and how many failed. */
export const DECK_TOOLS_SQL = `SELECT t.agent AS agent,
  coalesce(nullIf(s.SpanAttributes['gen_ai.tool.name'], ''), s.SpanName) AS tool,
  count() AS calls,
  countIf(s.StatusCode = 2) AS failed
FROM spans AS s
INNER JOIN (
  SELECT TraceId, ${agentOf("")} AS agent
  FROM traces
  WHERE ${inPeriod("OccurredAt")}
    AND ${productionOf("")}
) AS t ON t.TraceId = s.TraceId
WHERE ${inPeriod("s.StartTime")}
  AND (s.SpanAttributes['langwatch.span.type'] = 'tool'
    OR s.SpanAttributes['gen_ai.operation.name'] = 'execute_tool')
GROUP BY agent, tool
ORDER BY calls DESC
LIMIT 300`;

/** Per agent and week: traffic, errors, p95 latency, cost and traces on a model with no price. */
export const DECK_AGENTS_SQL = `SELECT agent, wk,
  uniqExact(TraceId) AS traces,
  uniqExactIf(TraceId, ContainsErrorStatus) AS errors,
  quantileExact(0.95)(TotalDurationMs) AS p95_ms,
  sum(TotalCost) AS cost,
  uniqExactIf(TraceId, UnpricedSpanCount > 0) AS unpriced
FROM (
  SELECT ${WEEKS} AS wk, TraceId, OccurredAt, TotalDurationMs, TotalCost, UnpricedSpanCount,
    ContainsErrorStatus, ${agentOf("")} AS agent
  FROM traces
  WHERE OccurredAt >= ${LOOKBACK_START}
    AND OccurredAt < ${END}
    AND ${productionOf("")}
)
WHERE ${inWeek("OccurredAt")}
GROUP BY agent, wk`;

/** When each agent last sent a trace, looking back as far as the setup checks do. */
export const DECK_LAST_SEEN_SQL = `SELECT ${agentOf("")} AS agent, max(OccurredAt) AS last_trace
FROM traces
WHERE OccurredAt >= subtractDays(now(), ${PRESENCE_DAYS})
  AND ${productionOf("")}
GROUP BY agent`;

/** Per agent, evaluator and week: checks passed and judged. An evaluation is dated by its trace. */
export const DECK_EVALUATIONS_SQL = `SELECT t.agent AS agent, e.EvaluatorName AS evaluator, t.wk AS wk,
  countIf(e.Passed = 1) AS passed,
  count() AS judged,
  max(e.OccurredAt) AS last_run
FROM evaluation_metrics AS e
INNER JOIN (
  SELECT TraceId, wk, agent
  FROM (
    SELECT ${WEEKS} AS wk, TraceId, OccurredAt, ${agentOf("")} AS agent
    FROM traces
    WHERE OccurredAt >= ${LOOKBACK_START}
      AND OccurredAt < ${END}
      AND ${productionOf("")}
  )
  WHERE ${inWeek("OccurredAt")}
) AS t ON t.TraceId = e.TraceId
WHERE e.OccurredAt >= ${LOOKBACK_START}
  AND e.Passed IS NOT NULL
  AND NOT e.IsGuardrail
GROUP BY agent, evaluator, wk`;

/** How many of the period's traces carry what widgets need: a cost, a model, a user, a thread. */
export const DECK_FIELD_GAPS_SQL = `SELECT uniqExact(TraceId) AS traces,
  uniqExactIf(TraceId, TotalCost IS NULL) AS no_cost,
  uniqExactIf(TraceId, empty(Models)) AS no_model,
  uniqExactIf(TraceId, UserId = '') AS no_user,
  uniqExactIf(TraceId, ConversationId = '') AS no_thread
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}`;

/** The period's traces with the agent each names, for the joins below. */
const PERIOD_TRACES = `SELECT TraceId, OccurredAt, ${agentOf("")} AS agent
  FROM traces
  WHERE ${inPeriod("OccurredAt")}
    AND ${productionOf("")}`;

/** Per bucket and agent: checks passed and judged, dated by the trace they judged. */
export const DECK_QUALITY_TREND_SQL = `SELECT ${bucketOf("t.OccurredAt")} AS bucket, t.agent AS agent,
  countIf(e.Passed = 1) AS passed,
  count() AS judged
FROM evaluation_metrics AS e
INNER JOIN (${PERIOD_TRACES}) AS t ON t.TraceId = e.TraceId
WHERE e.OccurredAt >= ${START}
  AND e.Passed IS NOT NULL
  AND NOT e.IsGuardrail
GROUP BY bucket, agent
ORDER BY bucket`;

/** Per bucket and agent: spend, and the traces on a model with no price. */
export const DECK_SPEND_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket, ${agentOf("")} AS agent,
  sum(TotalCost) AS cost,
  uniqExactIf(TraceId, UnpricedSpanCount > 0) AS unpriced
FROM traces
WHERE ${inPeriod("OccurredAt")}
  AND ${productionOf("")}
GROUP BY bucket, agent
ORDER BY bucket`;

/** Per agent: traces resolved, by the outcome judge's label or the outcome the trace sends. */
export const DECK_RESOLVED_SQL = `SELECT t.agent AS agent, uniqExact(t.TraceId) AS resolved
FROM (${PERIOD_TRACES}) AS t
INNER JOIN (${RESOLVED}) AS o ON o.TraceId = t.TraceId
GROUP BY agent`;
