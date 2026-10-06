/**
 * The LangWatchQL behind the Flight Deck's cockpit cards and the Running costs board, derived
 * from Rogerio's prototype cards. An outcome is how a conversation ended: the label of the
 * conversation outcome judge, or the outcome a trace sends in its metadata.
 */

import {
  bucketOf,
  END,
  inPeriod,
  inPeriodAndPrevious,
  MIDPOINT,
  PREVIOUS_START,
  START,
} from "../../templates/model/lwql-period.ts";
import { PRESENCE_DAYS } from "../../templates/model/source-presence-queries.ts";

/** The category judge whose label says how a conversation ended, as the dev seed names it. */
export const OUTCOME_JUDGE = "Conversation Outcome Judge";

type Window = (column: string) => string;

const CONVERSATION = "coalesce(nullIf(ConversationId, ''), TraceId)";
const PRODUCTION = "Origin IN ('', 'application', 'gateway')";

// An evaluation is dated by its trace: it can run, or be re-run, long after the trace.
const evaluationsOf = ({ window, from }: { window: Window; from: string }) => `SELECT
    e.TraceId AS trace_id, t.OccurredAt AS at, e.EvaluatorName AS evaluator, e.Label AS label,
    e.Passed = 1 AS ok, e.Passed IS NOT NULL AND NOT e.IsGuardrail
      AND e.EvaluatorName != '${OUTCOME_JUDGE}' AS is_check,
    t.customer AS customer
  FROM evaluation_metrics AS e
  INNER JOIN (
    SELECT TraceId, OccurredAt, ifNull(CustomerId, '') AS customer
    FROM trace_metrics
    WHERE ${window("OccurredAt")}
  ) AS t ON t.TraceId = e.TraceId
  WHERE e.OccurredAt >= ${from}`;

// A conversation's outcome sits on its last turn; a sent outcome wins over the judge's.
const outcomes = ({ window, from }: { window: Window; from: string }) => `SELECT trace_id,
    any(at) AS at, argMax(outcome, sent) AS outcome, argMax(reason, sent) AS reason
  FROM (
    SELECT trace_id, at, label AS outcome, label AS reason, 0 AS sent
    FROM (${evaluationsOf({ window, from })})
    WHERE evaluator = '${OUTCOME_JUDGE}'
      AND label != ''
    UNION ALL
    SELECT TraceId AS trace_id, OccurredAt AS at, Attributes['metadata.outcome'] AS outcome,
      coalesce(nullIf(Attributes['metadata.outcome_reason'], ''), Attributes['metadata.outcome']) AS reason,
      1 AS sent
    FROM traces
    WHERE ${window("OccurredAt")}
      AND Attributes['metadata.outcome'] != ''
  )
  GROUP BY trace_id`;

const PERIOD = { window: inPeriod, from: START };
const BOTH_PERIODS = { window: inPeriodAndPrevious, from: PREVIOUS_START };
const RECENT_START = `subtractDays(now(), ${PRESENCE_DAYS})`;
const RECENT = { window: (column: string) => `${column} >= ${RECENT_START}`, from: RECENT_START };

/** One row when any conversation outcome arrived lately, to tell a quiet period from no setup. */
export const OUTCOMES_SEEN_SQL = `SELECT 1 AS present
FROM (${outcomes(RECENT)})
LIMIT 1`;

// A trace's clustered topic and the topic its metadata names; `TOPIC` names it after grouping.
const traceTopicKeys = (window: Window) => `SELECT TraceId AS trace_id, TopicId AS topic_id,
    Attributes['metadata.topic'] AS meta_topic, CapturedInput AS input
  FROM traces
  WHERE ${window("OccurredAt")}`;
const TOPIC = "coalesce(nullIf(p.TopicName, ''), nullIf(g.meta_topic, ''), 'No topic')";

