/**
 * The LangWatchQL behind the Answer quality and What users ask widgets. An outcome is the app's
 * `metadata.outcome`, else the outcome judge's label; a topic is the clustered topic, else the
 * app's `metadata.topic`. No query reads a map (analytics ADR-004).
 */

import {
  END,
  START,
  bucketOf,
  firstTraceMetricsRow,
  inPeriod,
  inPeriodAndPrevious,
} from "../../templates/model/lwql-period.ts";

/** The thread-level category judge that labels how each conversation ended. */
export const OUTCOME_JUDGE = "Conversation Outcome Judge";

type Window = (column: string) => string;

/**
 * The outcome judge's latest label per trace, with its free text `withReason`. Only the
 * widgets that show a reason open `evaluations`, the one view that carries that text.
 */
const judgeVerdicts = ({ window, withReason }: { window: Window; withReason: boolean }) =>
  withReason
    ? `SELECT TraceId,
        argMax(Label, ScheduledAt) AS label,
        argMax(Details, ScheduledAt) AS reason
      FROM evaluations
      WHERE ${window("ScheduledAt")}
        AND EvaluatorName = '${OUTCOME_JUDGE}'
        AND ArchivedAt IS NULL
      GROUP BY TraceId`
    : `SELECT TraceId, argMax(Label, OccurredAt) AS label
      FROM evaluation_metrics
      WHERE ${window("OccurredAt")}
        AND EvaluatorName = '${OUTCOME_JUDGE}'
      GROUP BY TraceId`;

/**
 * Every trace in the window that closed a conversation, once, with its outcome and, as asked, its
 * reason and topic. A sent outcome wins over the judge's (analytics ADR-004).
 */
function tracesWithOutcome({
  window,
  withReason = false,
  withTopic = false,
}: {
  window: Window;
  withReason?: boolean;
  withTopic?: boolean;
}): string {
  const judgeReason = withReason ? ", ifNull(j.reason, '') AS reason" : "";
  const sentReason = withReason ? ", MetadataOutcomeReason AS reason" : "";
  const traceTopic = withTopic ? ", ifNull(TopicId, '') AS topic_id, MetadataTopic" : "";
  const judgeTopic = withTopic ? ", t.topic_id AS topic_id, t.MetadataTopic AS meta_topic" : "";
  const sentTopic = withTopic
    ? ", ifNull(TopicId, '') AS topic_id, MetadataTopic AS meta_topic"
    : "";
  const rows = `SELECT t.TraceId AS trace_id, t.OccurredAt AS row_at${judgeTopic},
        ifNull(j.label, '') AS outcome${judgeReason}, 0 AS sent
      FROM (
        SELECT TraceId, OccurredAt${traceTopic}
        FROM trace_metrics
        WHERE ${window("OccurredAt")}
      ) AS t
      INNER JOIN (
        ${judgeVerdicts({ window, withReason })}
      ) AS j ON j.TraceId = t.TraceId
      UNION ALL
      SELECT TraceId AS trace_id, OccurredAt AS row_at${sentTopic},
        MetadataOutcome AS outcome${sentReason}, 1 AS sent
      FROM trace_metrics
      WHERE ${window("OccurredAt")}
        AND MetadataOutcome != ''`;
  // Sent first, then the latest row: one row per trace, sent and time, as the judge gives one
  // verdict per trace, so outcome and reason come from one row. UInt64, not a tuple: a tuple
  // key's generic state took 350 MB more over 1.76M traces (code 241 at the 1 GB limit).
  const pick =
    "toUInt64(r.sent) * 4611686018427387904 + toUInt64(toUnixTimestamp64Milli(r.row_at))";
  // Each trace keeps a 64-bit hash of its first topic, not two strings; the window's few
  // distinct topics then name it.
  const topicState = withTopic
    ? "\n      argMin(cityHash64(r.topic_id, r.meta_topic), r.row_at) AS topic_key,"
    : "";
  const topicNames = `LEFT JOIN (
    SELECT cityHash64(m.topic_id, m.meta_topic) AS topic_key,
      any(coalesce(nullIf(p.TopicName, ''), nullIf(m.meta_topic, ''))) AS topic
    FROM (
      SELECT DISTINCT ifNull(TopicId, '') AS topic_id, MetadataTopic AS meta_topic
      FROM trace_metrics
      WHERE ${window("OccurredAt")}
    ) AS m
    LEFT JOIN topics AS p ON p.TopicId = m.topic_id
    GROUP BY topic_key
  ) AS k ON k.topic_key = c.topic_key`;
  // Grouped on a 128-bit hash, not the id string; the id is kept for a widget that reads it.
  return `(
  SELECT c.trace_id AS trace_id,
    c.at AS at,${withTopic ? "\n    k.topic AS topic," : ""}
    c.outcome AS outcome${withReason ? ",\n    c.reason AS reason" : ""}
  FROM (
    SELECT any(r.trace_id) AS trace_id,
      min(r.row_at) AS at,${topicState}
      argMax(r.outcome, ${pick}) AS outcome${withReason ? `,\n      argMax(r.reason, ${pick}) AS reason` : ""}
    FROM (
      ${rows}
    ) AS r
    GROUP BY sipHash128(r.trace_id)
  ) AS c${withTopic ? `\n  ${topicNames}` : ""}
)`;
}

