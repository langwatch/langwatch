export function boundedSubquery(
  table: string,
  timeCol: string,
  innerWhere: string,
): string {
  return `TraceId IN (SELECT DISTINCT TraceId FROM ${table} WHERE TenantId = {tenantId:String} AND ${timeCol} >= fromUnixTimestamp64Milli({timeFrom:Int64}) AND ${timeCol} <= fromUnixTimestamp64Milli({timeTo:Int64}) AND ${innerWhere})`;
}

/**
 * Match the rows an Instant Eval run judged as passed.
 *
 * `instant_eval_judgments` is a ReplacingMergeTree whose dedup is eventual,
 * so the verdict is read as `argMax(Passed, UpdatedAt)` per key, never off a
 * raw row. The sort key starts with `(TenantId, RunId)`, which the WHERE
 * follows, and `CreatedAt` is the partition key, bounded to the window the
 * run wrote its judgements in rather than the trace window: a run over last
 * month's traces writes its verdicts now.
 *
 * `by: "trace"` keeps the judged traces. `by: "conversation"` keeps every
 * trace of a judged conversation, because a threads run judges one row per
 * conversation and addresses it by its last trace, which alone would show a
 * matched conversation as one turn.
 */
export function instantEvalJudgmentsSubquery({
  by,
  runParam,
  fromParam,
  untilParam,
}: {
  by: "trace" | "conversation";
  runParam: string;
  fromParam: string;
  untilParam: string;
}): string {
  const where =
    `TenantId = {tenantId:String} AND RunId = {${runParam}:String}` +
    ` AND CreatedAt >= fromUnixTimestamp64Milli({${fromParam}:Int64})` +
    ` AND CreatedAt <= fromUnixTimestamp64Milli({${untilParam}:Int64})`;
  if (by === "conversation") {
    return (
      `Attributes['gen_ai.conversation.id'] IN (SELECT argMax(ThreadId, UpdatedAt) AS MatchedThreadId FROM instant_eval_judgments WHERE ${where}` +
      ` GROUP BY TraceId, SpanId, QuestionId HAVING argMax(Passed, UpdatedAt) = 1 AND MatchedThreadId != '')`
    );
  }
  return (
    `TraceId IN (SELECT TraceId FROM instant_eval_judgments WHERE ${where}` +
    ` GROUP BY TraceId, SpanId, QuestionId HAVING argMax(Passed, UpdatedAt) = 1)`
  );
}

/**
 * Match traces with an evaluation whose latest stored version passes
 * `innerWhere`. `evaluation_runs` keeps one row per state change (scheduled,
 * in progress, processed) until a merge, so reading a raw row could judge an
 * evaluation by a state it already left. Uses the IN-tuple dedup pattern (no
 * FINAL), as the evaluation run repository does.
 */
export function latestEvaluationRunsSubquery({
  timeCol,
  scopeWhere,
  innerWhere,
}: {
  timeCol: string;
  /** Narrows both the rows and the dedup scan, e.g. to one evaluator. */
  scopeWhere: string;
  innerWhere: string;
}): string {
  const bounds = `TenantId = {tenantId:String} AND ${timeCol} >= fromUnixTimestamp64Milli({timeFrom:Int64}) AND ${timeCol} <= fromUnixTimestamp64Milli({timeTo:Int64}) AND ${scopeWhere}`;
  return (
    `TraceId IN (SELECT DISTINCT TraceId FROM evaluation_runs WHERE ${bounds} AND ${innerWhere}` +
    ` AND (TenantId, EvaluationId, UpdatedAt) IN (SELECT TenantId, EvaluationId, max(UpdatedAt) FROM evaluation_runs WHERE ${bounds} GROUP BY TenantId, EvaluationId))`
  );
}

/**
 * Match traces whose hoisted `scenario.run_id` belongs to a scenario run row
 * passing `innerWhere` against the deduped `simulation_runs` table. Uses the
 * IN-tuple dedup pattern (no FINAL) and bounds StartedAt for partition pruning.
 */
export function scenarioRunSubquery(innerWhere: string): string {
  return `Attributes['scenario.run_id'] IN (
    SELECT ScenarioRunId
    FROM simulation_runs
    WHERE TenantId = {tenantId:String}
      AND StartedAt >= fromUnixTimestamp64Milli({timeFrom:Int64})
      AND StartedAt <= fromUnixTimestamp64Milli({timeTo:Int64})
      AND ${innerWhere}
      AND (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, UpdatedAt) IN (
        SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
        FROM simulation_runs
        WHERE TenantId = {tenantId:String}
          AND StartedAt >= fromUnixTimestamp64Milli({timeFrom:Int64})
          AND StartedAt <= fromUnixTimestamp64Milli({timeTo:Int64})
        GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
      )
  )`;
}
