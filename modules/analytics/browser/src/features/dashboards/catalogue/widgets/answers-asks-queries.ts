/**
 * The LangWatchQL behind the Answer quality and What users ask widgets. A conversation's
 * outcome is the one the app sends as `metadata.outcome`, else the outcome judge's label on
 * the trace it judged; a topic is the clustered topic, else the app's `metadata.topic`.
 */

import {
  END,
  START,
  bucketOf,
  inPeriod,
  inPeriodAndPrevious,
} from "../../templates/model/lwql-period.ts";

/** The thread-level category judge that labels how each conversation ended. */
export const OUTCOME_JUDGE = "Conversation Outcome Judge";

type Window = (column: string) => string;

const APP_OUTCOME = "t.Attributes['metadata.outcome']";

/**
 * Every trace in the window with its topic and, on the trace that closed a conversation,
 * its outcome and reason; `outcome` is empty on every other trace.
 */
function tracesWithOutcome({ window }: { window: Window }): string {
  return `(
  SELECT t.TraceId AS trace_id,
    t.OccurredAt AS at,
    coalesce(nullIf(p.TopicName, ''), nullIf(t.Attributes['metadata.topic'], '')) AS topic,
    if(${APP_OUTCOME} != '', ${APP_OUTCOME}, ifNull(j.label, '')) AS outcome,
    if(${APP_OUTCOME} != '', t.Attributes['metadata.outcome_reason'], ifNull(j.reason, ''))
      AS reason
  FROM traces AS t
  LEFT JOIN (
    SELECT TraceId,
      argMax(Label, ScheduledAt) AS label,
      argMax(Details, ScheduledAt) AS reason
    FROM evaluations
    WHERE ${window("ScheduledAt")}
      AND EvaluatorName = '${OUTCOME_JUDGE}'
      AND ArchivedAt IS NULL
    GROUP BY TraceId
  ) AS j ON j.TraceId = t.TraceId
  LEFT JOIN topics AS p ON p.TopicId = t.TopicId
  WHERE ${window("t.OccurredAt")}
)`;
}

const IN_PERIOD = tracesWithOutcome({ window: inPeriod });
const WITH_PREVIOUS = tracesWithOutcome({ window: inPeriodAndPrevious });

export const OUTCOME_TREND_SQL = `SELECT ${bucketOf("at")} AS bucket,
  count() AS closed,
  countIf(outcome = 'resolved') AS resolved,
  countIf(outcome = 'misunderstood') AS misunderstood,
  countIf(outcome = 'capability_gap') AS capability_gap,
  countIf(outcome = 'refusal') AS refusal,
  countIf(outcome = 'handover') AS handover
FROM ${IN_PERIOD}
WHERE outcome != ''
GROUP BY bucket
ORDER BY bucket`;

export const OUTCOME_TOTALS_SQL = `SELECT countIf(at >= ${START}) AS closed,
  countIf(at < ${START}) AS closed_previous
FROM ${WITH_PREVIOUS}
WHERE outcome != ''`;

export const OUTCOME_REASONS_SQL = `SELECT reason,
  any(outcome) AS kind,
  countIf(at >= ${START}) AS in_period,
  countIf(at < ${START}) AS in_previous
FROM ${WITH_PREVIOUS}
WHERE outcome NOT IN ('', 'resolved')
  AND reason != ''
GROUP BY reason
HAVING in_period > 0
ORDER BY in_period DESC
LIMIT 5`;

export const UNANSWERED_TOPICS_SQL = `SELECT topic,
  count() AS closed,
  countIf(outcome = 'refusal') AS refused
FROM ${IN_PERIOD}
WHERE outcome != ''
  AND topic IS NOT NULL
GROUP BY topic
ORDER BY refused / closed DESC, closed DESC
LIMIT 6`;

export const UNANSWERED_TREND_SQL = `SELECT ${bucketOf("at")} AS bucket,
  count() AS closed,
  countIf(outcome = 'refusal') AS refused
FROM ${IN_PERIOD}
WHERE outcome != ''
GROUP BY bucket
ORDER BY bucket`;

