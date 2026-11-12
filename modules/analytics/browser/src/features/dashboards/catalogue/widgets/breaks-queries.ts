/**
 * LangWatchQL for "Where my agent breaks": failed steps and tools, errors by type,
 * repeated calls and the tool-choice judge. A step is any span below the trace's root, or a
 * top-level span with nothing below it.
 */

import { bucketOf, END, inPeriod, MIDPOINT, START } from "../../templates/model/lwql-period.ts";

// Typed span columns, never the SpanAttributes map, which runs out of memory on large projects.
const SPAN_TYPE = "SpanType";

/** The evaluator that fails a task whose first tool was the wrong one. */
export const WRONG_TOOL_JUDGE = "Tool choice";

/**
 * Calls, failures and failures recovered by the span above; a lone top-level span is a step whose
 * failure reached the user. Steps are counted in one pass; only failed calls look their parent
 * up, as the hashed side; an unstored parent's call counts, not recovered (analytics ADR-004).
 */
function stepFailuresSql({ toolsOnly, limit }: { toolsOnly: boolean; limit: number }): string {
  const tools = toolsOnly ? `\n      AND ${SPAN_TYPE} = 'tool'` : "";
  return `SELECT step,
  sum(calls) AS calls,
  sum(failures) AS failures,
  sum(recovered) AS recovered
FROM (
  SELECT SpanName AS step, count() AS calls, countIf(StatusCode = 2) AS failures, 0 AS recovered
  FROM span_metrics
  WHERE ${inPeriod("StartTime")}${tools}
    AND (ifNull(ParentSpanId, '') != ''
      OR (ParentSpanId IS NULL
        AND sipHash128(TraceId, SpanId) NOT IN (
          SELECT sipHash128(TraceId, ifNull(ParentSpanId, ''))
          FROM span_metrics
          WHERE ${inPeriod("StartTime")}
            AND ParentSpanId IS NOT NULL
        )))
  GROUP BY step
  UNION ALL
  SELECT c.step AS step, 0 AS calls, 0 AS failures, count() AS recovered
  FROM span_metrics AS p
  INNER JOIN (
    SELECT TraceId, ifNull(ParentSpanId, '') AS parent, SpanName AS step
    FROM span_metrics
    WHERE ${inPeriod("StartTime")}${tools}
      AND ifNull(ParentSpanId, '') != ''
      AND StatusCode = 2
  ) AS c ON c.TraceId = p.TraceId AND c.parent = p.SpanId
  WHERE p.StartTime >= subtractDays(${START}, 1) AND p.StartTime < ${END}
    AND p.StatusCode != 2
  GROUP BY step
)
GROUP BY step
ORDER BY failures - recovered DESC, failures DESC, calls DESC
LIMIT ${limit}`;
}

// Three steps fill the card beside the slowest steps without leaving it half empty.
export const FAILING_STEPS_SQL = stepFailuresSql({ toolsOnly: false, limit: 3 });

/** Every tool, so the widget's totals cover all of them. */
export const TOOL_FAILURES_SQL = stepFailuresSql({ toolsOnly: true, limit: 50 });

const ERROR_CATEGORY = "coalesce(nullIf(ErrorType, ''), SpanName)";

/** Traces with an error per bucket, named by the first step below the root that failed. */
export const ERRORS_BY_TYPE_SQL = `SELECT bucket, category, count() AS traces
FROM (
  SELECT TraceId,
    ${bucketOf("min(StartTime)")} AS bucket,
    argMin(${ERROR_CATEGORY}, tuple(ParentSpanId IS NULL, StartTime)) AS category
  FROM span_metrics
  WHERE ${inPeriod("StartTime")}
    AND StatusCode = 2
  GROUP BY TraceId
)
GROUP BY bucket, category
ORDER BY bucket`;

// A loop: one tool called 3 or more times in a trace with the same input. A retry:
// a failed call followed by another under the same parent, of the same step, or of
// any model call. A trace that does both counts once for each. `uncosted` counts the spans
// with no cost, which make the summed cost a lower bound.
// Loops compare CapturedInput on the gated spans view: no analytics view holds input (#6856).
const REPEATS = `SELECT TraceId, min(StartTime) AS at, SpanName AS step, 1 AS looped,
    sum(ifNull(Cost, 0)) - argMin(ifNull(Cost, 0), StartTime) AS cost,
    countIf(Cost IS NULL) AS uncosted
  FROM spans
  WHERE ${inPeriod("StartTime")}
    AND sipHash128(TraceId, SpanId) IN (
      SELECT sipHash128(TraceId, SpanId)
      FROM span_metrics
      WHERE ${inPeriod("StartTime")}
        AND ${SPAN_TYPE} = 'tool'
    )
  GROUP BY TraceId, SpanName, CapturedInput
  HAVING count() >= 3
  LIMIT 10000
  UNION ALL
  SELECT TraceId, minIf(StartTime, StatusCode = 2) AS at,
    anyIf(SpanName, StatusCode = 2) AS step, 0 AS looped,
    sumIf(ifNull(Cost, 0), StatusCode = 2) AS cost,
    countIf(Cost IS NULL AND StatusCode = 2) AS uncosted
  FROM span_metrics
  WHERE ${inPeriod("StartTime")}
    AND ParentSpanId IS NOT NULL
  GROUP BY TraceId, ParentSpanId, if(${SPAN_TYPE} = 'llm', 'llm', SpanName)
  HAVING countIf(StatusCode = 2) > 0 AND max(StartTime) > minIf(StartTime, StatusCode = 2)
  LIMIT 10000`;

/** Looped and retried traces per bucket, and what the repeated calls cost. */
export const REPEATS_BY_BUCKET_SQL = `SELECT ${bucketOf("at")} AS bucket,
  uniqExactIf(TraceId, looped = 1) AS looped_traces,
  uniqExactIf(TraceId, looped = 0) AS retried_traces,
  sum(cost) AS cost,
  sum(uncosted) AS uncosted_spans
FROM (${REPEATS})
GROUP BY bucket
ORDER BY bucket`;

/** The steps that loop or retry in the most traces. */
export const REPEATED_STEPS_SQL = `SELECT step, uniqExact(TraceId) AS traces
FROM (${REPEATS})
GROUP BY step
ORDER BY traces DESC
LIMIT 3`;

export const TRAFFIC_AND_SPEND_SQL = `SELECT sum(TraceCount) AS traces, sum(CostSum) AS cost
FROM trace_metrics_by_minute
WHERE ${inPeriod("BucketStart")}`;

const WRONG_TOOL_RESULTS = `FROM evaluation_metrics
WHERE ${inPeriod("OccurredAt")}
  AND EvaluatorName = '${WRONG_TOOL_JUDGE}'
  AND Passed IS NOT NULL`;

/** Share of judged tasks per bucket whose first tool the judge marked wrong. */
export const WRONG_TOOL_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  countIf(Passed = 0) / count() AS wrong_rate,
  count() AS judged
${WRONG_TOOL_RESULTS}
GROUP BY bucket
ORDER BY bucket`;

/** The period's wrong-first-tool count, and each half's, to say which way it moved. */
export const WRONG_TOOL_HALVES_SQL = `SELECT countIf(Passed = 0) AS wrong,
  count() AS judged,
  countIf(Passed = 0 AND OccurredAt < ${MIDPOINT}) AS wrong_first,
  countIf(OccurredAt < ${MIDPOINT}) AS judged_first
${WRONG_TOOL_RESULTS}`;