const IN_PERIOD = tracesWithOutcome({ window: inPeriod });
const IN_PERIOD_WITH_TOPIC = tracesWithOutcome({ window: inPeriod, withTopic: true });
const WITH_PREVIOUS = tracesWithOutcome({ window: inPeriodAndPrevious });
const WITH_PREVIOUS_AND_REASON = tracesWithOutcome({
  window: inPeriodAndPrevious,
  withReason: true,
});
const IN_PERIOD_WITH_TOPIC_AND_REASON = tracesWithOutcome({
  window: inPeriod,
  withReason: true,
  withTopic: true,
});

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
FROM ${WITH_PREVIOUS_AND_REASON}
WHERE outcome NOT IN ('', 'resolved')
  AND reason != ''
GROUP BY reason
HAVING in_period > 0
ORDER BY in_period DESC
LIMIT 5`;

export const UNANSWERED_TOPICS_SQL = `SELECT topic,
  count() AS closed,
  countIf(outcome = 'refusal') AS refused
FROM ${IN_PERIOD_WITH_TOPIC}
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

// Typed span columns, never the SpanAttributes map, which runs out of memory on large projects.
const RAG_SPAN = "SpanType = 'rag'";
const NOTHING_FOUND = `${RAG_SPAN} AND RagContextCount = 0`;

/** One row per trace that searched: whether a search came back empty and whether it errored. */
const SEARCHES = `(
  SELECT TraceId AS trace_id,
    min(StartTime) AS at,
    max(${RAG_SPAN}) AS searched,
    max(${NOTHING_FOUND}) AS found_nothing,
    max(StatusCode = 2) AS errored
  FROM span_metrics
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
FROM ${IN_PERIOD_WITH_TOPIC_AND_REASON}
WHERE outcome = 'capability_gap'
GROUP BY topic
ORDER BY requests DESC
LIMIT 5`;

export const CANNOT_SERVE_TOTALS_SQL = `SELECT count() AS closed,
  countIf(outcome = 'capability_gap') AS cannot
FROM ${IN_PERIOD}
WHERE outcome != ''`;

/** The clustered topic, else the app's, read from `trace_metrics` (tasks#1117). */
const TOPIC = "coalesce(nullIf(p.TopicName, ''), nullIf(t.MetadataTopic, ''))";

export const TOPIC_SHARES_SQL = `SELECT ${TOPIC} AS topic,
  uniqExactIf(t.TraceId, t.OccurredAt >= ${START}) AS in_period,
  uniqExactIf(t.TraceId, t.OccurredAt < ${START}) AS in_previous
FROM trace_metrics AS t
LEFT JOIN topics AS p ON p.TopicId = t.TopicId
WHERE ${inPeriodAndPrevious("t.OccurredAt")}
  AND ${firstTraceMetricsRow({ view: "t" })}
  AND topic IS NOT NULL
GROUP BY topic`;

export const TOPIC_DAILY_SQL = `SELECT ${bucketOf("t.OccurredAt")} AS bucket,
  ${TOPIC} AS topic,
  uniqExact(t.TraceId) AS traces
FROM trace_metrics AS t
LEFT JOIN topics AS p ON p.TopicId = t.TopicId
WHERE ${inPeriod("t.OccurredAt")}
  AND ${firstTraceMetricsRow({ view: "t" })}
  AND topic IS NOT NULL
GROUP BY bucket, topic
ORDER BY bucket`;

/**
 * Checks exclude guardrails and the outcome judge: they say whether an answer was safe. Requests
 * and checks count trace rows; outcomes come from the closed traces alone.
 */
export const TOPIC_QUALITY_SQL = `SELECT r.topic AS topic,
  r.requests AS requests,
  ifNull(c.closed, 0) AS closed,
  ifNull(c.resolved, 0) AS resolved,
  ifNull(c.cannot, 0) AS cannot,
  r.checks_passed AS checks_passed,
  r.checks_run AS checks_run
FROM (
  SELECT ${TOPIC} AS topic,
    count() AS requests,
    sum(ifNull(e.passed, 0)) AS checks_passed,
    sum(ifNull(e.runs, 0)) AS checks_run
  FROM trace_metrics AS t
  LEFT JOIN topics AS p ON p.TopicId = t.TopicId
  LEFT JOIN (
    SELECT TraceId, countIf(Passed = 1) AS passed, count() AS runs
    FROM evaluation_metrics
    WHERE ${inPeriod("OccurredAt")}
      AND Passed IS NOT NULL
      AND IsGuardrail = 0
      AND EvaluatorName != '${OUTCOME_JUDGE}'
    GROUP BY TraceId
  ) AS e ON e.TraceId = t.TraceId
  WHERE ${inPeriod("t.OccurredAt")}
    AND topic IS NOT NULL
  GROUP BY topic
) AS r
LEFT JOIN (
  SELECT topic,
    countIf(outcome != '') AS closed,
    countIf(outcome = 'resolved') AS resolved,
    countIf(outcome = 'capability_gap') AS cannot
  FROM ${IN_PERIOD_WITH_TOPIC}
  WHERE topic IS NOT NULL
  GROUP BY topic
) AS c ON c.topic = r.topic
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
