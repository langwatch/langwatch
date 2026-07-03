/**
 * Slim SQL builder for `evaluation_analytics` — ADR-034 Phase 6 (eval mirror
 * of `slim-timeseries-query.ts`).
 *
 * Deliberately separate from the trace slim builder because the column set
 * differs: the eval slim has typed columns for Score / Passed / EvaluatorType
 * / Status / Label rather than the trace slim's TraceName / Models / cost-
 * and-token bag. Parameterising one builder across both would devolve into a
 * pile of source-conditional column picks; two builders read straight-line
 * better and let each one's exhaustiveness assertion guard its own column
 * set.
 *
 * Routing decides whether to call this builder (`pickAnalyticsTable` returns
 * `"evaluation_analytics"`); the builder only handles what the eval slim
 * supports — any unsupported shape is a programmer error and throws.
 *
 * All queries:
 *   * include `WHERE TenantId = {tenantId:String}` as the FIRST predicate
 *     (multi-tenancy contract);
 *   * filter on the partition column `OccurredAt` so ClickHouse prunes
 *     partitions (clickhouse-queries best-practices);
 *   * dedup the slim table via the IN-tuple pattern — eval slim is
 *     `ReplacingMergeTree(UpdatedAt)`.
 */

import { buildMetricAlias } from "~/server/analytics/clickhouse/metric-translator";
import type { AggregationTypes } from "~/server/analytics/types";
import type { FilterField } from "~/server/filters/types";
import type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "../types";
import {
  collectStringValues,
  dateTrunc,
  hasFilterValues,
  isPercentile,
  percentileFor,
} from "./_shared";

const SLIM_TABLE = "evaluation_analytics" as const;
const ea = "ea";

/** Group-by keys the eval slim builder serves. */
export type EvalSlimGroupByKey =
  | "evaluations.evaluator_type"
  | "evaluations.evaluation_passed"
  | "evaluations.evaluation_label"
  | "evaluations.evaluation_status";

/** Eval-slim eligible metric keys (must match SLIM_ELIGIBLE_EVAL_METRIC_KEYS). */
export type EvalSlimMetricKey =
  | "evaluations.evaluation_score"
  | "evaluations.evaluation_pass_rate"
  | "evaluations.evaluation_runs";

function isEvalSlimMetricKey(metric: string): metric is EvalSlimMetricKey {
  return (
    metric === "evaluations.evaluation_score" ||
    metric === "evaluations.evaluation_pass_rate" ||
    metric === "evaluations.evaluation_runs"
  );
}

/**
 * Map an eval metric to its slim column expression.
 *
 * Pass-rate is special: `Passed` is `Nullable(Bool)`, and the registry's
 * `avg` over a boolean treats it as 0/1. We coerce with `toUInt8` so the
 * avg comes out as the pass rate.
 */
function evalSlimColumnFor(metric: EvalSlimMetricKey): string {
  switch (metric) {
    case "evaluations.evaluation_score":
      return `${ea}.Score`;
    case "evaluations.evaluation_pass_rate":
      // Treat true as 1, false as 0; null stays null (excluded from avg).
      return `toUInt8(${ea}.Passed)`;
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
      // Nullable(Bool) → display string for group_key.
      return `if(${ea}.Passed IS NULL, 'unknown', if(${ea}.Passed, 'passed', 'failed'))`;
    case "evaluations.evaluation_label":
      return `coalesce(${ea}.Label, 'unknown')`;
    case "evaluations.evaluation_status":
      return `${ea}.Status`;
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled eval slim group-by: ${String(_exhaustive)}`);
    }
  }
}

// isPercentile + percentileFor moved to _shared.

function evalSlimAggExpression(
  agg: AggregationTypes,
  column: string,
): string {
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
function buildEvalSlimFilterClauses(
  filters: AnalyticsTimeseriesBuilderInput["filters"],
): { whereClause: string; params: Record<string, unknown> } {
  if (!filters) return { whereClause: "", params: {} };

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  let paramIdx = 0;
  const next = (prefix: string) => `evalslim_${prefix}_${paramIdx++}`;

  for (const [rawField, rawValue] of Object.entries(filters)) {
    if (!hasFilterValues(rawValue)) continue;
    const field = rawField as FilterField;

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
        if (typeof rawValue !== "object" || Array.isArray(rawValue)) break;
        for (const [metaKey, vals] of Object.entries(rawValue)) {
          if (!Array.isArray(vals) || vals.length === 0) continue;
          const pKey = next("metaValueKey");
          params[pKey] = metaKey;
          const pVals = next("metaValueVals");
          params[pVals] = vals;
          clauses.push(
            `${ea}.Attributes[{${pKey}:String}] IN ({${pVals}:Array(String)})`,
          );
        }
        break;
      }
      default:
        throw new Error(
          `Eval slim builder cannot serve filter "${field}". The router should have routed this to evaluation_runs.`,
        );
    }
  }

  const whereClause = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
  return { whereClause, params };
}

/**
 * Build a slim query for `evaluation_analytics`.
 *
 * Key-bearing series (registry `requiresKey`, e.g. per-evaluator queries)
 * are refused by the router (rt5014-001: no `EvaluatorId` column on the
 * slim table) and the builder throws loud if one slips through — see the
 * `s.key !== undefined` guard below.
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
    selectExprs.push(
      `${dateTrunc(`${ea}.OccurredAt`, input.timeScale, timeZone)} AS date`,
    );
  }

  const groupByColumn = evalSlimGroupByExpression(input.groupBy);
  if (groupByColumn) {
    selectExprs.push(
      `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`,
    );
  }

  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
    if (!isEvalSlimMetricKey(s.metric)) {
      throw new Error(
        `Eval slim builder cannot serve metric "${s.metric}". The router should have routed this to evaluation_runs.`,
      );
    }
    // Router refuses key-bearing series for eval slim (rt5014-001): the slim
    // table has no EvaluatorId column, so per-evaluator filtering can't be
    // served here. Fail loud if the router breaks.
    if (s.key !== undefined) {
      throw new Error(
        `Eval slim builder cannot serve series with key="${s.key}" — the router should have routed this to evaluation_runs (no EvaluatorId column on evaluation_analytics; see migration 00040).`,
      );
    }
    const alias = buildMetricAlias(i, s.metric, s.aggregation, s.key, s.subkey);
    const expr = evalSlimAggExpression(s.aggregation, evalSlimColumnFor(s.metric));
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");
  if (groupByColumn) groupByExprs.push("group_key");

  const { whereClause: filterWhere, params: filterParams } =
    buildEvalSlimFilterClauses(input.filters);

  const havingClause = groupByColumn ? `HAVING group_key != ''` : "";

  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${dedupedSlim(ea, SLIM_DATE_FILTER_BOTH_PERIODS)}
    WHERE ${ea}.TenantId = {tenantId:String}
      AND (
        (${ea}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ea}.OccurredAt < {currentEnd:DateTime64(3)})
        OR
        (${ea}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ea}.OccurredAt < {previousEnd:DateTime64(3)})
      )
      ${filterWhere}
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
