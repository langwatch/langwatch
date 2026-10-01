export class ClickHouseTraceQuerySubqueryRepository {
  private constructor() {}

  static create(): ClickHouseTraceQuerySubqueryRepository {
    return new ClickHouseTraceQuerySubqueryRepository();
  }

  boundedSubquery(table: string, timeCol: string, innerWhere: string): string {
    return `TraceId IN (SELECT DISTINCT TraceId FROM ${table} WHERE TenantId = {tenantId:String} AND ${timeCol} >= fromUnixTimestamp64Milli({timeFrom:Int64}) AND ${timeCol} <= fromUnixTimestamp64Milli({timeTo:Int64}) AND ${innerWhere})`;
  }

  /**
   * Match the rows an Instant Eval run judged as passed. Dedup is eventual, so
   * the verdict is `argMax(Passed, UpdatedAt)` per key; the partition key is
   * bounded to when the run wrote its judgements, not to the trace window.
   */
  instantEvalJudgmentsSubquery({
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
    // A threads run judges one row per conversation and addresses it by its
    // last trace, so keeping only that trace would show a matched
    // conversation as one turn.
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
   * Match traces whose hoisted `scenario.run_id` belongs to a scenario run row
   * passing `innerWhere` against the deduped `simulation_runs` table. Uses the
   * IN-tuple dedup pattern (no FINAL) and bounds StartedAt for partition pruning.
   */
  scenarioRunSubquery(innerWhere: string): string {
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
}
