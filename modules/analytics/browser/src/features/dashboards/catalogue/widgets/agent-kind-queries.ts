/**
 * The LangWatchQL behind the boards preloaded for one agent kind: by customer, call
 * quality, field accuracy, outputs users keep and risk sign-off. Metadata keys and
 * check names are the ones the dashboards dev seed sends, so the demo fills every panel.
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

/**
 * The trace attributes a project groups its traffic by, in the order a board picks one, with
 * what one trace of it is called: a document for document types, else a conversation.
 */
export const UNIT_KEYS = [
  {
    attribute: "langwatch.customer_id",
    one: "customer",
    many: "customers",
    things: "conversations",
  },
  {
    attribute: "metadata.document_type",
    one: "document type",
    many: "document types",
    things: "documents",
  },
  { attribute: "metadata.language", one: "language", many: "languages", things: "conversations" },
  { attribute: "metadata.team", one: "team", many: "teams", things: "conversations" },
  { attribute: "metadata.flow", one: "flow", many: "flows", things: "conversations" },
  { attribute: "metadata.segment", one: "segment", many: "segments", things: "conversations" },
  { attribute: "metadata.topic", one: "topic", many: "topics", things: "conversations" },
  { attribute: "langwatch.labels", one: "label", many: "labels", things: "conversations" },
] as const;

const LABELS = "langwatch.labels";

/** The deterministic check that fails a reply which repeats an earlier sentence. */
export const REPEAT_CHECK = "Repeated Sentence Check";
/** The check that lists the wrongly extracted fields as "Wrong: a, b". */
export const FIELD_CHECK = "Field accuracy per field";
const WRONG_PREFIX = "Wrong: ";

/** At least one trace in the period carries the attribute; labels need a non-empty list. */
const carries = (attribute: string) =>
  attribute === LABELS
    ? `countIf(Attributes['${LABELS}'] NOT IN ('', '[]')) > 0, '${attribute}'`
    : `countIf(Attributes['${attribute}'] != '') > 0, '${attribute}'`;

/** The one attribute this project's period groups by, empty when no trace carries any. */
const UNIT_KEY = `(
  SELECT multiIf(
    ${UNIT_KEYS.map(({ attribute }) => carries(attribute)).join(",\n    ")},
    '')
  FROM traces
  WHERE ${inPeriod("OccurredAt")}
) AS unit_key`;

/** A trace's unit: the chosen attribute's value, the first label for labels. */
const UNIT = `if(unit_key = '${LABELS}', JSONExtractString(Attributes['${LABELS}'], 1),
  Attributes[unit_key])`;

/** A conversation is its thread; a trace with no thread is a conversation of one. */
const CONVERSATION = `if(Attributes['langwatch.thread.id'] != '', Attributes['langwatch.thread.id'],
  TraceId)`;

/** The prompt or config version a trace ran on: its managed prompt, else its metadata. */
const VERSION = `coalesce(nullIf(Attributes['metadata.prompt_version'], ''),
  LastUsedPromptVersionId, '')`;

/**
 * Judges' verdicts joined to the unit, version and time of the answer they judged, over the
 * period and the one before: an evaluation is stamped when it ran, maybe long after the answer.
 * Guardrails guard, they do not grade.
 */
const JUDGED_TRACES = `FROM evaluation_metrics AS e
INNER JOIN (
  SELECT TraceId, ${UNIT} AS unit, ${VERSION} AS version, OccurredAt AS at
  FROM traces
  WHERE ${inPeriodAndPrevious("OccurredAt")}
) AS t ON t.TraceId = e.TraceId
WHERE e.OccurredAt >= ${PREVIOUS_START}
  AND e.Passed IS NOT NULL
  AND e.IsGuardrail = false`;

export const UNIT_VOLUME_SQL = `WITH ${UNIT_KEY}
SELECT unit_key, ${UNIT} AS unit,
  uniqExact(${CONVERSATION}) AS conversations,
  sum(TotalCost) AS cost
FROM traces
WHERE ${inPeriod("OccurredAt")}
GROUP BY unit
ORDER BY conversations DESC
LIMIT 8`;

export const UNIT_TOTALS_SQL = `WITH ${UNIT_KEY}
SELECT uniqExact(${CONVERSATION}) AS conversations,
  uniqExact(${UNIT}) AS units,
  sum(TotalCost) AS cost
FROM traces
WHERE ${inPeriod("OccurredAt")}`;

