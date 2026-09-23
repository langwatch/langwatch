/**
 * Slim SQL builder for `trace_analytics` (ADR-034 Phase 3) — deliberately
 * separate from the legacy `aggregation-builder.ts` (trace_summaries). Follows
 * clickhouse-queries.md's TenantId/partition/dedup rules; throws on unsupported shapes.
 */

import type {
  AnalyticsAggregation,
  AnalyticsFilterValue,
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "@langwatch/analytics-contract";

import { TRACE_ANALYTICS_HAS_SIGNAL_SQL } from "../../rules/trace-signal.rules.ts";
import {
  isSlimEligibleTraceMetricKey,
  type SlimTraceMetricKey,
} from "./clickhouse.analytics-route-table.mapper.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  appendMetadataValueFilterClauses,
  collectStringValues,
  dateTrunc,
  hasFilterValues,
  isPercentile,
  percentileFor,
} from "./clickhouse.timeseries-query-shared.mapper.ts";

const SLIM_TABLE = "trace_analytics" as const;
const ta = "ta";

/**
 * Group-by keys the slim builder serves. `metadata.model` is deliberately
 * NOT here: model group-bys need per-SPAN attribution slim has no data for;
 * the router sends them to `trace_summaries` (see route-table.ts).
 */
export type SlimGroupByKey =
  | "topics.topics"
  | "traces.trace_name"
  | "metadata.user_id"
  | "metadata.thread_id"
  | "metadata.customer_id"
  | "metadata.labels";

/**
 * Slim column / Attributes-map read for a registry metric. Narrowed to
 * `SlimTraceMetricKey` so the exhaustive switch is enforced at compile time;
 * `buildSlimTimeseriesQuery` validates each metric before dispatch.
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
      // Mirrors the rollup's `total_processed_tokens` shape (rollup-timeseries-
      // query.ts:80) by summing the SAME four typed columns, not the Attributes-map
      // mirror — avoids per-row casts and insulates this metric from the trim
      // service's policy on `langwatch.reserved.*` keys.
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
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled slim group-by: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Group-bys whose expression resolves empty/NULL to an explicit `'unknown'`
 * bucket rather than `''`, mirroring legacy's `handlesUnknown: true` fields —
 * like legacy, these must NOT get a `HAVING group_key != ''` clause.
 */
function slimGroupByHandlesUnknown(groupBy?: string): boolean {
  return groupBy === "traces.trace_name";
}

// isPercentile + percentileFor are shared with eval-slim-timeseries-query.ts
// via ~/analytics/query-builders/_shared.

/**
 * Slim aggregation expression. Slim has typed columns, so percentiles use
 * `quantileExact` directly (matches the legacy builder's behaviour to keep
 * parity).
 */
function slimAggExpression(agg: AnalyticsAggregation, column: string): string {
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
 * Deduped FROM-clause for the slim table (IN-tuple dedup; see
 * clickhouse-queries.md). `TRACE_ANALYTICS_HAS_SIGNAL_SQL` keeps dimension-only
 * rows (a topic, annotation, no span) from counting as A TRACE by every aggregate.
 */
function dedupedSlim(alias: string, dateClause: string): string {
  return `(
    SELECT *
    FROM ${SLIM_TABLE}
    WHERE TenantId = {tenantId:String}
      AND ${TRACE_ANALYTICS_HAS_SIGNAL_SQL}
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
 * Translates the small slice of filter fields slim natively serves into a
 * WHERE fragment + params, throwing on an unhandled field as a guardrail
 * (anything else must have been rejected by `pickAnalyticsTable` already).
 */
function buildSlimFilterClauses(filters: AnalyticsTimeseriesBuilderInput["filters"]): {
  whereClause: string;
  params: Record<string, unknown>;
} {
  if (!filters) return { whereClause: "", params: {} };

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  let paramIdx = 0;
  const next = (prefix: string) => `slim_${prefix}_${paramIdx++}`;

  for (const [field, rawValue] of Object.entries(filters)) {
    if (!hasFilterValues(rawValue)) continue;
    appendSlimFilterClause({ field, rawValue, clauses, params, next });
  }

  const whereClause = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
  return { whereClause, params };
}

function appendSlimFilterClause({
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
      const wantsErrors = vals.includes("true");
      const wantsClean = vals.includes("false");
      if (wantsErrors && !wantsClean) {
        clauses.push(`${ta}.HasError = true`);
      } else if (wantsClean && !wantsErrors) {
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
      appendMetadataValueFilterClauses({
        attributes: `${ta}.Attributes`,
        rawValue,
        clauses,
        params,
        next,
      });
      break;
    }
    default:
      throw new Error(
        `Slim builder cannot serve filter "${field}". The router should have routed this to trace_summaries.`,
      );
  }
}

/**
 * Build a slim query for `trace_analytics`: SELECT period, [date],
 * [group_key], aggregated columns FROM the deduped table, filtered on
 * TenantId + OccurredAt range [+ slim filters], grouped/ordered by the same.
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
    selectExprs.push(`${dateTrunc(`${ta}.OccurredAt`, input.timeScale, timeZone)} AS date`);
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
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    const expr = slimAggExpression(s.aggregation, slimColumnFor(s.metric));
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");
  if (groupByColumn) groupByExprs.push("group_key");

  const { whereClause: filterWhere, params: filterParams } = buildSlimFilterClauses(input.filters);
  const { whereClause: excludeWhere, params: excludeParams } = buildSlimOriginExclusion(
    input.excludeOrigins,
  );

  // Mirror the legacy builder's `handlesUnknown` contract
  // (`aggregation-builder.ts` → `buildGroupKeyHavingClause`): a group-by whose
  // expression already folds empty/NULL into an explicit `'unknown'` bucket is
  // emitted WITHOUT a HAVING, so that bucket survives. Applying the blanket
  // `group_key != ''` to those would drop rows legacy keeps.
  const havingClause =
    groupByColumn && !slimGroupByHandlesUnknown(input.groupBy) ? `HAVING group_key != ''` : "";

  // Outer WHERE is wrapped in one enclosing paren: `dedupedSlim`'s own
  // tenant predicate sits one bracket deep already, so this OR (and any
  // filter clause) must nest deeper still to stay outside the tenant guard's
  // reach — see the matching note on `baseWhere` in aggregation-builder.mapper.ts.
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${dedupedSlim(ta, SLIM_DATE_FILTER_BOTH_PERIODS)}
    WHERE (${ta}.TenantId = {tenantId:String}
      AND (
        (${ta}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ta}.OccurredAt < {currentEnd:DateTime64(3)})
        OR
        (${ta}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ta}.OccurredAt < {previousEnd:DateTime64(3)})
      )
      ${filterWhere}
      ${excludeWhere})
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
      ...excludeParams,
    },
  };
}

/**
 * The caller's own origin exclusion, ANDed after the user's filters. It is not
 * one of them: a negated filter selection never inverts it.
 */
function buildSlimOriginExclusion(
  excludeOrigins: AnalyticsTimeseriesBuilderInput["excludeOrigins"],
): { whereClause: string; params: Record<string, unknown> } {
  if (!excludeOrigins || excludeOrigins.length === 0) {
    return { whereClause: "", params: {} };
  }
  return {
    whereClause: `AND ${ta}.Origin NOT IN ({slim_excludeOrigins:Array(String)})`,
    params: { slim_excludeOrigins: excludeOrigins },
  };
}