/** Cohen's kappa: agreement beyond what two raters passing at these rates reach by chance. */
export const JUDGE_AGREEMENT_SQL = `SELECT week, evaluator, reviewed, agreement,
  if(chance < 1, (agreement - chance) / (1 - chance), 1) AS kappa
FROM (
  SELECT toDateTime(toMonday(e.OccurredAt)) AS week,
    e.EvaluatorName AS evaluator,
    count() AS reviewed,
    avg(e.Passed = toUInt8(a.up)) AS agreement,
    avg(e.Passed) * avg(toUInt8(a.up)) + (1 - avg(e.Passed)) * (1 - avg(toUInt8(a.up)))
      AS chance
  FROM evaluation_metrics AS e
  INNER JOIN (
    SELECT TraceId, argMax(IsThumbsUp, CreatedAt) AS up
    FROM annotations
    WHERE ${inPeriod("CreatedAt")}
      AND IsThumbsUp IS NOT NULL
    GROUP BY TraceId
  ) AS a ON a.TraceId = e.TraceId
  WHERE ${inPeriod("e.OccurredAt")}
    AND e.Passed IS NOT NULL
    AND e.IsGuardrail = 0
  GROUP BY week, evaluator
)
ORDER BY week`;

const LAST_THREE_DAYS = `ScheduledAt >= greatest(${START}, subtractDays(${END}, 3))
  AND ScheduledAt < ${END}`;

export const REVIEW_FLAGGED_SQL = `SELECT TraceId AS trace_id,
  argMax(EvaluatorName, ScheduledAt) AS evaluator,
  argMax(Details, ScheduledAt) AS reason,
  max(ScheduledAt) AS at,
  count() OVER () AS flagged
FROM evaluations
WHERE ${LAST_THREE_DAYS}
  AND Passed = 0
  AND ArchivedAt IS NULL
  AND TraceId IS NOT NULL
GROUP BY trace_id
ORDER BY at DESC
LIMIT 4`;

/** LangWatchQL has no hash or random function: the second a check ran, modulo a prime, picks. */
export const REVIEW_AUDIT_SQL = `SELECT TraceId AS trace_id
FROM evaluations
WHERE ${LAST_THREE_DAYS}
  AND Passed IS NOT NULL
  AND ArchivedAt IS NULL
  AND TraceId IS NOT NULL
GROUP BY trace_id
HAVING min(Passed) = 1
ORDER BY modulo(toUnixTimestamp(min(ScheduledAt)), 997)
LIMIT 1`;

const RAG_SPAN = "SpanAttributes['langwatch.span.type'] = 'rag'";
const NOTHING_FOUND = `${RAG_SPAN} AND JSONLength(SpanAttributes['langwatch.rag.contexts']) = 0`;

/** One row per trace that searched: whether a search came back empty and whether it errored. */
const SEARCHES = `(
  SELECT TraceId AS trace_id,
    min(StartTime) AS at,
    max(${RAG_SPAN}) AS searched,
    max(${NOTHING_FOUND}) AS found_nothing,
    max(StatusCode = 2) AS errored
  FROM spans
  WHERE ${inPeriod("StartTime")}
  GROUP BY trace_id
  HAVING searched = 1
)`;

/** A failed trace has one cause: an empty search first, then an error, then a failed check. */
export const FAILURE_SOURCE_SQL = `SELECT ${bucketOf("s.at")} AS bucket,
  count() AS searched,
  countIf(s.found_nothing = 1 AND (s.errored = 1 OR ifNull(j.failed, 0) = 1)) AS retrieval,
  countIf(s.found_nothing = 0 AND s.errored = 1) AS errors,
  countIf(s.found_nothing = 0 AND s.errored = 0 AND ifNull(j.failed, 0) = 1) AS generation
FROM ${SEARCHES} AS s
LEFT JOIN (
  SELECT TraceId, max(Passed = 0) AS failed
  FROM evaluation_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND Passed IS NOT NULL
    AND IsGuardrail = 0
  GROUP BY TraceId
) AS j ON j.TraceId = s.trace_id
GROUP BY bucket
ORDER BY bucket`;