export const UNIT_COST_SQL = `WITH ${UNIT_KEY}
SELECT unit_key, ${UNIT} AS unit, sum(TotalCost) AS cost
FROM traces
WHERE ${inPeriod("OccurredAt")}
GROUP BY unit
ORDER BY cost DESC
LIMIT 6`;

/** Each unit's judged answers in the period and in the equally long window before it. */
export const UNIT_PASS_RATES_SQL = `WITH ${UNIT_KEY}
SELECT t.unit AS unit,
  countIf(e.Passed = 1 AND t.at >= ${START}) AS passed,
  countIf(t.at >= ${START}) AS judged,
  countIf(e.Passed = 1 AND t.at < ${START}) AS passed_before,
  countIf(t.at < ${START}) AS judged_before
${JUDGED_TRACES}
GROUP BY unit
LIMIT 200`;

const VERSIONS = `SELECT ${VERSION} AS version, min(OccurredAt) AS first_seen
    FROM traces
    WHERE ${inPeriodAndPrevious("OccurredAt")}
    GROUP BY version
    HAVING version != ''`;

/** The newest version and the one it replaced, when the newest started in the period. */
export const LAST_CHANGE_SQL = `SELECT versions[1].2 AS version,
  versions[1].1 AS changed_at,
  versions[2].2 AS previous
FROM (
  SELECT arrayReverseSort(groupArray(tuple(first_seen, version))) AS versions
  FROM (
    ${VERSIONS}
  )
)
WHERE length(versions) > 1
  AND changed_at >= ${START}`;

/** Each unit's judged answers per version; the widget compares the newest with the one before. */
export const VERSION_PASS_RATES_SQL = `WITH ${UNIT_KEY}
SELECT unit_key, t.unit AS unit, t.version AS version,
  min(t.at) AS first_seen,
  countIf(e.Passed = 1) AS passed,
  count() AS judged
${JUDGED_TRACES}
  AND t.version != ''
GROUP BY unit, version
LIMIT 500`;

/** One row per voice reply: a trace with a speech span, its stage times summed. */
const VOICE_REPLIES = `SELECT TraceId,
    min(StartTime) AS started,
    dateDiff('millisecond', min(StartTime), max(EndTime)) AS reply_ms,
    sumIf(DurationMs, SpanName = 'stt') AS listening_ms,
    sumIf(DurationMs, SpanAttributes['langwatch.span.type'] = 'llm') AS thinking_ms,
    sumIf(DurationMs, SpanName = 'tts') AS speaking_ms
  FROM spans
  WHERE ${inPeriod("StartTime")}
  GROUP BY TraceId
  HAVING countIf(SpanName IN ('stt', 'tts')) > 0`;

export const VOICE_STAGE_TREND_SQL = `SELECT ${bucketOf("started")} AS bucket,
  quantileExact(0.95)(listening_ms) AS listening_p95,
  quantileExact(0.95)(thinking_ms) AS thinking_p95,
  quantileExact(0.95)(speaking_ms) AS speaking_p95
FROM (
  ${VOICE_REPLIES}
)
GROUP BY bucket
ORDER BY bucket`;

/** Output names differ from the reply columns: ClickHouse resolves an alias before a column. */
const halves = (stage: string) => `quantileExact(0.95)(${stage}_ms) AS ${stage}_p95,
  quantileExactIf(0.95)(${stage}_ms, started < ${MIDPOINT}) AS ${stage}_first_p95,
  quantileExactIf(0.95)(${stage}_ms, started >= ${MIDPOINT}) AS ${stage}_second_p95`;

export const VOICE_STAGE_SUMMARY_SQL = `SELECT count() AS replies,
  quantileExact(0.95)(reply_ms) AS reply_p95,
  ${["listening", "thinking", "speaking"].map(halves).join(",\n  ")}
FROM (
  ${VOICE_REPLIES}
)`;

