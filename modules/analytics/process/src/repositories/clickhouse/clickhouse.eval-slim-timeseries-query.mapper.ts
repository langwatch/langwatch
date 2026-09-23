/**
 * Slim SQL builder for `evaluation_analytics` — ADR-034 Phase 6 (eval mirror
 * of `slim-timeseries-query.ts`), kept separate from the trace slim builder
 * since their column sets differ too much to share one parameterised builder.
 */

import type {
  AnalyticsAggregation,
  AnalyticsFilterValue,
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "@langwatch/analytics-contract";

import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  appendMetadataValueFilterClauses,
  collectStringValues,
  dateTrunc,
  type EvalMetricKey,
  hasFilterValues,
  isEvalMetricKey,
  isPercentile,
  percentileFor,
} from "./clickhouse.timeseries-query-shared.mapper.ts";

const SLIM_TABLE = "evaluation_analytics" as const;
const ea = "ea";

/** Group-by keys the eval slim builder serves. */
export type EvalSlimGroupByKey =
  | "evaluations.evaluator_type"
  | "evaluations.evaluation_passed"
  | "evaluations.evaluation_label"
  | "evaluations.evaluation_status";

/** Eval-slim eligible metric keys (must match SLIM_ELIGIBLE_EVAL_METRIC_KEYS). */

/**
 * Maps an eval metric to its slim column. `Passed` is `Nullable(Bool)`; we
 * coerce with `toUInt8` so `avg` reads as a pass rate. Verdict metrics null
 * themselves on incomplete runs so a stray verdict can't shift the chart (#6833).
 */
function evalSlimColumnFor(metric: EvalMetricKey): string {
  switch (metric) {
    case "evaluations.evaluation_score":
      return `if(${ea}.Status = 'processed', ${ea}.Score, NULL)`;
    case "evaluations.evaluation_pass_rate":
      // Treat true as 1, false as 0; null stays null (excluded from avg).
      return `toUInt8(if(${ea}.Status = 'processed', ${ea}.Passed, NULL))`;
    case "evaluations.evaluation_runs":
      return `${ea}.EvaluationId`;
    default: {
      const _exhaustive: never = metric;
      throw new Error(
        `Eval slim builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to evaluation_runs.`,
      );
    }
  }
}

function isEvalSlimGroupByKey(groupBy: string): groupBy is EvalSlimGroupByKey {
  switch (groupBy) {
    case "evaluations.evaluator_type":
    case "evaluations.evaluation_passed":
    case "evaluations.evaluation_label":
    case "evaluations.evaluation_status":
      return true;
    default:
      return false;
  }
}

