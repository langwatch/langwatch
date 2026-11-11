/**
 * The LangWatchQL behind the Flight Deck's cockpit cards and the Running costs board, derived
 * from Rogerio's prototype cards. An outcome is how a conversation ended: the label of the
 * conversation outcome judge, or the outcome a trace sends in its metadata.
 */

import {
  bucketOf,
  END,
  firstTraceMetricsRow,
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

/**
 * What an outcome row carries beyond its trace, time, outcome and source: the reason, read
 * only where a widget shows it, the trace's language and its topic.
 */
type OutcomeExtras = { withReason?: boolean; withLanguage?: boolean; withTopic?: boolean };

/**
 * One row per verdict or sent outcome, not yet one per conversation. Both sides read
 * `trace_metrics`' typed columns, never the `traces` map (tasks#1117); the judge's few verdicts
 * are the joined side, so the trace rows stream past them instead of filling a hash table.
 */
const outcomeRows = ({
  window,
  from,
  withReason = false,
  withLanguage = false,
  withTopic = false,
}: { window: Window; from: string } & OutcomeExtras) => {
  const topicId = "ifNull(TopicId, '') AS topic_id";
  const traceTopic = withTopic ? `, ${topicId}, MetadataTopic` : "";
  const judgeTopic = withTopic ? ", t.topic_id AS topic_id, t.MetadataTopic AS meta_topic" : "";
  const sentTopic = withTopic ? `, ${topicId}, MetadataTopic AS meta_topic` : "";
  const judgeReason = withReason ? ", e.Label AS reason" : "";
  const sentReason = withReason
    ? ",\n      coalesce(nullIf(MetadataOutcomeReason, ''), MetadataOutcome) AS reason"
    : "";
  const traceLanguage = withLanguage ? ", MetadataLanguage" : "";
  const judgeLanguage = withLanguage ? ", t.MetadataLanguage AS language" : "";
  const sentLanguage = withLanguage ? ", MetadataLanguage AS language" : "";
  return `SELECT e.TraceId AS trace_id, t.OccurredAt AS row_at, e.Label AS outcome${judgeReason}${judgeLanguage}${judgeTopic},
      0 AS sent
    FROM (
      SELECT TraceId, OccurredAt${traceLanguage}${traceTopic}
      FROM trace_metrics
      WHERE ${window("OccurredAt")}
    ) AS t
    INNER JOIN (
      SELECT TraceId, Label
      FROM evaluation_metrics
      WHERE OccurredAt >= ${from}
        AND EvaluatorName = '${OUTCOME_JUDGE}'
        AND Label != ''
    ) AS e ON e.TraceId = t.TraceId
    UNION ALL
    SELECT TraceId AS trace_id, OccurredAt AS row_at, MetadataOutcome AS outcome${sentReason}${sentLanguage}${sentTopic},
      1 AS sent
    FROM trace_metrics
    WHERE ${window("OccurredAt")}
      AND MetadataOutcome != ''`;
};

// A conversation's outcome sits on its last turn; a sent outcome wins over the judge's. A trace
// whose trace_metrics anchor moved (ADR-082) is dated, and topped, by its first row.
const outcomes = ({
  window,
  from,
  withReason = false,
  withLanguage = false,
  withTopic = false,
}: { window: Window; from: string } & OutcomeExtras) => `SELECT trace_id,
    min(row_at) AS at, argMax(outcome, sent) AS outcome${
      withReason ? ", argMax(reason, sent) AS reason" : ""
    }${withLanguage ? ", any(language) AS language" : ""}${
      withTopic
        ? ", argMin(topic_id, row_at) AS topic_id, argMin(meta_topic, row_at) AS meta_topic"
        : ""
    }
  FROM (
    ${outcomeRows({ window, from, withReason, withLanguage, withTopic })}
  )
  GROUP BY trace_id`;

/**
 * Check verdicts per trace, outcome judge and guardrails left out: the joined side of a check
 * query, one small row per judged trace, so its trace rows stream instead of being hashed.
 */
const checksPerTrace = (from: string) => `SELECT TraceId, countIf(Passed = 1) AS pass, count() AS n
    FROM evaluation_metrics
    WHERE OccurredAt >= ${from}
      AND Passed IS NOT NULL
      AND NOT IsGuardrail
      AND EvaluatorName != '${OUTCOME_JUDGE}'
    GROUP BY TraceId`;

/**
 * Trace cost plus evaluator cost, null only when neither side has a priced row: an unpriced
 * trace has no cost (NULL), and `sum` skips it rather than counting it as $0.
 */
const costTotal = (traces: string, evaluations: string) =>
  `coalesce((${traces}) + (${evaluations}), (${traces}), (${evaluations}))`;

const PERIOD = { window: inPeriod, from: START };
const BOTH_PERIODS = { window: inPeriodAndPrevious, from: PREVIOUS_START };
const RECENT_START = `subtractDays(now(), ${PRESENCE_DAYS})`;
const RECENT = { window: (column: string) => `${column} >= ${RECENT_START}`, from: RECENT_START };

/** One row when any conversation outcome arrived lately, to tell a quiet period from no setup. */
export const OUTCOMES_SEEN_SQL = `SELECT 1 AS present
FROM (${outcomeRows(RECENT)})
LIMIT 1`;

// The clustered topic, else the topic the trace's metadata names, after grouping.
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
  ${costTotal(
    `sumIf(TotalCost, OccurredAt >= ${START})`,
    `SELECT sumIf(TotalCost, OccurredAt >= ${START}) FROM evaluation_metrics
      WHERE ${inPeriodAndPrevious("OccurredAt")}`,
  )} AS cost,
  ${costTotal(
    `sumIf(TotalCost, OccurredAt < ${START})`,
    `SELECT sumIf(TotalCost, OccurredAt < ${START}) FROM evaluation_metrics
      WHERE ${inPeriodAndPrevious("OccurredAt")}`,
  )} AS cost_prev
FROM trace_metrics
WHERE ${inPeriodAndPrevious("OccurredAt")}`;

/**
 * Evaluator verdicts that passed, outcome judge and guardrails left out, in both periods, each
 * dated by its trace.
 */
export const CHECKS_COMPARISON_SQL = `SELECT
  sumIf(c.pass, t.at >= ${START}) AS passed,
  sumIf(c.n, t.at >= ${START}) AS judged,
  sumIf(c.pass, t.at < ${START}) AS passed_prev,
  sumIf(c.n, t.at < ${START}) AS judged_prev
FROM (
  SELECT TraceId, OccurredAt AS at
  FROM trace_metrics
  WHERE ${inPeriodAndPrevious("OccurredAt")}
) AS t
INNER JOIN (
  ${checksPerTrace(PREVIOUS_START)}
) AS c ON c.TraceId = t.TraceId`;

/** Check verdicts per customer, else per topic, in the period and the one before. */
export const SEGMENT_PASS_RATES_SQL = `SELECT if(g.customer != '', g.customer, ${TOPIC}) AS segment,
  if(g.customer != '', 'customer', 'topic') AS kind,
  sum(g.pass) AS pass, sum(g.n) AS n, sum(g.base_pass) AS base_pass, sum(g.base_n) AS base_n
FROM (
  SELECT t.customer AS customer, t.topic_id AS topic_id, t.meta_topic AS meta_topic,
    sumIf(c.pass, t.at >= ${START}) AS pass,
    sumIf(c.n, t.at >= ${START}) AS n,
    sumIf(c.pass, t.at < ${START}) AS base_pass,
    sumIf(c.n, t.at < ${START}) AS base_n
  FROM (
    SELECT TraceId, OccurredAt AS at, ifNull(CustomerId, '') AS customer, TopicId AS topic_id,
      MetadataTopic AS meta_topic
    FROM trace_metrics
    WHERE ${inPeriodAndPrevious("OccurredAt")}
  ) AS t
  INNER JOIN (
    ${checksPerTrace(PREVIOUS_START)}
  ) AS c ON c.TraceId = t.TraceId
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
FROM (${outcomes({ ...BOTH_PERIODS, withReason: true })})
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
  FROM span_metrics AS s
  INNER JOIN (
    SELECT TraceId, ${ROOT_FAILED} AS failed
    FROM span_metrics
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
 * Per topic: conversations that ended, those the agent could not serve, and one such trace.
 * `minIf`, not `anyIf`: `CANNOT_SERVE_SQL` runs this twice, and both must pick the same trace.
 */
const GAPS_BY_TOPIC = `SELECT ${TOPIC} AS topic,
    sum(g.gaps) AS gaps,
    sum(g.closed) AS closed,
    minIf(g.trace_id, g.gaps > 0) AS trace_id
  FROM (
    SELECT topic_id, meta_topic,
      countIf(outcome = 'capability_gap') AS gaps,
      count() AS closed,
      minIf(trace_id, outcome = 'capability_gap') AS trace_id
    FROM (${outcomes({ ...PERIOD, withTopic: true })})
    GROUP BY topic_id, meta_topic
  ) AS g
  LEFT JOIN topics AS p ON p.TopicId = g.topic_id
  GROUP BY topic
  ORDER BY gaps DESC
  LIMIT 20`;

/**
 * Per topic: conversations that ended and those that asked for something the agent cannot do,
 * with one such request and its trace. Most capability gaps first. The request's text is read
 * from `traces` for the shown traces only, so the primary key skips every other trace.
 */
export const CANNOT_SERVE_SQL = `SELECT g.topic AS topic, g.gaps AS gaps, g.closed AS closed,
  x.input AS example, g.trace_id AS trace_id
FROM (
  ${GAPS_BY_TOPIC}
) AS g
LEFT JOIN (
  SELECT TraceId, CapturedInput AS input
  FROM traces
  WHERE ${inPeriod("OccurredAt")}
    AND TraceId IN (SELECT trace_id FROM (
      ${GAPS_BY_TOPIC}
    ))
) AS x ON x.TraceId = g.trace_id
ORDER BY gaps DESC`;

/** Conversations that ended and those resolved, per bucket. */
export const RESOLVED_TREND_SQL = `SELECT ${bucketOf("at")} AS bucket,
  countIf(outcome = 'resolved') AS resolved,
  count() AS closed
FROM (${outcomes(PERIOD)})
GROUP BY bucket
ORDER BY bucket`;

// A model or prompt version is a change in the bucket it was first seen, 90 days back.
const LOOKBACK = `OccurredAt >= subtractDays(${START}, 90) AND OccurredAt < ${END}`;

/**
 * When each prompt version was first seen: a trace's managed prompt version, else its metadata's
 * (`trace_metrics`), never the map (analytics ADR-004). The id set holds 64-bit hashes of the
 * traces that send a metadata version: id strings outgrew the memory limit on 2M traces a month.
 */
const PROMPT_VERSIONS_FIRST_SEEN = `SELECT LastUsedPromptVersionId AS name, min(OccurredAt) AS first_at
    FROM traces
    WHERE ${LOOKBACK}
      AND LastUsedPromptVersionId != ''
    GROUP BY name
    UNION ALL
    SELECT MetadataPromptVersion AS name, min(OccurredAt) AS first_at
    FROM trace_metrics
    WHERE ${LOOKBACK}
      AND MetadataPromptVersion != ''
      AND cityHash64(TraceId) NOT IN (
        SELECT cityHash64(TraceId)
        FROM traces
        WHERE ${LOOKBACK}
          AND LastUsedPromptVersionId != ''
          AND cityHash64(TraceId) IN (
            SELECT cityHash64(TraceId)
            FROM trace_metrics
            WHERE ${LOOKBACK}
              AND MetadataPromptVersion != ''
          )
      )
    GROUP BY name`;

/** Models and prompt versions first seen in the period, with the bucket they arrived in. */
export const CHANGES_SQL = `SELECT kind, name, ${bucketOf("first_at")} AS bucket
FROM (
  SELECT 'model' AS kind, arrayJoin(Models) AS name, min(OccurredAt) AS first_at
  FROM trace_metrics
  WHERE ${LOOKBACK}
  GROUP BY name
  UNION ALL
  SELECT 'prompt' AS kind, name, min(first_at) AS first_at
  FROM (${PROMPT_VERSIONS_FIRST_SEEN})
  GROUP BY name
)
WHERE first_at > (SELECT min(OccurredAt) + INTERVAL 1 DAY FROM trace_metrics WHERE ${LOOKBACK})
  AND first_at >= ${START}
ORDER BY first_at
LIMIT 8`;

const languageOutcomes = `SELECT o.outcome AS outcome, o.at AS at,
    coalesce(nullIf(o.language, ''), 'Unknown') AS language
  FROM (${outcomes({ ...PERIOD, withLanguage: true })}) AS o`;

/** Calls with an outcome and those that got the task done, per bucket and language. */
export const TASK_SUCCESS_TREND_SQL = `SELECT ${bucketOf("at")} AS bucket, language,
  countIf(outcome = 'resolved') AS done,
  count() AS calls
FROM (${languageOutcomes})
GROUP BY bucket, language
ORDER BY bucket`;

/** One row when any trace sent an output action lately. */
export const OUTPUT_ACTIONS_SEEN_SQL = `SELECT 1 AS present
FROM trace_metrics
WHERE OccurredAt >= ${RECENT_START}
  AND MetadataOutputAction != ''
LIMIT 1`;

/** What users did with each generated output, per bucket, from its `output_action` metadata. */
export const OUTPUT_ACTIONS_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  MetadataOutputAction AS action,
  uniqExact(TraceId) AS outputs
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${firstTraceMetricsRow()}
  AND MetadataOutputAction != ''
GROUP BY bucket, action
ORDER BY bucket`;

/**
 * Month to date, the last 7 days' spend and how many of them had traces, and the month's
 * length, for the forecast: a day with no traces never drags the pace down.
 */
export const MONTH_FORECAST_SQL = `SELECT
  ${costTotal(
    "SELECT sum(TotalCost) FROM trace_metrics WHERE OccurredAt >= toStartOfMonth(now())",
    "SELECT sum(TotalCost) FROM evaluation_metrics WHERE OccurredAt >= toStartOfMonth(now())",
  )} AS month_to_date,
  ${costTotal(
    "SELECT sum(TotalCost) FROM trace_metrics WHERE OccurredAt >= subtractDays(now(), 7)",
    "SELECT sum(TotalCost) FROM evaluation_metrics WHERE OccurredAt >= subtractDays(now(), 7)",
  )} AS last_7_days,
  (SELECT uniqExact(toDate(OccurredAt)) FROM trace_metrics
    WHERE OccurredAt >= subtractDays(now(), 7)) AS days_with_data,
  toDayOfMonth(now()) AS day_of_month,
  toDayOfMonth(subtractDays(toStartOfMonth(addMonths(now(), 1)), 1)) AS days_in_month`;

/**
 * Spend, traces and traces with an unpriced call per bucket by where they came from; evaluator
 * runs count as evaluations.
 */
export const SPEND_BY_SOURCE_SQL = `SELECT bucket, source, sum(cost) AS cost, sum(traces) AS traces,
  sum(unpriced) AS unpriced
FROM (
  SELECT ${bucketOf("OccurredAt")} AS bucket, TotalCost AS cost, 1 AS traces,
    if(UnpricedSpanCount > 0, 1, 0) AS unpriced,
    multiIf(Source IN ('application', 'gateway'), 'production', Source = 'evaluation', 'evaluations',
      Source = 'simulation', 'simulations', Source IN ('playground', 'workflow'), 'experiments',
      'other') AS source
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
  UNION ALL
  SELECT ${bucketOf("OccurredAt")} AS bucket, TotalCost AS cost, 1 AS traces, 0 AS unpriced,
    'evaluations' AS source
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
    SELECT TraceId, TotalCost AS cost
    FROM trace_metrics
    WHERE ${inPeriod("OccurredAt")}
  ) AS t
  LEFT JOIN (
    SELECT TraceId, max(root_failed) AS failed, sum(calls) AS spans, sum(errored_llm) AS retries,
      sumIf(calls - 1, is_tool AND calls >= 3) AS repeats,
      sum(ok_llm_cost) AS llm_cost, sum(ok_llm) AS llm_ok
    FROM (
      SELECT TraceId, SpanName,
        SpanType = 'tool' AS is_tool,
        count() AS calls,
        ${ROOT_FAILED} AS root_failed,
        countIf(StatusCode = 2 AND SpanType = 'llm') AS errored_llm,
        countIf(StatusCode != 2 AND SpanType = 'llm') AS ok_llm,
        sumIf(ifNull(Cost, 0), StatusCode != 2 AND SpanType = 'llm') AS ok_llm_cost
      FROM span_metrics
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
  sum(TotalCost) AS cost,
  uniqExact(${CONVERSATION}) AS calls
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

/** Production cost and calls over the whole period. */
export const COST_PER_CALL_SQL = `SELECT sum(TotalCost) AS cost, uniqExact(${CONVERSATION}) AS calls
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}`;

// One production trace is one document; a trace that used several models is its own line.
const DOCUMENT_MODEL = "if(length(Models) = 1, Models[1], 'several models')";

/** Production cost and documents per bucket and model. */
export const DOCUMENT_COST_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  ${DOCUMENT_MODEL} AS model,
  sum(TotalCost) AS cost,
  count() AS documents
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND length(Models) > 0
GROUP BY bucket, model
ORDER BY bucket`;

/** Cost and documents in the first and the second half of the period. */
export const DOCUMENT_COST_HALVES_SQL = `SELECT
  sumIf(TotalCost, OccurredAt < ${MIDPOINT}) AS first_cost,
  countIf(OccurredAt < ${MIDPOINT}) AS first_documents,
  sumIf(TotalCost, OccurredAt >= ${MIDPOINT}) AS second_cost,
  countIf(OccurredAt >= ${MIDPOINT}) AS second_documents
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND length(Models) > 0`;
