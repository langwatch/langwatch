/**
 * Slim SQL builder for `trace_analytics` (ADR-034 Phase 3 app-layer module).
 *
 * Single source of truth for the SQL emitted against the slim table.
 * Deliberately separate from the legacy
 * `~/server/analytics/clickhouse/aggregation-builder.ts` (which targets
 * `trace_summaries` and is left UNTOUCHED): slim is one-row-per-trace with
 * hoisted columns + a trimmed Attributes map, so the SQL doesn't need
 * stored_spans / evaluation_runs JOINs or the legacy fan-out fixes.
 *
 * Routing decides whether to call this builder (see `routing/route-table.ts`);
 * the builder only handles what slim supports — any unsupported shape is a
 * programmer error and throws.
 *
 * All queries:
 *   * include `WHERE TenantId = {tenantId:String}` as the FIRST predicate
 *     (multi-tenancy contract, CLAUDE.md);
 *   * filter on the partition column `OccurredAt` so ClickHouse prunes
 *     partitions (clickhouse-queries best-practices);
 *   * dedup the slim table via the IN-tuple pattern — slim is
 *     `ReplacingMergeTree(UpdatedAt)`; same dedup discipline as the legacy
 *     `dedupedTraceSummaries` helper.
 */

import { buildMetricAlias } from "~/server/analytics/clickhouse/metric-translator";
import type { AggregationTypes } from "~/server/analytics/types";
import type { FilterField } from "~/server/filters/types";
import {
  isSlimEligibleTraceMetricKey,
  type SlimTraceMetricKey,
} from "../routing/route-table";
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

const SLIM_TABLE = "trace_analytics" as const;
const ta = "ta";

/** Group-by keys the slim builder serves (typed columns + Attributes reads). */
export type SlimGroupByKey =
  | "topics.topics"
  | "traces.trace_name"
  | "metadata.user_id"
  | "metadata.thread_id"
  | "metadata.customer_id"
  | "metadata.labels"
  | "metadata.model";

/**
 * Slim column / Attributes-map read for a registry metric (Phase 2 hoisted
 * columns; `Attributes['…']` for legacy reads kept by the trim service).
 *
 * Narrowed to `SlimTraceMetricKey` so the exhaustive switch is enforced
 * at compile time; `buildSlimTimeseriesQuery` validates each metric via
 * `isSlimEligibleTraceMetricKey` before dispatch.
 */
function slimColumnFor(metric: SlimTraceMetricKey): string {
  switch (metric) {
    case "metadata.trace_id":
      return `${ta}.TraceId`;
    case "metadata.user_id":
      return `${ta}.UserId`;
    case "metadata.thread_id":
      return `${ta}.ConversationId`;
    case "performance.total_cost":
      return `${ta}.TotalCost`;
    case "performance.cost_non_billed":
      return `coalesce(${ta}.NonBilledCost, 0)`;
    case "performance.cost_billed":
      return `(coalesce(${ta}.TotalCost, 0) - coalesce(${ta}.NonBilledCost, 0))`;
    case "performance.completion_time":
      return `${ta}.TotalDurationMs`;
    case "performance.first_token":
      return `${ta}.TimeToFirstTokenMs`;
    case "performance.prompt_tokens":
      return `${ta}.PromptTokens`;
    case "performance.completion_tokens":
      return `${ta}.CompletionTokens`;
    case "performance.cache_read_tokens":
      return `${ta}.CacheReadTokens`;
    case "performance.cache_write_tokens":
      return `${ta}.CacheWriteTokens`;
    case "performance.reasoning_tokens":
      return `${ta}.ReasoningTokens`;
    case "performance.total_tokens":
      return `(coalesce(${ta}.PromptTokens, 0) + coalesce(${ta}.CompletionTokens, 0))`;
    case "performance.total_processed_tokens":
      // Mirror the rollup's `total_processed_tokens` shape (rollup-timeseries-
      // query.ts:80) by summing the SAME four typed columns — NOT the
      // Attributes-map mirror. Reading the typed columns avoids per-row
      // toUInt64OrZero casts AND insulates this metric from the trim
      // service's policy on `langwatch.reserved.*` keys (which could drop
      // or rename them at any time without affecting analytics correctness).
      return `(coalesce(${ta}.PromptTokens, 0) + coalesce(${ta}.CompletionTokens, 0) + coalesce(${ta}.CacheReadTokens, 0) + coalesce(${ta}.CacheWriteTokens, 0))`;
    case "performance.tokens_per_second":
      return `${ta}.TokensPerSecond`;
    default: {
      const _exhaustive: never = metric;
      throw new Error(
        `Slim builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to trace_summaries.`,
      );
    }
  }
}

function isSlimGroupByKey(groupBy: string): groupBy is SlimGroupByKey {
  switch (groupBy) {
    case "topics.topics":
    case "traces.trace_name":
    case "metadata.user_id":
    case "metadata.thread_id":
    case "metadata.customer_id":
    case "metadata.labels":
    case "metadata.model":
      return true;
    default:
      return false;
  }
}