/** Conversations that ended, and those resolved, in the period and the one before. */
export const OUTCOME_COMPARISON_SQL = `SELECT
  countIf(at >= ${START}) AS closed,
  countIf(at >= ${START} AND outcome = 'resolved') AS resolved,
  countIf(at < ${START}) AS closed_prev,
  countIf(at < ${START} AND outcome = 'resolved') AS resolved_prev
FROM (${outcomes(BOTH_PERIODS)})`;

/** All AI cost, traces and evaluator runs alike, and conversations, in both periods. */
export const SPEND_COMPARISON_SQL = `SELECT
  uniqExactIf(${CONVERSATION}, OccurredAt >= ${START}) AS conversations,
  uniqExactIf(${CONVERSATION}, OccurredAt < ${START}) AS conversations_prev,
  sumIf(ifNull(TotalCost, 0), OccurredAt >= ${START})
    + (SELECT sumIf(ifNull(TotalCost, 0), OccurredAt >= ${START}) FROM evaluation_metrics
      WHERE ${inPeriodAndPrevious("OccurredAt")}) AS cost,
  sumIf(ifNull(TotalCost, 0), OccurredAt < ${START})
    + (SELECT sumIf(ifNull(TotalCost, 0), OccurredAt < ${START}) FROM evaluation_metrics
      WHERE ${inPeriodAndPrevious("OccurredAt")}) AS cost_prev
FROM trace_metrics
WHERE ${inPeriodAndPrevious("OccurredAt")}`;

/** Evaluator verdicts that passed, outcome judge and guardrails left out, in both periods. */
export const CHECKS_COMPARISON_SQL = `SELECT
  countIf(ok AND at >= ${START}) AS passed,
  countIf(at >= ${START}) AS judged,
  countIf(ok AND at < ${START}) AS passed_prev,
  countIf(at < ${START}) AS judged_prev
FROM (${evaluationsOf(BOTH_PERIODS)})
WHERE is_check`;

/** Check verdicts per customer, else per topic, in the period and the one before. */
export const SEGMENT_PASS_RATES_SQL = `SELECT if(g.customer != '', g.customer, ${TOPIC}) AS segment,
  if(g.customer != '', 'customer', 'topic') AS kind,
  sum(g.pass) AS pass, sum(g.n) AS n, sum(g.base_pass) AS base_pass, sum(g.base_n) AS base_n
FROM (
  SELECT e.customer AS customer, t.topic_id AS topic_id, t.meta_topic AS meta_topic,
    countIf(e.ok AND e.at >= ${START}) AS pass,
    countIf(e.at >= ${START}) AS n,
    countIf(e.ok AND e.at < ${START}) AS base_pass,
    countIf(e.at < ${START}) AS base_n
  FROM (${evaluationsOf(BOTH_PERIODS)}) AS e
  LEFT JOIN (${traceTopicKeys(inPeriodAndPrevious)}) AS t ON t.trace_id = e.trace_id
  WHERE e.is_check
  GROUP BY customer, topic_id, meta_topic
) AS g
LEFT JOIN topics AS p ON p.TopicId = g.topic_id
GROUP BY segment, kind
ORDER BY n DESC
LIMIT 50`;

/** How conversations ended, by reason, in the period and the one before. */
export const OUTCOME_REASONS_SQL = `SELECT reason, outcome,
  countIf(at >= ${START}) AS now,
  countIf(at < ${START}) AS before
FROM (${outcomes(BOTH_PERIODS)})
GROUP BY reason, outcome
ORDER BY now DESC
LIMIT 30`;

/** Per judge: how often its verdict matched the reviewer thumbs on the same trace. */
export const JUDGE_AGREEMENT_SQL = `SELECT e.evaluator AS evaluator,
  count() AS audited,
  countIf(e.ok = (a.up = 1)) AS agree,
  countIf(e.ok) AS judge_pass,
  countIf(a.up = 1) AS reviewer_pass
FROM (${evaluationsOf(PERIOD)}) AS e
INNER JOIN (
  SELECT TraceId, max(if(IsThumbsUp, 1, 0)) AS up
  FROM annotations
  WHERE CreatedAt >= ${START}
    AND IsThumbsUp IS NOT NULL
  GROUP BY TraceId
) AS a ON a.TraceId = e.trace_id
WHERE e.is_check
GROUP BY evaluator
HAVING audited >= 10
ORDER BY audited DESC
LIMIT 10`;

