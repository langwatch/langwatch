/**
 * The LangWatchQL behind the boards preloaded for one agent kind: by customer, call
 * quality, field accuracy, outputs users keep and risk sign-off. Metadata keys and
 * check names are the ones the dashboards dev seed sends, so the demo fills every panel.
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

type UnitAttribute = (typeof UNIT_KEYS)[number]["attribute"];

const LABELS = "langwatch.labels";

/** The deterministic check that fails a reply which repeats an earlier sentence. */
export const REPEAT_CHECK = "Repeated Sentence Check";
/** The check that lists the wrongly extracted fields as "Wrong: a, b". */
export const FIELD_CHECK = "Field accuracy per field";
const WRONG_PREFIX = "Wrong: ";

/** A conversation is its thread; a trace with no thread is a conversation of one. */
const CONVERSATION = `if(Attributes['langwatch.thread.id'] != '', Attributes['langwatch.thread.id'],
  TraceId)`;

/**
 * The one attribute this project's period groups by, read from `trace_metrics`' typed columns
 * (tasks#1117), never the `traces` map, which runs out of memory on large projects.
 */
const METRICS_UNIT_COLUMNS: Readonly<Record<UnitAttribute, string>> = {
  "langwatch.customer_id": "ifNull(CustomerId, '')",
  "metadata.document_type": "MetadataDocumentType",
  "metadata.language": "MetadataLanguage",
  "metadata.team": "MetadataTeam",
  "metadata.flow": "MetadataFlow",
  "metadata.segment": "MetadataSegment",
  "metadata.topic": "MetadataTopic",
  [LABELS]: "Labels[1]",
};

const metricsCarries = (attribute: UnitAttribute) =>
  attribute === LABELS
    ? `countIf(notEmpty(Labels)) > 0, '${attribute}'`
    : `countIf(${METRICS_UNIT_COLUMNS[attribute]} != '') > 0, '${attribute}'`;

const METRICS_UNIT_KEY = `(
  SELECT multiIf(
    ${UNIT_KEYS.map(({ attribute }) => metricsCarries(attribute)).join(",\n    ")},
    '')
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
) AS unit_key`;

const metricsUnitOf = ({ attribute }: { attribute: UnitAttribute }) =>
  `unit_key = '${attribute}', ${METRICS_UNIT_COLUMNS[attribute]}`;

const METRICS_UNIT = `multiIf(
    ${UNIT_KEYS.map(metricsUnitOf).join(",\n    ")},
    '')`;

const METRICS_CONVERSATION = "coalesce(nullIf(ConversationId, ''), TraceId)";

/** A trace's key in the judged-trace joins: 16 bytes instead of the id (analytics ADR-004). */
const TRACE_KEY = "sipHash128(TraceId)";

/**
 * Judges' verdicts per judged trace, over the period and the one before: an evaluation is
 * stamped when it ran, maybe long after the answer. Guardrails guard, they do not grade. One
 * small row per trace, so it is the joined side and the trace rows stream past it.
 */
const JUDGED_PER_TRACE = `SELECT ${TRACE_KEY} AS trace, countIf(Passed = 1) AS passed, count() AS judged
  FROM evaluation_metrics
  WHERE OccurredAt >= ${PREVIOUS_START}
    AND Passed IS NOT NULL
    AND IsGuardrail = false
  GROUP BY trace`;

/** The time a managed-version row carries, after every trace row, so no `min` picks it. */
const AFTER_EVERY_ROW = "toDateTime64('2200-01-01 00:00:00', 3)";

/**
 * Each judged trace once, with the unit and metadata version of its first `trace_metrics` row:
 * the rows stream past the judged side and only judged traces are grouped. With `managed`, the
 * managed prompt version streams in beside the rows, so no second join (analytics ADR-004).
 */