/**
 * Slim GROUP BY expressions — typed columns + Attributes map reads.
 */
function slimGroupByExpression(groupBy?: string): string | null {
  if (!groupBy) return null;
  if (!isSlimGroupByKey(groupBy)) {
    throw new Error(`Slim builder cannot group by "${groupBy}".`);
  }
  switch (groupBy) {
    case "topics.topics":
      return `${ta}.TopicId`;
    case "traces.trace_name":
      return `if(${ta}.TraceName = '', 'unknown', ${ta}.TraceName)`;
    case "metadata.user_id":
      return `${ta}.UserId`;
    case "metadata.thread_id":
      return `${ta}.ConversationId`;
    case "metadata.customer_id":
      return `${ta}.CustomerId`;
    case "metadata.labels":
      // Slim Labels is Array(String); arrayJoin to one row per label.
      return `arrayJoin(if(empty(${ta}.Labels), [''], ${ta}.Labels))`;
    case "metadata.model":
      return `arrayJoin(if(empty(${ta}.Models), ['unknown'], ${ta}.Models))`;
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled slim group-by: ${String(_exhaustive)}`);
    }
  }
}

// isPercentile + percentileFor are shared with eval-slim-timeseries-query.ts
// via ~/analytics/query-builders/_shared.

/**
 * Slim aggregation expression. Slim has typed columns, so percentiles use
 * `quantileExact` directly (matches the legacy builder's behaviour to keep
 * parity).
 */
function slimAggExpression(
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
      throw new Error(`Unhandled slim aggregation: ${String(agg)}`);
  }
}

/**
 * Build a deduped FROM-clause for the slim table — IN-tuple dedup against
 * `(TenantId, TraceId, UpdatedAt)` because slim is
 * `ReplacingMergeTree(UpdatedAt)`. Same pattern as the legacy
 * `dedupedTraceSummaries` helper, parameterised for the slim table + its
 * OccurredAt partition column.
 */
function dedupedSlim(alias: string, dateClause: string): string {
  return `(
    SELECT *
    FROM ${SLIM_TABLE}
    WHERE TenantId = {tenantId:String}
      ${dateClause}
      AND (TenantId, TraceId, UpdatedAt) IN (
        SELECT TenantId, TraceId, max(UpdatedAt)
        FROM ${SLIM_TABLE}
        WHERE TenantId = {tenantId:String}
          ${dateClause}
        GROUP BY TenantId, TraceId
      )
  ) ${alias}`;
}

const SLIM_DATE_FILTER_BOTH_PERIODS = `AND ((OccurredAt >= {currentStart:DateTime64(3)} AND OccurredAt < {currentEnd:DateTime64(3)}) OR (OccurredAt >= {previousStart:DateTime64(3)} AND OccurredAt < {previousEnd:DateTime64(3)}))`;

/**
 * Translate the small slice of filter fields slim natively serves into a
 * WHERE fragment + params. Anything else MUST have been rejected by
 * `pickAnalyticsTable` already — throws on an unhandled field as a guardrail.
 *
 * Filter values pass through ClickHouse parameter placeholders to avoid
 * injection (same shape as the legacy translator's parameterised reads).
 */
function buildSlimFilterClauses(
  filters: AnalyticsTimeseriesBuilderInput["filters"],
): { whereClause: string; params: Record<string, unknown> } {
  if (!filters) return { whereClause: "", params: {} };

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  let paramIdx = 0;
  const next = (prefix: string) => `slim_${prefix}_${paramIdx++}`;

  for (const [rawField, rawValue] of Object.entries(filters)) {
    if (!hasFilterValues(rawValue)) continue;
    const field = rawField as FilterField;

    switch (field) {
      case "topics.topics": {
        const p = next("topic");
        params[p] = rawValue;
        clauses.push(`${ta}.TopicId IN ({${p}:Array(String)})`);
        break;
      }
      case "topics.subtopics": {
        const p = next("subtopic");
        params[p] = rawValue;
        clauses.push(`${ta}.SubTopicId IN ({${p}:Array(String)})`);
        break;
      }
      case "metadata.user_id": {
        const p = next("user");
        params[p] = rawValue;
        clauses.push(`${ta}.UserId IN ({${p}:Array(String)})`);
        break;
      }
      case "metadata.thread_id": {
        const p = next("thread");
        params[p] = rawValue;
        clauses.push(`${ta}.ConversationId IN ({${p}:Array(String)})`);
        break;
      }
      case "metadata.customer_id": {
        const p = next("customer");
        params[p] = rawValue;
        clauses.push(`${ta}.CustomerId IN ({${p}:Array(String)})`);
        break;
      }
      case "metadata.labels": {
        const p = next("labels");
        params[p] = rawValue;
        clauses.push(`hasAny(${ta}.Labels, {${p}:Array(String)})`);
        break;
      }
      case "metadata.prompt_ids": {
        // Stored as a JSON-string in Attributes['langwatch.prompt_ids']; slim
        // keeps the key (reserved). Read & JSON-extract, then check any-match.
        const p = next("promptIds");
        params[p] = rawValue;
        clauses.push(
          `hasAny(JSONExtract(${ta}.Attributes['langwatch.prompt_ids'], 'Array(String)'), {${p}:Array(String)})`,
        );
        break;
      }
      case "traces.origin": {
        const p = next("origin");
        params[p] = rawValue;
        clauses.push(`${ta}.Origin IN ({${p}:Array(String)})`);
        break;
      }
      case "traces.error": {
        // ES sends "true"/"false"; map to HasError boolean.
        const vals = collectStringValues(rawValue);
        if (vals.length === 0) break;
        if (vals.includes("true") && !vals.includes("false")) {
          clauses.push(`${ta}.HasError = true`);
        } else if (vals.includes("false") && !vals.includes("true")) {
          clauses.push(`${ta}.HasError = false`);
        }
        break;
      }
      case "traces.name": {
        const p = next("name");
        params[p] = rawValue;
        clauses.push(`${ta}.TraceName IN ({${p}:Array(String)})`);
        break;
      }
      case "metadata.key": {
        const keys = collectStringValues(rawValue);
        if (keys.length === 0) break;
        // Filter: trace has AT LEAST ONE of these keys in its (trimmed)
        // Attributes map. mapContains() works on Map(String, String).
        const exprs = keys.map((k, i) => {
          const p = next(`metaKey${i}`);
          params[p] = k;
          return `mapContains(${ta}.Attributes, {${p}:String})`;
        });
        clauses.push(`(${exprs.join(" OR ")})`);
        break;
      }
      case "metadata.value": {
        // Shape: Record<metaKey, string[]>
        if (typeof rawValue !== "object" || Array.isArray(rawValue)) break;
        for (const [metaKey, vals] of Object.entries(rawValue)) {
          if (!Array.isArray(vals) || vals.length === 0) continue;
          const pKey = next("metaValueKey");
          params[pKey] = metaKey;
          const pVals = next("metaValueVals");
          params[pVals] = vals;
          clauses.push(
            `${ta}.Attributes[{${pKey}:String}] IN ({${pVals}:Array(String)})`,
          );
        }
        break;
      }
      default:
        throw new Error(
          `Slim builder cannot serve filter "${field}". The router should have routed this to trace_summaries.`,
        );
    }
  }

  const whereClause = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
  return { whereClause, params };
}

/**
 * Build a slim query for `trace_analytics`.
 *
 * Shape:
 *
 *   SELECT
 *     period, [date], [group_key], <agg(slim col)> AS alias, …
 *   FROM <deduped trace_analytics ta>
 *   WHERE ta.TenantId = {tenantId:String}
 *     AND OccurredAt in [previousStart, currentEnd)
 *     [AND <slim filters>]
 *   GROUP BY period [, date] [, group_key]
 *   ORDER BY period [, date]
 */
export function buildSlimTimeseriesQuery(
  input: AnalyticsTimeseriesBuilderInput,
): BuiltAnalyticsQuery {
  const timeZone = input.timeZone ?? "UTC";

  const selectExprs: string[] = [];
  selectExprs.push(
    `CASE
      WHEN ${ta}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ta}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ta}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ta}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period`,
  );
  if (typeof input.timeScale === "number") {
    selectExprs.push(
      `${dateTrunc(`${ta}.OccurredAt`, input.timeScale, timeZone)} AS date`,
    );
  }

  const groupByColumn = slimGroupByExpression(input.groupBy);
  if (groupByColumn) {
    selectExprs.push(
      `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`,
    );
  }

  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
    if (!isSlimEligibleTraceMetricKey(s.metric)) {
      throw new Error(
        `Slim builder cannot serve metric "${s.metric}". The router should have routed this to trace_summaries.`,
      );
    }
    const alias = buildMetricAlias(i, s.metric, s.aggregation, s.key, s.subkey);
    const expr = slimAggExpression(s.aggregation, slimColumnFor(s.metric));
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");
  if (groupByColumn) groupByExprs.push("group_key");

  const { whereClause: filterWhere, params: filterParams } =
    buildSlimFilterClauses(input.filters);

  const havingClause = groupByColumn ? `HAVING group_key != ''` : "";

  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${dedupedSlim(ta, SLIM_DATE_FILTER_BOTH_PERIODS)}
    WHERE ${ta}.TenantId = {tenantId:String}
      AND (
        (${ta}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ta}.OccurredAt < {currentEnd:DateTime64(3)})
        OR
        (${ta}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ta}.OccurredAt < {previousEnd:DateTime64(3)})
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