// A trace failed when its root span ended in an error; an error below it may be recovered.
const ROOT_FAILED = "max(ifNull(ParentSpanId, '') = '' AND StatusCode = 2)";

/** The step whose errors most often reach the user: failed in a trace that failed. */
export const FAILING_STEP_SQL = `SELECT step,
  count() AS calls,
  countIf(errored) AS errors,
  countIf(errored AND NOT failed) AS recovered
FROM (
  SELECT s.SpanName AS step, s.StatusCode = 2 AS errored, f.failed AS failed
  FROM spans AS s
  INNER JOIN (
    SELECT TraceId, ${ROOT_FAILED} AS failed
    FROM spans
    WHERE ${inPeriod("StartTime")}
    GROUP BY TraceId
  ) AS f ON f.TraceId = s.TraceId
  WHERE ${inPeriod("s.StartTime")}
    AND ifNull(s.ParentSpanId, '') != ''
)
GROUP BY step
HAVING calls >= 20
ORDER BY (errors - recovered) / calls DESC
LIMIT 1`;

/**
 * Per topic: conversations that ended and those that asked for something the agent cannot do,
 * with one such request and its trace. Most capability gaps first.
 */
export const CANNOT_SERVE_SQL = `SELECT ${TOPIC} AS topic,
  sum(g.gaps) AS gaps,
  sum(g.closed) AS closed,
  anyIf(g.example, g.gaps > 0) AS example,
  anyIf(g.trace_id, g.gaps > 0) AS trace_id
FROM (
  SELECT t.topic_id AS topic_id, t.meta_topic AS meta_topic,
    countIf(o.outcome = 'capability_gap') AS gaps,
    count() AS closed,
    anyIf(t.input, o.outcome = 'capability_gap') AS example,
    anyIf(o.trace_id, o.outcome = 'capability_gap') AS trace_id
  FROM (${outcomes(PERIOD)}) AS o
  INNER JOIN (${traceTopicKeys(inPeriod)}) AS t ON t.trace_id = o.trace_id
  GROUP BY topic_id, meta_topic
) AS g
LEFT JOIN topics AS p ON p.TopicId = g.topic_id
GROUP BY topic
ORDER BY gaps DESC
LIMIT 20`;

/** Conversations that ended and those resolved, per bucket. */
export const RESOLVED_TREND_SQL = `SELECT ${bucketOf("at")} AS bucket,
  countIf(outcome = 'resolved') AS resolved,
  count() AS closed
FROM (${outcomes(PERIOD)})
GROUP BY bucket
ORDER BY bucket`;

// A model or prompt version is a change in the bucket it was first seen, 90 days back.
const LOOKBACK = `OccurredAt >= subtractDays(${START}, 90) AND OccurredAt < ${END}`;

/** Models and prompt versions first seen in the period, with the bucket they arrived in. */
export const CHANGES_SQL = `SELECT kind, name, ${bucketOf("first_at")} AS bucket
FROM (
  SELECT 'model' AS kind, arrayJoin(Models) AS name, min(OccurredAt) AS first_at
  FROM trace_metrics
  WHERE ${LOOKBACK}
  GROUP BY name
  UNION ALL
  SELECT 'prompt' AS kind,
    coalesce(nullIf(LastUsedPromptVersionId, ''), nullIf(Attributes['metadata.prompt_version'], '')) AS name,
    min(OccurredAt) AS first_at
  FROM traces
  WHERE ${LOOKBACK}
    AND name IS NOT NULL
  GROUP BY name
)
WHERE first_at > (SELECT min(OccurredAt) + INTERVAL 1 DAY FROM trace_metrics WHERE ${LOOKBACK})
  AND first_at >= ${START}
ORDER BY first_at
LIMIT 8`;

