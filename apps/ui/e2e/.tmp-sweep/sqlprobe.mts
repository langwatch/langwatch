import { buildTimeseriesQuery } from "/Users/lw/Source/github.com/langwatch/langwatch/modules/analytics/process/src/repositories/clickhouse/clickhouse.aggregation-builder.mapper.ts";
import { buildSlimTimeseriesQuery } from "/Users/lw/Source/github.com/langwatch/langwatch/modules/analytics/process/src/repositories/clickhouse/clickhouse.slim-timeseries-query.mapper.ts";
import { checkTenantScope } from "/Users/lw/Source/github.com/langwatch/langwatch/packages/clickhouse-client/src/tenantGuard.ts";

const noPrev = {
  projectId: "local-dev-project",
  startDate: 1787176800000,
  endDate: 1789766707887,
  previousPeriodStartDate: undefined,
  filters: {},
  timeZone: "Europe/Amsterdam",
};

const variants: Record<string, unknown> = {
  "noprev/full/traces": { ...noPrev, timeScale: "full", series: [{ name: "Traces", metric: "metadata.trace_id", aggregation: "cardinality" }] },
  "noprev/1440/traces": { ...noPrev, timeScale: 1440, series: [{ name: "Traces", metric: "metadata.trace_id", aggregation: "cardinality" }] },
  "noprev/full/threadMetrics": { ...noPrev, timeScale: "full", series: [
    { name: "Threads count", metric: "metadata.thread_id", aggregation: "cardinality" },
    { name: "Avg messages per thread", metric: "metadata.trace_id", aggregation: "cardinality", pipeline: { field: "thread_id", aggregation: "avg" } },
    { name: "Avg thread duration", metric: "threads.average_duration_per_thread", aggregation: "avg" },
  ] },
  "noprev/full/pipeline": { ...noPrev, timeScale: "full", series: [
    { name: "Avg", metric: "metadata.trace_id", aggregation: "cardinality", pipeline: { field: "thread_id", aggregation: "avg" } },
  ] },
};

for (const [bname, build] of Object.entries({ aggregation: buildTimeseriesQuery, slim: buildSlimTimeseriesQuery })) {
  for (const [vname, input] of Object.entries(variants)) {
    let verdict: unknown; let sql = "";
    try {
      const built = (build as (i: never) => { sql: string; params: unknown })(input as never);
      sql = built.sql;
      verdict = checkTenantScope({ sql, params: built.params as Record<string, unknown>, tenantId: "local-dev-project" });
    } catch (e) { verdict = { threw: String(e).slice(0, 80) }; }
    const tag = verdict === null ? "ok" : JSON.stringify(verdict);
    console.log(`${bname.padEnd(11)} ${vname.padEnd(26)} => ${tag}`);
    if (verdict && typeof verdict === "object" && "kind" in (verdict as object)) {
      console.log("--- SQL ---"); console.log(sql); console.log("--- END ---");
    }
  }
}