function judgedUnitTraces({ managed }: { managed: boolean }): string {
  const managedRows = `
    UNION ALL
    SELECT ${TRACE_KEY} AS trace, '' AS unit, '' AS version, ${AFTER_EVERY_ROW} AS at,
      LastUsedPromptVersionId AS managed
    FROM traces
    WHERE ${inPeriodAndPrevious("OccurredAt")}
      AND LastUsedPromptVersionId != ''`;
  return `SELECT t.trace AS trace,
    argMin(t.unit, t.at) AS unit,
    argMin(t.version, t.at) AS version,
    min(t.at) AS at,${managed ? "\n    any(t.managed) AS managed," : ""}
    any(e.passed) AS passed,
    any(e.judged) AS judged
  FROM (
    SELECT ${TRACE_KEY} AS trace, ${METRICS_UNIT} AS unit, MetadataPromptVersion AS version,
      OccurredAt AS at${managed ? ",\n      CAST(NULL AS Nullable(String)) AS managed" : ""}
    FROM trace_metrics
    WHERE ${inPeriodAndPrevious("OccurredAt")}${managed ? managedRows : ""}
  ) AS t
  INNER JOIN (
    ${JUDGED_PER_TRACE}
  ) AS e ON e.trace = t.trace
  GROUP BY t.trace${managed ? `\n  HAVING at < ${AFTER_EVERY_ROW}` : ""}`;
}

export const UNIT_VOLUME_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT unit_key, ${METRICS_UNIT} AS unit,
  uniqExact(${METRICS_CONVERSATION}) AS conversations,
  sum(TotalCost) AS cost
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${firstTraceMetricsRow()}
GROUP BY unit
ORDER BY conversations DESC
LIMIT 8`;

/**
 * `conversations` is the share denominator, so it counts (unit, conversation) pairs: a thread
 * whose traces fall in two units counts once in each unit row, and so twice here too.
 */
export const UNIT_TOTALS_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT uniqExact((${METRICS_UNIT}, ${METRICS_CONVERSATION})) AS conversations,
  uniqExact(${METRICS_UNIT}) AS units,
  sum(TotalCost) AS cost
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${firstTraceMetricsRow()}`;

export const UNIT_COST_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT unit_key, ${METRICS_UNIT} AS unit, sum(TotalCost) AS cost
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${firstTraceMetricsRow()}
GROUP BY unit
ORDER BY cost DESC
LIMIT 6`;

/** Each unit's judged answers in the period and in the equally long window before it. */
export const UNIT_PASS_RATES_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT t.unit AS unit,
  sumIf(t.passed, t.at >= ${START}) AS passed,
  sumIf(t.judged, t.at >= ${START}) AS judged,
  sumIf(t.passed, t.at < ${START}) AS passed_before,
  sumIf(t.judged, t.at < ${START}) AS judged_before
FROM (
  ${judgedUnitTraces({ managed: false })}
) AS t
GROUP BY unit
LIMIT 200`;

/**
 * A trace's version is its metadata's (`trace_metrics`), else its managed prompt version, never
 * the map (analytics ADR-004). The id set holds 64-bit hashes of the traces that send a metadata
 * version: id strings outgrew the memory limit on 2M traces a month.
 */
const METADATA_VERSIONED = `SELECT cityHash64(TraceId)
        FROM trace_metrics
        WHERE ${inPeriodAndPrevious("OccurredAt")}
          AND MetadataPromptVersion != ''`;

const VERSIONS = `SELECT version, min(first_seen) AS first_seen
    FROM (
      SELECT MetadataPromptVersion AS version, min(OccurredAt) AS first_seen
      FROM trace_metrics
      WHERE ${inPeriodAndPrevious("OccurredAt")}
        AND MetadataPromptVersion != ''
      GROUP BY version
      UNION ALL
      SELECT ifNull(LastUsedPromptVersionId, '') AS version, min(OccurredAt) AS first_seen
      FROM traces
      WHERE ${inPeriodAndPrevious("OccurredAt")}
        AND LastUsedPromptVersionId != ''
        AND cityHash64(TraceId) NOT IN (
          ${METADATA_VERSIONED}
        )
      GROUP BY version
    )
    GROUP BY version`;

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

/**
 * Each unit's judged answers per version; the widget compares the newest with the one before.
 * The managed prompt version is read beside the judged traces' rows, never joined to them.
 */
export const VERSION_PASS_RATES_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT unit_key, t.unit AS unit,
  coalesce(nullIf(t.version, ''), t.managed, '') AS version,
  min(t.at) AS first_seen,
  sum(t.passed) AS passed,
  sum(t.judged) AS judged