const languageOutcomes = `SELECT o.outcome AS outcome, o.at AS at,
    coalesce(nullIf(l.language, ''), 'Unknown') AS language
  FROM (${outcomes(PERIOD)}) AS o
  LEFT JOIN (
    SELECT TraceId, Attributes['metadata.language'] AS language
    FROM traces
    WHERE ${inPeriod("OccurredAt")}
  ) AS l ON l.TraceId = o.trace_id`;

/** Calls with an outcome and those that got the task done, per bucket and language. */
export const TASK_SUCCESS_TREND_SQL = `SELECT ${bucketOf("at")} AS bucket, language,
  countIf(outcome = 'resolved') AS done,
  count() AS calls
FROM (${languageOutcomes})
GROUP BY bucket, language
ORDER BY bucket`;

/** One row when any trace sent an output action lately. */
export const OUTPUT_ACTIONS_SEEN_SQL = `SELECT 1 AS present
FROM traces
WHERE OccurredAt >= ${RECENT_START}
  AND Attributes['metadata.output_action'] != ''
LIMIT 1`;

/** What users did with each generated output, per bucket, from its `output_action` metadata. */
export const OUTPUT_ACTIONS_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  Attributes['metadata.output_action'] AS action,
  count() AS outputs
FROM traces
WHERE ${inPeriod("OccurredAt")}
  AND Attributes['metadata.output_action'] != ''
GROUP BY bucket, action
ORDER BY bucket`;

/** Month to date, the last 7 days' pace and the month's length, for the forecast. */
export const MONTH_FORECAST_SQL = `SELECT
  (SELECT sum(ifNull(TotalCost, 0)) FROM trace_metrics WHERE OccurredAt >= toStartOfMonth(now()))
    + (SELECT sum(ifNull(TotalCost, 0)) FROM evaluation_metrics
      WHERE OccurredAt >= toStartOfMonth(now())) AS month_to_date,
  (SELECT sum(ifNull(TotalCost, 0)) FROM trace_metrics WHERE OccurredAt >= subtractDays(now(), 7))
    + (SELECT sum(ifNull(TotalCost, 0)) FROM evaluation_metrics
      WHERE OccurredAt >= subtractDays(now(), 7)) AS last_7_days,
  toDayOfMonth(now()) AS day_of_month,
  toDayOfMonth(subtractDays(toStartOfMonth(addMonths(now(), 1)), 1)) AS days_in_month`;

/** Spend per bucket by where it came from; evaluator runs count as evaluations. */
export const SPEND_BY_SOURCE_SQL = `SELECT bucket, source, sum(cost) AS cost
FROM (
  SELECT ${bucketOf("OccurredAt")} AS bucket, ifNull(TotalCost, 0) AS cost,
    multiIf(${PRODUCTION}, 'production', Origin = 'evaluation', 'evaluations',
      Origin = 'simulation', 'simulations', Origin IN ('playground', 'workflow'), 'experiments',
      'other') AS source
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
  UNION ALL
  SELECT ${bucketOf("OccurredAt")} AS bucket, ifNull(TotalCost, 0) AS cost, 'evaluations' AS source
  FROM evaluation_metrics
  WHERE ${inPeriod("OccurredAt")}
)
GROUP BY bucket, source
ORDER BY bucket`;

// Per production trace: its cost, spans, LLM retries and calls repeated past the first.
const traceWaste = `SELECT ifNull(s.failed, 0) = 1 AS failed, t.cost AS cost,
    ifNull(s.spans, 0) AS spans, ifNull(s.retries, 0) AS retries,
    ifNull(s.repeats, 0) AS repeats, ifNull(s.llm_cost, 0) AS llm_cost, ifNull(s.llm_ok, 0) AS llm_ok
  FROM (
    SELECT TraceId, ifNull(TotalCost, 0) AS cost
    FROM trace_metrics
    WHERE ${inPeriod("OccurredAt")}
      AND ${PRODUCTION}
  ) AS t
  LEFT JOIN (
    SELECT TraceId, max(root_failed) AS failed, sum(calls) AS spans, sum(errored_llm) AS retries,
      sumIf(calls - 1, is_tool AND calls >= 3) AS repeats,
      sum(ok_llm_cost) AS llm_cost, sum(ok_llm) AS llm_ok
    FROM (
      SELECT TraceId, SpanName,
        SpanAttributes['langwatch.span.type'] = 'tool' AS is_tool,
        count() AS calls,
        ${ROOT_FAILED} AS root_failed,
        countIf(StatusCode = 2 AND SpanAttributes['langwatch.span.type'] = 'llm') AS errored_llm,
        countIf(StatusCode != 2 AND SpanAttributes['langwatch.span.type'] = 'llm') AS ok_llm,
        sumIf(ifNull(Cost, 0), StatusCode != 2 AND SpanAttributes['langwatch.span.type'] = 'llm')
          AS ok_llm_cost
      FROM spans
      WHERE ${inPeriod("StartTime")}
      GROUP BY TraceId, SpanName, is_tool
    )
    GROUP BY TraceId
  ) AS s ON s.TraceId = t.TraceId`;

/**
 * Wasted spend, each trace counted once: a failed trace's whole cost; for a trace that looped
 * a tool three times or more, its share of spans that were repeats; for one that recovered,
 * each failed LLM call at the price of the trace's calls that went through.
 */
export const WASTE_SQL = `SELECT
  sum(cost) AS spend,
  countIf(failed) AS failed_traces,
  sumIf(cost, failed) AS failed_cost,
  countIf(NOT failed AND repeats > 0) AS loop_traces,
  sumIf(cost * repeats / greatest(spans, 1), NOT failed AND repeats > 0) AS loop_cost,
  countIf(NOT failed AND repeats = 0 AND retries > 0) AS retry_traces,
  sumIf(retries * llm_cost / greatest(llm_ok, 1), NOT failed AND repeats = 0 AND retries > 0)
    AS retry_cost