/** One row per call: a conversation with a speech span, whether it ended on an error. */
const VOICE_CALLS = `SELECT ${CONVERSATION} AS call,
    min(OccurredAt) AS started,
    argMax(ContainsErrorStatus, OccurredAt) AS not_ended,
    max(TraceId IN (
      SELECT TraceId
      FROM evaluation_metrics
      WHERE ${inPeriod("OccurredAt")}
        AND EvaluatorName = '${REPEAT_CHECK}'
        AND Passed = 0
    )) AS repeated
  FROM traces
  WHERE ${inPeriod("OccurredAt")}
    AND TraceId IN (
      SELECT TraceId FROM spans WHERE ${inPeriod("StartTime")} AND SpanName IN ('stt', 'tts')
    )
  GROUP BY call`;

export const VOICE_CALL_TREND_SQL = `SELECT ${bucketOf("started")} AS bucket,
  count() AS calls,
  countIf(not_ended) AS dropped,
  countIf(repeated) AS repeating
FROM (
  ${VOICE_CALLS}
)
GROUP BY bucket
ORDER BY bucket`;

export const VOICE_CALL_SUMMARY_SQL = `SELECT count() AS calls,
  countIf(not_ended) AS dropped,
  countIf(repeated) AS repeating,
  countIf(started < ${MIDPOINT}) AS calls_first,
  countIf(not_ended AND started < ${MIDPOINT}) AS dropped_first,
  countIf(started >= ${MIDPOINT}) AS calls_second,
  countIf(not_ended AND started >= ${MIDPOINT}) AS dropped_second,
  (
    SELECT count()
    FROM evaluation_metrics
    WHERE ${inPeriod("OccurredAt")} AND EvaluatorName = '${REPEAT_CHECK}'
  ) AS repeat_checks
FROM (
  ${VOICE_CALLS}
)`;

const FIELD_CHECKS = `FROM evaluations AS e
INNER JOIN (
  SELECT TraceId, ${UNIT} AS unit
  FROM traces
  WHERE ${inPeriod("OccurredAt")}
) AS t ON t.TraceId = e.TraceId
WHERE ${inPeriod("e.ScheduledAt")}
  AND e.EvaluatorName = '${FIELD_CHECK}'
  AND e.Status = 'processed'`;

export const FIELD_CHECKS_SQL = `WITH ${UNIT_KEY}
SELECT unit_key, t.unit AS unit, count() AS checked
${FIELD_CHECKS}
GROUP BY unit
ORDER BY checked DESC
LIMIT 50`;

/** Each field a check named wrong, per unit. */
export const WRONG_FIELDS_SQL = `WITH ${UNIT_KEY}
SELECT t.unit AS unit,
  arrayJoin(splitByString(', ', substring(ifNull(e.Details, ''), ${WRONG_PREFIX.length + 1}))) AS field,
  count() AS wrong
${FIELD_CHECKS}
  AND startsWith(e.Details, '${WRONG_PREFIX}')
GROUP BY unit, field
LIMIT 500`;

/** Sent to a person: the metadata flag, or the hand-over outcome. */
const SENT_TO_REVIEW = `(Attributes['metadata.sent_to_review'] = 'true'
    OR Attributes['metadata.outcome'] = 'handover')`;
const REPORTS_REVIEW = `(Attributes['metadata.sent_to_review'] != ''
    OR Attributes['metadata.outcome'] != '')`;

export const REVIEW_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  countIf(${REPORTS_REVIEW}) AS documents,
  countIf(${SENT_TO_REVIEW}) AS sent
FROM traces
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

export const REVIEW_SUMMARY_SQL = `SELECT count() AS traces,
  countIf(${REPORTS_REVIEW}) AS documents,
  countIf(${SENT_TO_REVIEW}) AS sent,
  countIf(${REPORTS_REVIEW} AND OccurredAt < ${MIDPOINT}) AS documents_first,
  countIf(${SENT_TO_REVIEW} AND OccurredAt < ${MIDPOINT}) AS sent_first
FROM traces
WHERE ${inPeriod("OccurredAt")}`;

/** The unit sent most, by share of its own documents; a unit under 30 documents ranks last. */
export const REVIEW_BY_UNIT_SQL = `WITH ${UNIT_KEY}
SELECT unit_key, ${UNIT} AS unit,
  countIf(${REPORTS_REVIEW}) AS documents,
  countIf(${SENT_TO_REVIEW}) AS sent
FROM traces
WHERE ${inPeriod("OccurredAt")}
GROUP BY unit
HAVING documents > 0
ORDER BY documents >= 30 DESC, sent / documents DESC
LIMIT 1`;