FROM (
  ${judgedUnitTraces({ managed: true })}
) AS t
WHERE version != ''
GROUP BY unit, version
LIMIT 500`;

/** One row per voice reply: a trace with a speech span, its stage times summed. */
const VOICE_REPLIES = `SELECT TraceId,
    min(StartTime) AS started,
    dateDiff('millisecond', min(StartTime), max(EndTime)) AS reply_ms,
    sumIf(DurationMs, SpanName = 'stt') AS listening_ms,
    sumIf(DurationMs, SpanType = 'llm') AS thinking_ms,
    sumIf(DurationMs, SpanName = 'tts') AS speaking_ms
  FROM span_metrics
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
      SELECT TraceId FROM span_metrics WHERE ${inPeriod("StartTime")} AND SpanName IN ('stt', 'tts')
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

/**
 * Each field check once, with its trace's unit. The checks are the joined side, so the trace
 * rows stream past them, and a trace with two rows still counts its checks once.
 */
const fieldChecks = (condition = "") => `FROM (
  SELECT e.EvaluationId AS id,
    argMin(t.unit, t.at) AS unit,
    any(e.Details) AS details
  FROM (
    SELECT TraceId, ${METRICS_UNIT} AS unit, OccurredAt AS at
    FROM trace_metrics
    WHERE ${inPeriod("OccurredAt")}
  ) AS t
  INNER JOIN (
    SELECT EvaluationId, TraceId, Details
    FROM evaluations
    WHERE ${inPeriod("ScheduledAt")}
      AND EvaluatorName = '${FIELD_CHECK}'
      AND Status = 'processed'${condition}
  ) AS e ON e.TraceId = t.TraceId
  GROUP BY e.EvaluationId
) AS c`;

export const FIELD_CHECKS_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT unit_key, c.unit AS unit, count() AS checked
${fieldChecks()}
GROUP BY unit
ORDER BY checked DESC
LIMIT 50`;

/** Each field a check named wrong, per unit. */
export const WRONG_FIELDS_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT c.unit AS unit,
  arrayJoin(splitByString(', ', substring(ifNull(c.details, ''), ${WRONG_PREFIX.length + 1}))) AS field,
  count() AS wrong
${fieldChecks(`\n      AND startsWith(Details, '${WRONG_PREFIX}')`)}
GROUP BY unit, field
LIMIT 500`;

/** Sent to a person: the metadata flag, or the hand-over outcome. */
const SENT_TO_REVIEW = "(MetadataSentToReview = 'true' OR MetadataOutcome = 'handover')";
const REPORTS_REVIEW = "(MetadataSentToReview != '' OR MetadataOutcome != '')";

export const REVIEW_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  uniqExactIf(TraceId, ${REPORTS_REVIEW}) AS documents,
  uniqExactIf(TraceId, ${SENT_TO_REVIEW}) AS sent
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${firstTraceMetricsRow()}
GROUP BY bucket
ORDER BY bucket`;

export const REVIEW_SUMMARY_SQL = `SELECT uniqExact(TraceId) AS traces,
  uniqExactIf(TraceId, ${REPORTS_REVIEW}) AS documents,
  uniqExactIf(TraceId, ${SENT_TO_REVIEW}) AS sent,
  uniqExactIf(TraceId, ${REPORTS_REVIEW} AND OccurredAt < ${MIDPOINT}) AS documents_first,
  uniqExactIf(TraceId, ${SENT_TO_REVIEW} AND OccurredAt < ${MIDPOINT}) AS sent_first
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
  AND ${firstTraceMetricsRow()}`;

/** The unit sent most, by share of its own documents; a unit under 30 documents ranks last. */
export const REVIEW_BY_UNIT_SQL = `WITH ${METRICS_UNIT_KEY}
SELECT unit_key, ${METRICS_UNIT} AS unit,
  uniqExactIf(TraceId, ${REPORTS_REVIEW}) AS documents,
  uniqExactIf(TraceId, ${SENT_TO_REVIEW}) AS sent
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY unit
HAVING documents > 0
ORDER BY documents >= 30 DESC, sent / documents DESC
LIMIT 1`;

/** What users did with each output, as the app reports it in `output_action`. */
export const OUTPUT_ACTIONS_SQL = `SELECT uniqExact(TraceId) AS traces,
  uniqExactIf(TraceId, MetadataOutputAction != '') AS generated,
  uniqExactIf(TraceId, MetadataOutputAction IN ('accepted', 'edited')) AS used,
  uniqExactIf(TraceId, MetadataOutputAction = 'accepted') AS accepted
FROM trace_metrics
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