FROM (${traceWaste})`;

/** Production cost and calls per bucket; a call is a conversation, else a trace. */
export const COST_PER_CALL_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  sum(ifNull(TotalCost, 0)) AS cost,
  uniqExact(${CONVERSATION}) AS calls
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${PRODUCTION}
GROUP BY bucket
ORDER BY bucket`;

/** Production cost and calls over the whole period. */
export const COST_PER_CALL_SQL = `SELECT sum(ifNull(TotalCost, 0)) AS cost, uniqExact(${CONVERSATION}) AS calls
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${PRODUCTION}`;

// One production trace is one document; a trace that used several models is its own line.
const DOCUMENT_MODEL = "if(length(Models) = 1, Models[1], 'several models')";

/** Production cost and documents per bucket and model. */
export const DOCUMENT_COST_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  ${DOCUMENT_MODEL} AS model,
  sum(ifNull(TotalCost, 0)) AS cost,
  count() AS documents
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${PRODUCTION}
  AND length(Models) > 0
GROUP BY bucket, model
ORDER BY bucket`;

/** Cost and documents in the first and the second half of the period. */
export const DOCUMENT_COST_HALVES_SQL = `SELECT
  sumIf(ifNull(TotalCost, 0), OccurredAt < ${MIDPOINT}) AS first_cost,
  countIf(OccurredAt < ${MIDPOINT}) AS first_documents,
  sumIf(ifNull(TotalCost, 0), OccurredAt >= ${MIDPOINT}) AS second_cost,
  countIf(OccurredAt >= ${MIDPOINT}) AS second_documents
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${PRODUCTION}
  AND length(Models) > 0`;