export const EMPTY_RETRIEVAL_SQL = `SELECT ${bucketOf("at")} AS bucket,
  count() AS questions,
  countIf(found_nothing = 1) AS empty_searches,
  countIf(found_nothing = 1 AND errored = 1) AS empty_errored
FROM ${SEARCHES}
GROUP BY bucket
ORDER BY bucket`;

export const CANNOT_SERVE_SQL = `SELECT topic,
  count() AS requests,
  topK(1)(reason)[1] AS reason
FROM ${IN_PERIOD}
WHERE outcome = 'capability_gap'
GROUP BY topic
ORDER BY requests DESC
LIMIT 5`;

export const CANNOT_SERVE_TOTALS_SQL = `SELECT count() AS closed,
  countIf(outcome = 'capability_gap') AS cannot
FROM ${IN_PERIOD}
WHERE outcome != ''`;

const TOPIC = "coalesce(nullIf(p.TopicName, ''), nullIf(t.Attributes['metadata.topic'], ''))";

export const TOPIC_SHARES_SQL = `SELECT ${TOPIC} AS topic,
  countIf(t.OccurredAt >= ${START}) AS in_period,
  countIf(t.OccurredAt < ${START}) AS in_previous
FROM traces AS t
LEFT JOIN topics AS p ON p.TopicId = t.TopicId
WHERE ${inPeriodAndPrevious("t.OccurredAt")}
  AND topic IS NOT NULL
GROUP BY topic`;

export const TOPIC_DAILY_SQL = `SELECT ${bucketOf("t.OccurredAt")} AS bucket,
  ${TOPIC} AS topic,
  count() AS traces
FROM traces AS t
LEFT JOIN topics AS p ON p.TopicId = t.TopicId
WHERE ${inPeriod("t.OccurredAt")}
  AND topic IS NOT NULL
GROUP BY bucket, topic
ORDER BY bucket`;

/** Checks exclude guardrails and the outcome judge: they say whether an answer was safe. */
export const TOPIC_QUALITY_SQL = `SELECT c.topic AS topic,
  count() AS requests,
  countIf(c.outcome != '') AS closed,
  countIf(c.outcome = 'resolved') AS resolved,
  countIf(c.outcome = 'capability_gap') AS cannot,
  sum(ifNull(e.passed, 0)) AS checks_passed,
  sum(ifNull(e.runs, 0)) AS checks_run
FROM ${IN_PERIOD} AS c
LEFT JOIN (
  SELECT TraceId, countIf(Passed = 1) AS passed, count() AS runs
  FROM evaluation_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND Passed IS NOT NULL
    AND IsGuardrail = 0
    AND EvaluatorName != '${OUTCOME_JUDGE}'
  GROUP BY TraceId
) AS e ON e.TraceId = c.trace_id
WHERE c.topic IS NOT NULL
GROUP BY topic
ORDER BY requests DESC
LIMIT 6`;

export const ASKED_AGAIN_SQL = `SELECT ${bucketOf("at")} AS bucket,
  count() AS closed,
  countIf(outcome = 'misunderstood') AS misunderstood
FROM ${IN_PERIOD}
WHERE outcome != ''
GROUP BY bucket
ORDER BY bucket`;

export const RETURNING_USERS_SQL = `SELECT countIf(in_period > 0) AS active,
  countIf(in_period > 0 AND in_previous > 0) AS returning
FROM (
  SELECT UserId,
    countIf(OccurredAt >= ${START}) AS in_period,
    countIf(OccurredAt < ${START}) AS in_previous
  FROM trace_metrics
  WHERE ${inPeriodAndPrevious("OccurredAt")}
    AND UserId IS NOT NULL
    AND UserId != ''
  GROUP BY UserId
)`;