function evalSlimGroupByExpression(groupBy?: string): string | null {
  if (!groupBy) return null;
  if (!isEvalSlimGroupByKey(groupBy)) {
    throw new Error(`Eval slim builder cannot group by "${groupBy}".`);
  }
  switch (groupBy) {
    case "evaluations.evaluator_type":
      return `if(${ea}.EvaluatorType = '', 'unknown', ${ea}.EvaluatorType)`;
    case "evaluations.evaluation_passed":
      // Nullable(Bool) → display string for group_key. Status-gated like the
      // metric columns: a historical errored row carrying a stray verdict
      // must bucket as 'unknown', not 'failed' — the legacy per-evaluator
      // path gates the same way (aggregation-builder.ts, #6833).
      return `if(${ea}.Status != 'processed' OR ${ea}.Passed IS NULL, 'unknown', if(${ea}.Passed, 'passed', 'failed'))`;
    case "evaluations.evaluation_label":
      // Same status gate — an errored run's label is not a verdict (#6833).
      return `if(${ea}.Status != 'processed', 'unknown', coalesce(${ea}.Label, 'unknown'))`;
    case "evaluations.evaluation_status":
      return `${ea}.Status`;
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled eval slim group-by: ${String(_exhaustive)}`);
    }
  }
}

// isPercentile + percentileFor moved to _shared.

function evalSlimAggExpression(agg: AnalyticsAggregation, column: string): string {
  if (isPercentile(agg)) {
    return `quantileExact(${percentileFor(agg)})(${column})`;
  }
  switch (agg) {
    case "sum":
      return `coalesce(sum(${column}), 0)`;
    case "avg":
      return `avg(${column})`;
    case "min":
      return `min(${column})`;
    case "max":
      return `max(${column})`;
    case "cardinality":
    case "terms":
      return `uniq(${column})`;
    default:
      throw new Error(`Unhandled eval slim aggregation: ${String(agg)}`);
  }
}

/**
 * Build a deduped FROM-clause for the eval slim table — IN-tuple dedup
 * against `(TenantId, EvaluationId, UpdatedAt)` because slim is
 * `ReplacingMergeTree(UpdatedAt)`. Same pattern as the trace slim builder.
 */
function dedupedSlim(alias: string, dateClause: string): string {
  return `(
    SELECT *
    FROM ${SLIM_TABLE}
    WHERE TenantId = {tenantId:String}
      ${dateClause}
      AND (TenantId, EvaluationId, UpdatedAt) IN (
        SELECT TenantId, EvaluationId, max(UpdatedAt)
        FROM ${SLIM_TABLE}
        WHERE TenantId = {tenantId:String}
          ${dateClause}
        GROUP BY TenantId, EvaluationId
      )
  ) ${alias}`;
}

const SLIM_DATE_FILTER_BOTH_PERIODS = `AND ((OccurredAt >= {currentStart:DateTime64(3)} AND OccurredAt < {currentEnd:DateTime64(3)}) OR (OccurredAt >= {previousStart:DateTime64(3)} AND OccurredAt < {previousEnd:DateTime64(3)}))`;

/**
 * Translate the small slice of filter fields the eval slim natively
 * serves into a WHERE fragment + params. Anything else MUST have been
 * rejected by `pickAnalyticsTable` already.
 */
function buildEvalSlimFilterClauses(filters: AnalyticsTimeseriesBuilderInput["filters"]): {
  whereClause: string;
  params: Record<string, unknown>;
} {
  if (!filters) return { whereClause: "", params: {} };

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  let paramIdx = 0;
  const next = (prefix: string) => `evalslim_${prefix}_${paramIdx++}`;

  for (const [field, rawValue] of Object.entries(filters)) {
    if (!hasFilterValues(rawValue)) continue;
    appendEvalSlimFilterClause({ field, rawValue, clauses, params, next });
  }

  const whereClause = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
  return { whereClause, params };
}

function appendEvalSlimFilterClause({
  field,
  rawValue,
  clauses,
  params,
  next,
}: {
  field: string;
  rawValue: AnalyticsFilterValue;
  clauses: string[];
  params: Record<string, unknown>;
  next: (prefix: string) => string;
}): void {
  switch (field) {
    case "metadata.key": {
      const keys = collectStringValues(rawValue);
      if (keys.length === 0) break;
      const exprs = keys.map((k, i) => {
        const p = next(`metaKey${i}`);
        params[p] = k;
        return `mapContains(${ea}.Attributes, {${p}:String})`;
      });
      clauses.push(`(${exprs.join(" OR ")})`);
      break;
    }
    case "metadata.value": {
      appendMetadataValueFilterClauses({
        attributes: `${ea}.Attributes`,
        rawValue,
        clauses,
        params,
        next,
      });
      break;
    }
    default:
      throw new Error(
        `Eval slim builder cannot serve filter "${field}". The router should have routed this to evaluation_runs.`,
      );
  }
}

/**
 * Builds a slim query for `evaluation_analytics`, UNKEYED series only —
 * it hoists `EvaluatorType`, not `EvaluatorId`, so keyed series route to
 * `evaluation_runs` instead.
 */
export function buildEvalSlimTimeseriesQuery(
  input: AnalyticsTimeseriesBuilderInput,
): BuiltAnalyticsQuery {
  const timeZone = input.timeZone ?? "UTC";

  const selectExprs: string[] = [];
  selectExprs.push(
    `CASE
      WHEN ${ea}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ea}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ea}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ea}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period`,
  );
  if (typeof input.timeScale === "number") {
    selectExprs.push(`${dateTrunc(`${ea}.OccurredAt`, input.timeScale, timeZone)} AS date`);
  }

  const groupByColumn = evalSlimGroupByExpression(input.groupBy);
  if (groupByColumn) {
    selectExprs.push(
      `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`,
    );
  }

  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
    if (!isEvalMetricKey(s.metric)) {
      throw new Error(
        `Eval slim builder cannot serve metric "${s.metric}". The router should have routed this to evaluation_runs.`,
      );
    }
    // `evaluation_analytics` hoists `EvaluatorType`, not `EvaluatorId`, so a
    // per-evaluator predicate cannot be expressed against this table. The
    // router keeps keyed series on `evaluation_runs`; this throw is the
    // backstop for a routing regression, which would otherwise return numbers
    // blended across every evaluator in the project.
    if (s.key !== undefined || s.subkey !== undefined) {
      throw new Error(
        `Eval slim builder cannot filter by evaluator key "${String(s.key)}" — evaluation_analytics has no EvaluatorId column. The router should have routed this to evaluation_runs.`,
      );
    }
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    const expr = evalSlimAggExpression(s.aggregation, evalSlimColumnFor(s.metric));
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");
  if (groupByColumn) groupByExprs.push("group_key");

  const { whereClause: filterWhere, params: filterParams } = buildEvalSlimFilterClauses(
    input.filters,
  );

  const havingClause = groupByColumn ? `HAVING group_key != ''` : "";

  // Outer WHERE is wrapped in one enclosing paren: `dedupedSlim`'s own
  // tenant predicate sits one bracket deep already, so this OR (and any
  // filter clause) must nest deeper still to stay outside the tenant guard's
  // reach — see the matching note on `baseWhere` in aggregation-builder.mapper.ts.
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${dedupedSlim(ea, SLIM_DATE_FILTER_BOTH_PERIODS)}
    WHERE (${ea}.TenantId = {tenantId:String}
      AND (
        (${ea}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ea}.OccurredAt < {currentEnd:DateTime64(3)})
        OR
        (${ea}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ea}.OccurredAt < {previousEnd:DateTime64(3)})
      )
      ${filterWhere})
    GROUP BY ${groupByExprs.join(", ")}
    ${havingClause}
    ORDER BY period${typeof input.timeScale === "number" ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...filterParams,
    },
  };
}
