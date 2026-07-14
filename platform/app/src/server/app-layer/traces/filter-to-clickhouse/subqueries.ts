export function boundedSubquery(
  table: string,
  timeCol: string,
  innerWhere: string,
): string {
  return `TraceId IN (SELECT DISTINCT TraceId FROM ${table} WHERE TenantId = {tenantId:String} AND ${timeCol} >= fromUnixTimestamp64Milli({timeFrom:Int64}) AND ${timeCol} <= fromUnixTimestamp64Milli({timeTo:Int64}) AND ${innerWhere})`;
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