/** What users did with each output, as the app reports it in `output_action`. */
export const OUTPUT_ACTIONS_SQL = `SELECT count() AS traces,
  countIf(Attributes['metadata.output_action'] != '') AS generated,
  countIf(Attributes['metadata.output_action'] IN ('accepted', 'edited')) AS used,
  countIf(Attributes['metadata.output_action'] = 'accepted') AS accepted
FROM traces
WHERE ${inPeriod("OccurredAt")}`;

/** Per guardrail: traces checked, and answers flagged but not blocked now and the period before. */
export const GUARDRAILS_SQL = `SELECT EvaluatorName AS control,
  uniqExactIf(TraceId, OccurredAt >= ${START}) AS checked,
  countIf(Label = 'flagged' AND OccurredAt >= ${START}) AS flagged,
  countIf(Label = 'flagged' AND OccurredAt < ${START}) AS flagged_before
FROM evaluation_metrics
WHERE ${inPeriodAndPrevious("OccurredAt")}
  AND IsGuardrail = true
GROUP BY control
ORDER BY control
LIMIT 20`;

/** Review items waiting at the end of the period and at its start. */
export const REVIEW_BACKLOG_SQL = `SELECT
  countIf(DoneAt IS NULL OR DoneAt >= ${END}) AS pending,
  countIf(CreatedAt < ${START} AND (DoneAt IS NULL OR DoneAt >= ${START})) AS pending_before
FROM annotation_queue_items
WHERE CreatedAt < ${END}`;

/** Every judge's pass rate; guardrails are controls, not policy criteria. */
export const CRITERIA_SQL = `SELECT EvaluatorName AS criterion,
  countIf(Passed = 1) AS passed,
  count() AS judged
FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND Passed IS NOT NULL
  AND IsGuardrail = false
GROUP BY criterion
ORDER BY passed / judged ASC
LIMIT 6`;

export const QUEUE_SUMMARY_SQL = `SELECT
  countIf(${inPeriod("CreatedAt")}) AS came_in,
  countIf(${inPeriod("DoneAt")}) AS reviewed,
  countIf(DoneAt IS NULL OR DoneAt >= ${END}) AS pending,
  countIf(CreatedAt < ${START} AND (DoneAt IS NULL OR DoneAt >= ${START})) AS pending_before,
  quantileIf(0.5)(dateDiff('second', CreatedAt, DoneAt), ${inPeriod("DoneAt")}) AS wait_seconds
FROM annotation_queue_items
WHERE CreatedAt < ${END}`;

export const QUEUE_FLOW_SQL = `SELECT bucket, sum(came_in) AS came_in, sum(reviewed) AS reviewed
FROM (
  SELECT ${bucketOf("CreatedAt")} AS bucket, 1 AS came_in, 0 AS reviewed
  FROM annotation_queue_items
  WHERE ${inPeriod("CreatedAt")}
  UNION ALL
  SELECT ${bucketOf("DoneAt")} AS bucket, 0 AS came_in, 1 AS reviewed
  FROM annotation_queue_items
  WHERE CreatedAt < ${END}
    AND ${inPeriod("DoneAt")}
)
GROUP BY bucket
ORDER BY bucket`;

/** Prompt versions, new evaluators and changed online evaluations, newest first. */
export const CHANGES_SQL = `SELECT at, kind, name
FROM (
  SELECT v.CreatedAt AS at, 'Prompt version' AS kind,
    concat(p.PromptName, ' v', toString(v.VersionNumber)) AS name
  FROM prompt_versions AS v
  LEFT JOIN prompts AS p ON p.PromptId = v.PromptId
  WHERE ${inPeriod("v.CreatedAt")}
  LIMIT 50
  UNION ALL
  SELECT CreatedAt AS at, 'Evaluator added' AS kind, Name AS name
  FROM evaluators
  WHERE ${inPeriod("CreatedAt")}
  LIMIT 50
  UNION ALL
  SELECT UpdatedAt AS at, 'Online evaluation changed' AS kind, Name AS name
  FROM monitors
  WHERE ${inPeriod("UpdatedAt")}
  LIMIT 50
)
ORDER BY at DESC
LIMIT 8`;
