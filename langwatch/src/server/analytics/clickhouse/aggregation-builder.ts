/**
 * Aggregation Builder - Builds complete ClickHouse queries for analytics.
 *
 * This module combines metric translations, filter translations, and grouping
 * into complete ClickHouse SQL queries.
 */

import type { AggregationTypes } from "../types";
import type { SeriesInputType } from "../registry";
import type { FilterField } from "../../filters/types";
import {
  type CHTable,
  buildJoinClause,
  tableAliases,
  TRACE_ANALYTICS_COLUMNS,
  extractReferencedSpanColumns,
  extractReferencedEvaluationColumns,
} from "./field-mappings";
import { snakeCase } from "../../../utils/stringCasing";
import {
  type MetricTranslation,
  translateMetric,
  translatePipelineAggregation,
} from "./metric-translator";
import {
  translateAllFilters,
  type FilterTranslation,
} from "./filter-translator";
import { createLogger } from "../../../utils/logger/server";

const logger = createLogger("langwatch:analytics:aggregation-builder");

/**
 * Resolve which columns a joined table needs based on the SQL expressions
 * that reference it.
 *
 * Returns a `ReadonlySet<string>` of column names to pass as
 * `requiredColumns` to `buildJoinClause`. This ensures each JOIN subquery
 * only SELECTs the columns actually used, avoiding expensive reads of
 * wide columns like SpanAttributes or Events arrays.
 */
function resolveRequiredColumns(
  table: CHTable,
  expressions: string[],
): ReadonlySet<string> | undefined {
  switch (table) {
    case "stored_spans":
      return extractReferencedSpanColumns(expressions);
    case "evaluation_runs":
      return extractReferencedEvaluationColumns(expressions);
    default:
      return undefined;
  }
}

/**
 * Returns a deduped FROM-clause expression for trace_summaries.
 *
 * trace_summaries uses ReplacingMergeTree(UpdatedAt) which can return
 * multiple versions of the same trace between merges. This wraps the table
 * in a subquery that keeps only the latest version per TraceId.
 *
 * The TenantId filter is pushed into the subquery so ClickHouse can prune
 * data early. All callers already bind `{tenantId:String}` in their params.
 *
 * @param alias - Table alias (e.g., "ts")
 * @param columns - Optional explicit column list. When omitted, selects all
 *   analytics columns (still excludes ComputedInput/ComputedOutput).
 */
function dedupedTraceSummaries(
  alias: string,
  columns?: readonly string[],
): string {
  const columnList = columns
    ? Array.from(columns).join(", ")
    : TRACE_ANALYTICS_COLUMNS.join(", ");
  return `(
    SELECT ${columnList} FROM trace_summaries
    WHERE TenantId = {tenantId:String}
    ORDER BY TraceId, UpdatedAt DESC
    LIMIT 1 BY TenantId, TraceId
  ) ${alias}`;
}

/** Maximum number of filter options returned by filter queries */
const MAX_FILTER_OPTIONS = 10000;

/**
 * Time interval constants for date truncation decisions.
 * WHY: These thresholds determine the optimal date grouping granularity
 * based on the query time range. Too fine granularity creates too many buckets,
 * too coarse loses detail.
 */
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR; // 1440
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 31; // Approximate, triggers month-level grouping

/**
 * Validate timezone string against IANA timezone database.
 * Falls back to UTC if invalid to prevent SQL injection.
 */
function validateTimeZone(timeZone: string): string {
  try {
    // Use Intl.DateTimeFormat to validate - it throws for invalid timezones
    Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Quote an identifier with backticks if it starts with a digit.
 * ClickHouse requires backticks for identifiers starting with numbers.
 */
function quoteIdentifier(identifier: string): string {
  if (/^\d/.test(identifier)) {
    return `\`${identifier}\``;
  }
  return identifier;
}

/**
 * Date grouping options
 */
export type DateGrouping =
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year"
  | "full";

/**
 * GroupBy field options
 */
export type GroupByField =
  | "metadata.user_id"
  | "metadata.thread_id"
  | "metadata.customer_id"
  | "metadata.labels"
  | "metadata.model"
  | "metadata.span_type"
  | "topics.topics"
  | "evaluations.evaluation_passed"
  | "evaluations.evaluation_label"
  | "evaluations.evaluation_processing_state"
  | "events.event_type"
  | "sentiment.thumbs_up_down"
  | "error.has_error";

/**
 * Result of resolving a groupBy field expression
 */
interface GroupByExpression {
  column: string;
  requiredJoins: CHTable[];
  usesArrayJoin?: boolean;
  handlesUnknown?: boolean;
}

/**
 * Registry of groupBy expression builders by field type.
 *
 * WHY REGISTRY PATTERN: Different groupBy fields require different SQL expressions
 * and may need JOINs to different tables. Some use arrayJoin for multi-valued fields.
 * The registry pattern centralizes this complexity and makes it easy to add new
 * groupBy options without modifying the main query builder.
 *
 * @param groupByKey - Optional key to filter results (e.g., specific evaluator ID)
 */
const groupByExpressions: Partial<
  Record<string, (groupByKey?: string) => GroupByExpression>
> = {
  "topics.topics": () => ({
    column: `${tableAliases.trace_summaries}.TopicId`,
    requiredJoins: [],
  }),

  "metadata.user_id": () => ({
    column: `${tableAliases.trace_summaries}.Attributes['langwatch.user_id']`,
    requiredJoins: [],
  }),

  "metadata.thread_id": () => ({
    column: `${tableAliases.trace_summaries}.Attributes['gen_ai.conversation.id']`,
    requiredJoins: [],
  }),

  "metadata.customer_id": () => ({
    column: `${tableAliases.trace_summaries}.Attributes['langwatch.customer_id']`,
    requiredJoins: [],
  }),

  "metadata.labels": () => ({
    column: `arrayJoin(JSONExtract(${tableAliases.trace_summaries}.Attributes['langwatch.labels'], 'Array(String)'))`,
    requiredJoins: [],
    usesArrayJoin: true,
  }),

  // Use trace-level Models array instead of span-level model to avoid
  // double-counting trace metrics. When joining stored_spans, non-LLM spans
  // (without a model) would create "unknown" entries that duplicate the
  // trace's TotalPromptTokenCount/TotalCost across model groups.
  // trace_summaries.Models only contains actual LLM models, matching ES behavior.
  "metadata.model": () => ({
    column: `arrayJoin(if(empty(${tableAliases.trace_summaries}.Models), ['unknown'], ${tableAliases.trace_summaries}.Models))`,
    requiredJoins: [],
    usesArrayJoin: true,
    handlesUnknown: true,
  }),

  "metadata.span_type": () => ({
    column: `if(
      ${tableAliases.stored_spans}.SpanAttributes['langwatch.span.type'] = '' OR
      ${tableAliases.stored_spans}.SpanAttributes['langwatch.span.type'] IS NULL,
      'unknown',
      ${tableAliases.stored_spans}.SpanAttributes['langwatch.span.type']
    )`,
    requiredJoins: ["stored_spans"],
    handlesUnknown: true,
  }),

  "evaluations.evaluation_passed": (groupByKey) => ({
    column: groupByKey
      ? `CASE
        WHEN ${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed' AND ${tableAliases.evaluation_runs}.Passed IS NOT NULL AND ${tableAliases.evaluation_runs}.Passed = 1 THEN 'passed'
        WHEN ${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed' AND ${tableAliases.evaluation_runs}.Passed IS NOT NULL AND ${tableAliases.evaluation_runs}.Passed = 0 THEN 'failed'
        ELSE NULL
      END`
      : `CASE
      WHEN ${tableAliases.evaluation_runs}.Passed = 1 THEN 'passed'
      WHEN ${tableAliases.evaluation_runs}.Passed = 0 THEN 'failed'
      ELSE 'unknown'
    END`,
    requiredJoins: ["evaluation_runs"],
    handlesUnknown: true,
  }),

  "evaluations.evaluation_label": (groupByKey) => ({
    column: groupByKey
      ? `if(${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed', ${tableAliases.evaluation_runs}.Label, '')`
      : `${tableAliases.evaluation_runs}.Label`,
    requiredJoins: ["evaluation_runs"],
  }),

  "evaluations.evaluation_processing_state": () => ({
    column: `${tableAliases.evaluation_runs}.Status`,
    requiredJoins: ["evaluation_runs"],
  }),

  "events.event_type": () => ({
    column: `arrayJoin(${tableAliases.stored_spans}."Events.Name")`,
    requiredJoins: ["stored_spans"],
    usesArrayJoin: true,
  }),

  "sentiment.thumbs_up_down": () => ({
    // Extract the vote value from Events.Attributes where event name is 'thumbs_up_down'
    // and convert to 'thumbs_up' (vote=1) or 'thumbs_down' (vote=-1)
    // Events.Name and Events.Attributes are parallel arrays, so we zip them to filter
    column: `arrayJoin(
      arrayMap(
        a -> multiIf(
          toInt32OrNull(a['event.metrics.vote']) = 1, 'Thumbs Up',
          toInt32OrNull(a['event.metrics.vote']) = -1, 'Thumbs Down',
          ''
        ),
        arrayFilter(
          (a, n) -> n = 'thumbs_up_down' AND mapContains(a, 'event.metrics.vote'),
          ${tableAliases.stored_spans}."Events.Attributes",
          ${tableAliases.stored_spans}."Events.Name"
        )
      )
    )`,
    requiredJoins: ["stored_spans"] as CHTable[],
    usesArrayJoin: true,
  }),

  "error.has_error": () => ({
    column: `if(${tableAliases.stored_spans}.StatusCode = 2, 'with error', 'without error')`,
    requiredJoins: ["stored_spans"],
  }),
};

/**
 * Query input for building a timeseries query
 */
export interface TimeseriesQueryInput {
  projectId: string;
  startDate: Date;
  endDate: Date;
  previousPeriodStartDate: Date;
  series: SeriesInputType[];
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >;
  groupBy?: string;
  groupByKey?: string;
  timeScale?: number | "full";
  timeZone?: string;
}

/**
 * Built query result
 */
export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Build the HAVING clause for group_key filtering.
 *
 * Different groupBy fields produce different sentinel values for non-matching rows:
 * - evaluation_label with groupByKey: returns '' → filter with != ''
 * - evaluation_passed with groupByKey: returns NULL → filter with IS NOT NULL
 * - Fields with handlesUnknown=true: already handle empty/null internally → no HAVING
 * - No groupBy: no HAVING needed
 */
function buildGroupKeyHavingClause({
  groupByColumn,
  groupByHandlesUnknown,
  groupBy,
  groupByKey,
}: {
  groupByColumn: string | null;
  groupByHandlesUnknown: boolean;
  groupBy?: string;
  groupByKey?: string;
}): string {
  if (!groupByColumn) return "";
  const hasGroupByKey = !!groupByKey;
  const isEvaluationPassed = groupBy === "evaluations.evaluation_passed";
  if (isEvaluationPassed && hasGroupByKey) return "HAVING group_key IS NOT NULL";
  if (!groupByHandlesUnknown && !isEvaluationPassed) return "HAVING group_key != ''";
  return "";
}

/**
 * Get the ClickHouse date truncation function for a time scale.
 *
 * WHY: Different time ranges require different grouping granularities.
 * Short ranges (hours) need minute-level precision for detail.
 * Medium ranges (days) use hourly buckets to avoid too many data points.
 * Long ranges (weeks/months) use day/week/month buckets for performance.
 */
function getDateTruncFunction(
  timeScaleMinutes: number,
  timeZone: string,
): string {
  // Validate timezone to prevent SQL injection
  const validatedTimeZone = validateTimeZone(timeZone);

  // Convert minutes to appropriate interval
  if (timeScaleMinutes <= 1) {
    return `toStartOfMinute(ts.OccurredAt, '${validatedTimeZone}')`;
  } else if (timeScaleMinutes < MINUTES_PER_DAY) {
    // Use HOUR interval only when timeScaleMinutes is an exact multiple of 60
    // Otherwise use MINUTE interval to preserve precision (e.g., 90 minutes)
    if (timeScaleMinutes % MINUTES_PER_HOUR === 0) {
      const hours = timeScaleMinutes / MINUTES_PER_HOUR;
      return `toStartOfInterval(ts.OccurredAt, INTERVAL ${hours} HOUR, '${validatedTimeZone}')`;
    }
    return `toStartOfInterval(ts.OccurredAt, INTERVAL ${timeScaleMinutes} MINUTE, '${validatedTimeZone}')`;
  } else {
    // Days
    const days = Math.floor(timeScaleMinutes / MINUTES_PER_DAY);
    if (days === 1) {
      return `toStartOfDay(ts.OccurredAt, '${validatedTimeZone}')`;
    } else if (days <= DAYS_PER_WEEK) {
      return `toStartOfInterval(ts.OccurredAt, INTERVAL ${days} DAY, '${validatedTimeZone}')`;
    } else if (days <= DAYS_PER_MONTH) {
      return `toStartOfWeek(ts.OccurredAt, 1, '${validatedTimeZone}')`;
    } else {
      return `toStartOfMonth(ts.OccurredAt, '${validatedTimeZone}')`;
    }
  }
}

/**
 * Default fallback groupBy expression (by TraceId)
 */
const defaultGroupByExpression: GroupByExpression = {
  column: `${tableAliases.trace_summaries}.TraceId`,
  requiredJoins: [],
};

/**
 * Get the groupBy column expression for a group field.
 *
 * Uses registry lookup instead of switch statement for better extensibility.
 * When adding new groupBy fields, simply add an entry to groupByExpressions.
 *
 * @param groupBy - The field to group by
 * @param groupByKey - Optional key to filter results (e.g., specific evaluator ID)
 */
function getGroupByExpression(
  groupBy: string,
  groupByKey?: string,
): GroupByExpression {
  const builder = groupByExpressions[groupBy];
  return builder ? builder(groupByKey) : defaultGroupByExpression;
}

/**
 * Build the complete timeseries query.
 *
 * WHY SINGLE QUERY FOR BOTH PERIODS: Instead of running separate queries for
 * current and previous periods, we include both in a single query using a
 * CASE expression to tag rows by period. This halves the number of ClickHouse
 * round trips and allows the database to optimize the scan across both date ranges.
 */
export function buildTimeseriesQuery(input: TimeseriesQueryInput): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const timeZone = input.timeZone ?? "UTC";

  // Collect all required JOINs and metric expressions
  const allJoins = new Set<CHTable>();
  const metricTranslations: MetricTranslation[] = [];

  // Translate each series metric
  for (let i = 0; i < input.series.length; i++) {
    const series = input.series[i]!;
    let translation: MetricTranslation;

    if (series.pipeline) {
      translation = translatePipelineAggregation(
        series.metric,
        series.aggregation,
        series.pipeline.field,
        series.pipeline.aggregation,
        i,
        series.key,
        series.subkey,
      );
    } else {
      translation = translateMetric(
        series.metric,
        series.aggregation,
        i,
        series.key,
        series.subkey,
      );
    }

    metricTranslations.push(translation);
    for (const join of translation.requiredJoins) {
      allJoins.add(join);
    }
  }

  // Translate filters
  const filterTranslation = translateAllFilters(input.filters ?? {});
  for (const join of filterTranslation.requiredJoins) {
    allJoins.add(join);
  }

  // Collect all params from metric translations and filter translations
  const metricParams = metricTranslations.reduce(
    (acc, m) => ({ ...acc, ...m.params }),
    {} as Record<string, unknown>,
  );
  const allTranslationParams = {
    ...filterTranslation.params,
    ...metricParams,
  };

  // Handle groupBy
  let groupByColumn: string | null = null;
  let usesArrayJoin = false;
  let groupByHandlesUnknown = false;
  let groupByRequiresSpans = false;
  if (input.groupBy) {
    const groupByExpr = getGroupByExpression(input.groupBy, input.groupByKey);
    groupByColumn = groupByExpr.column;
    usesArrayJoin = groupByExpr.usesArrayJoin ?? false;
    groupByHandlesUnknown = groupByExpr.handlesUnknown ?? false;
    groupByRequiresSpans = groupByExpr.requiredJoins.includes("stored_spans");
    for (const join of groupByExpr.requiredJoins) {
      allJoins.add(join);
    }
  }

  // Build JOIN clauses with column pruning.
  // Collect all SQL expressions that reference columns from joined tables
  // so we only SELECT the columns actually needed in each JOIN subquery.
  const allExpressions = [
    ...metricTranslations.map((m) => m.selectExpression),
    filterTranslation.whereClause,
    groupByColumn ?? "",
  ];
  const joinClauses = Array.from(allJoins)
    .map((table) => {
      const requiredColumns = resolveRequiredColumns(table, allExpressions);
      return buildJoinClause(table, requiredColumns);
    })
    .join("\n");

  // Build WHERE clause
  const baseWhere = `
    ${ts}.TenantId = {tenantId:String}
    AND (
      (${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)})
      OR
      (${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)})
    )
  `;

  let filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";

  // When using arrayJoin for grouping (like labels) or span-level groupBy (like model),
  // we need a CTE approach to avoid trace duplication affecting counts. The CTE deduplicates
  // (TraceId, group_key) pairs and preserves metrics per trace for accurate aggregation.
  // Without this, joining stored_spans causes each trace to be counted once per span.
  if ((usesArrayJoin || groupByRequiresSpans) && groupByColumn) {
    return buildArrayJoinTimeseriesQuery(
      input,
      groupByColumn,
      groupByHandlesUnknown,
      metricTranslations,
      joinClauses,
      baseWhere,
      filterWhere,
      allTranslationParams,
      timeZone,
    );
  }

  // Separate simple and subquery metrics
  const simpleMetrics = metricTranslations.filter((m) => !m.requiresSubquery);
  const subqueryMetrics = metricTranslations.filter((m) => m.requiresSubquery);

  // @regression issue #3088: when trace-level metrics (e.g. sum(ts.TotalCost))
  // are mixed with evaluation metrics in the same query, the evaluation_runs
  // JOIN fans out each trace into N rows (one per evaluation run on that trace).
  // Aggregating trace-level columns over the fanned-out rows inflates them by N.
  //
  // Fix: wrap the scan in a per-trace CTE that pre-aggregates evaluation metrics
  // at trace granularity. The outer query then aggregates trace-level columns
  // without duplication and re-aggregates the per-trace eval values across traces.
  //
  // This check MUST run before the `timeScale === "full"` branch below —
  // otherwise summary widgets (timeScale: "full") mixing eval + trace metrics
  // would route through buildSubqueryTimeseriesQuery which still joins
  // evaluation_runs directly and reproduces the fan-out bug.
  //
  // Guard: only fire when there are NO pipeline (subquery) metrics. Pipeline
  // metrics live in `subqueryMetrics` which `buildMixedEvalTimeseriesQuery`
  // does not receive — routing here would silently drop them.
  if (subqueryMetrics.length === 0 && hasEvalMixedWithTraceMetrics(simpleMetrics)) {
    return buildMixedEvalTimeseriesQuery({
      input,
      ts,
      simpleMetrics,
      groupByColumn,
      groupByHandlesUnknown,
      joinClauses,
      baseWhere,
      filterWhere,
      allTranslationParams,
      timeZone,
    });
  }

  // For timeScale "full" (summary queries) without groupBy, use CTE-based query to ensure
  // both current and previous periods return data (even if one is empty).
  // When groupBy is present, fall through to the standard query path which correctly
  // handles GROUP BY group_key — the CTE path doesn't support grouped results.
  if (input.timeScale === "full" && !groupByColumn) {
    return buildSubqueryTimeseriesQuery(
      input,
      simpleMetrics,
      subqueryMetrics,
      joinClauses,
      baseWhere,
      filterWhere,
      allTranslationParams,
      groupByColumn,
      groupByHandlesUnknown,
    );
  }

  // Pipeline metrics with numeric timeScale: use date-bucketed two-level aggregation
  if (subqueryMetrics.length > 0 && typeof input.timeScale === "number") {
    return buildDateBucketedPipelineQuery({
      input,
      simpleMetrics,
      pipelineMetrics: subqueryMetrics,
      groupByColumn,
      groupByHandlesUnknown,
      joinClauses,
      baseWhere,
      filterWhere,
      filterParams: allTranslationParams,
      timeZone,
    });
  }

  // Build SELECT expressions for standard query
  const selectExprs: string[] = [];

  // Add period indicator
  selectExprs.push(`
    CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period
  `);

  // Add date grouping (timeScale "full" already handled above via CTE query)
  if (typeof input.timeScale === "number") {
    const dateTrunc = getDateTruncFunction(input.timeScale, timeZone);
    selectExprs.push(`${dateTrunc} AS date`);
  }

  // Add groupBy column if present
  // - If handlesUnknown is true, the column expression already handles NULL/empty -> 'unknown'
  // - Otherwise, exclude empty strings via HAVING (ES terms excludes them)
  if (groupByColumn) {
    if (groupByHandlesUnknown) {
      // Column already handles 'unknown' conversion, just use as group_key
      selectExprs.push(`${groupByColumn} AS group_key`);
    } else {
      // Convert NULL to 'unknown' for ES `missing: "unknown"` behavior
      selectExprs.push(
        `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`,
      );
    }
  }

  // Add metric expressions
  for (const metric of simpleMetrics) {
    selectExprs.push(metric.selectExpression);
  }

  // Build GROUP BY
  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") {
    groupByExprs.push("date");
  }
  if (groupByColumn) {
    groupByExprs.push("group_key");
  }

  const havingClause = buildGroupKeyHavingClause({
    groupByColumn,
    groupByHandlesUnknown,
    groupBy: input.groupBy,
    groupByKey: input.groupByKey,
  });

  // Build the complete SQL
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${dedupedTraceSummaries(ts)}
    ${joinClauses}
    WHERE ${baseWhere}
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
      ...allTranslationParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build a timeseries query for the standard (non-arrayJoin) path that mixes
 * trace-level metrics with evaluation metrics.
 *
 * @regression issue #3088 — the naive join between trace_summaries and
 * evaluation_runs fans out each trace into N rows (one per evaluation run),
 * which inflates trace-level aggregations (sum/avg of TotalCost etc.) by N.
 *
 * This function wraps the scan in a `per_trace_metrics` CTE that pre-aggregates
 * at `(period, date[, group_key], TraceId)` granularity: trace-level columns
 * are collapsed with `any()` and evaluation metrics are computed as per-trace
 * conditional aggregations. The outer query then re-aggregates across traces
 * using the outer aggregation mapped from the conditional aggregation.
 */
function buildMixedEvalTimeseriesQuery({
  input,
  ts,
  simpleMetrics,
  groupByColumn,
  groupByHandlesUnknown,
  joinClauses,
  baseWhere,
  filterWhere,
  allTranslationParams,
  timeZone,
}: {
  input: TimeseriesQueryInput;
  ts: string;
  simpleMetrics: MetricTranslation[];
  groupByColumn: string | null;
  groupByHandlesUnknown: boolean;
  joinClauses: string;
  baseWhere: string;
  filterWhere: string;
  allTranslationParams: Record<string, unknown>;
  timeZone: string;
}): BuiltQuery {
  const dateTrunc =
    typeof input.timeScale === "number"
      ? getDateTruncFunction(input.timeScale, timeZone)
      : null;

  const groupKeyExpr = groupByColumn
    ? groupByHandlesUnknown
      ? `${groupByColumn} AS group_key`
      : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`
    : null;

  // Inner CTE: per-trace granularity. Trace-level columns are collapsed with
  // `any()` since they're constant per TraceId. Eval metrics keep their full
  // conditional aggregation expression — but now evaluated per trace.
  const innerSelectExprs: string[] = [
    `${ts}.TraceId AS trace_id`,
    `CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period`,
  ];
  if (dateTrunc) {
    innerSelectExprs.push(`${dateTrunc} AS date`);
  }
  if (groupKeyExpr) {
    innerSelectExprs.push(groupKeyExpr);
  }

  // Per-metric plan for the outer SELECT. Each simple metric gets a column
  // in the inner CTE and a corresponding re-aggregation in the outer SELECT.
  //
  //   Eval metric: inner emits the full conditional aggregation per trace;
  //                outer re-aggregates across traces via mapEvalAggregationToOuter.
  //   Trace metric: inner emits `any(<underlying column>)` per trace; outer
  //                 applies the original aggregation to the per-trace column,
  //                 preserving coalesce/quantile wrappers by substituting the
  //                 column reference in the original expression.
  //
  // Per-trace aliases start with the metric index digit (e.g. `0__…`), so we
  // wrap them in `quoteIdentifier` to satisfy ClickHouse's identifier rules.
  const outerMetricExprs: string[] = [];
  for (const metric of simpleMetrics) {
    const perTraceAlias = quoteIdentifier(`${metric.alias}__per_trace`);
    const quotedAlias = quoteIdentifier(metric.alias);
    const exprWithoutAlias = stripSelectExpressionAlias(
      metric.selectExpression,
      metric.alias,
    );

    if (metric.requiredJoins.includes("evaluation_runs")) {
      innerSelectExprs.push(`${exprWithoutAlias} AS ${perTraceAlias}`);
      const outerAgg = mapEvalAggregationToOuter(metric.selectExpression);
      if (!outerAgg) {
        throw new Error(
          `Cannot map evaluation metric aggregation to outer aggregation for expression: "${metric.selectExpression}". ` +
            `This likely means metric-translator.ts emits a conditional aggregation pattern that mapEvalAggregationToOuter doesn't yet handle. ` +
            `Update AGGREGATION_PATTERNS in mapEvalAggregationToOuter to add the new mapping.`,
        );
      }
      outerMetricExprs.push(`${outerAgg}(${perTraceAlias}) AS ${quotedAlias}`);
      continue;
    }

    // Count-like metrics: in a per-trace CTE each trace is one row, so
    // count() / count(*) becomes sum(1) across traces = count(distinct traces).
    if (/\bcount\s*\(\s*\*?\s*\)/.test(exprWithoutAlias)) {
      innerSelectExprs.push(`1 AS ${perTraceAlias}`);
      outerMetricExprs.push(`sum(${perTraceAlias}) AS ${quotedAlias}`);
      continue;
    }

    // uniq/uniqExact of TraceId — same as count: 1 per trace row.
    if (
      (/\buniq\s*\(/.test(exprWithoutAlias) ||
        /\buniqExact\s*\(/.test(exprWithoutAlias)) &&
      exprWithoutAlias.includes("TraceId")
    ) {
      innerSelectExprs.push(`1 AS ${perTraceAlias}`);
      outerMetricExprs.push(`sum(${perTraceAlias}) AS ${quotedAlias}`);
      continue;
    }

    // Trace metric. Find the underlying column reference, wrap it in any()
    // inside the CTE, then re-aggregate across traces outside by substituting
    // the column reference with the per-trace alias in the original expression.
    const column = extractTraceAggregationColumn(exprWithoutAlias);
    if (!column) {
      // Fail loud: without a unique source column we cannot dedupe per-trace.
      // A silent fallback (e.g. any(uniqIf(...))) produces invalid nested
      // aggregations and silently-wrong metric values. Throwing forces any
      // new trace-metric shape to be handled explicitly in
      // extractTraceAggregationColumn rather than corrupting query results.
      throw new Error(
        `Cannot identify source column in trace metric expression for per-trace CTE: "${exprWithoutAlias}". ` +
          `This likely means a new trace metric shape is not handled by extractTraceAggregationColumn.`,
      );
    }
    innerSelectExprs.push(`any(${column}) AS ${perTraceAlias}`);
    const outerExpr = replaceColumnWithAlias(
      exprWithoutAlias,
      column,
      perTraceAlias,
    );
    outerMetricExprs.push(`${outerExpr} AS ${quotedAlias}`);
  }

  const innerGroupBy: string[] = ["trace_id", "period"];
  if (dateTrunc) innerGroupBy.push("date");
  if (groupKeyExpr) innerGroupBy.push("group_key");

  // Outer SELECT: re-aggregate across traces.
  const outerSelectExprs: string[] = ["period"];
  if (dateTrunc) outerSelectExprs.push("date");
  if (groupKeyExpr) outerSelectExprs.push("group_key");
  outerSelectExprs.push(...outerMetricExprs);

  const outerGroupBy: string[] = ["period"];
  if (dateTrunc) outerGroupBy.push("date");
  if (groupKeyExpr) outerGroupBy.push("group_key");

  const havingClause = buildGroupKeyHavingClause({
    groupByColumn,
    groupByHandlesUnknown,
    groupBy: input.groupBy,
    groupByKey: input.groupByKey,
  });

  // For timeScale "full" without groupBy, split into per-period CTEs with UNION ALL
  // to guarantee both 'current' and 'previous' rows always appear (even when one
  // period has no data). This matches the pattern used by buildSubqueryTimeseriesQuery.
  if (input.timeScale === "full" && !groupByColumn) {
    // Build inner SELECT without the period CASE — each CTE covers one period.
    const periodInnerExprs = innerSelectExprs.filter(
      (expr) => !expr.includes("AS period"),
    );
    const periodInnerGroupBy = innerGroupBy.filter((col) => col !== "period");

    const buildPeriodCte = (
      cteName: string,
      startParam: string,
      endParam: string,
    ): string => `
      ${cteName} AS (
        SELECT
          ${periodInnerExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts)}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {${startParam}:DateTime64(3)} AND ${ts}.OccurredAt < {${endParam}:DateTime64(3)}
          ${filterWhere}
        GROUP BY ${periodInnerGroupBy.join(", ")}
      )`;

    // Outer metric exprs only (no period/date/group_key — those are handled separately).
    const outerMetricOnly = outerMetricExprs.join(", ");

    const sql = `
      WITH
        ${buildPeriodCte("per_trace_metrics_current", "currentStart", "currentEnd")},
        ${buildPeriodCte("per_trace_metrics_previous", "previousStart", "previousEnd")}
      SELECT 'current' AS period, ${outerMetricOnly} FROM per_trace_metrics_current
      UNION ALL
      SELECT 'previous' AS period, ${outerMetricOnly} FROM per_trace_metrics_previous
    `;

    return {
      sql,
      params: {
        tenantId: input.projectId,
        currentStart: input.startDate,
        currentEnd: input.endDate,
        previousStart: input.previousPeriodStartDate,
        previousEnd: input.startDate,
        ...allTranslationParams,
        ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
      },
    };
  }

  const sql = `
    WITH per_trace_metrics AS (
      SELECT
        ${innerSelectExprs.join(",\n        ")}
      FROM ${dedupedTraceSummaries(ts)}
      ${joinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
      GROUP BY ${innerGroupBy.join(", ")}
    )
    SELECT
      ${outerSelectExprs.join(",\n      ")}
    FROM per_trace_metrics
    WHERE period IS NOT NULL
    GROUP BY ${outerGroupBy.join(", ")}
    ${havingClause}
    ORDER BY period${dateTrunc ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...allTranslationParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * True when the query mixes evaluation metrics (which fan out via the
 * evaluation_runs JOIN) with non-evaluation metrics whose aggregations would
 * be inflated by that fan-out. Gates the per-trace CTE path that fixes
 * issue #3088.
 */
function hasEvalMixedWithTraceMetrics(
  metrics: readonly MetricTranslation[],
): boolean {
  const hasEval = metrics.some((m) =>
    m.requiredJoins.includes("evaluation_runs"),
  );
  const hasNonEval = metrics.some(
    (m) => !m.requiredJoins.includes("evaluation_runs"),
  );
  return hasEval && hasNonEval;
}

/**
 * Extract the underlying column reference from a trace-level metric expression.
 *
 * Handles common shapes produced by `translateSimpleAggregation` and related
 * helpers in `metric-translator.ts`:
 *   - `coalesce(sum(ts.TotalCost), 0)` -> `ts.TotalCost`
 *   - `sum(ts.TotalCost)` -> `ts.TotalCost`
 *   - `quantileExact(0.5)(ts.TotalDurationMs)` -> `ts.TotalDurationMs`
 *   - `uniq(ts.TraceId)` -> `ts.TraceId`
 *   - `uniqIf(ts.Attributes['langwatch.user_id'], ...)` -> `ts.Attributes['langwatch.user_id']`
 *
 * Returns `null` when no single column reference can be unambiguously extracted
 * (e.g. expressions with arithmetic or multiple column references). Callers
 * must treat `null` as a programmer error — the mixed eval/trace CTE cannot
 * produce correct SQL without a unique source column to collapse per trace.
 */
function extractTraceAggregationColumn(expression: string): string | null {
  // 1. Prefer a bracketed map-access column like `ts.Attributes['langwatch.user_id']`
  //    or `ts.Attributes["langwatch.user_id"]`. ClickHouse accepts both quote
  //    styles. Map keys can contain arbitrary characters except the matching
  //    quote, so we match non-greedily to the closing quote + bracket.
  const bracketedPattern =
    /[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\[(?:'[^']*'|"[^"]*")\]/g;
  const bracketedMatches = expression.match(bracketedPattern);
  if (bracketedMatches && bracketedMatches.length > 0) {
    return bracketedMatches[bracketedMatches.length - 1] ?? null;
  }

  // 2. Fall back to `<alias>.<column>` or `<alias>."Quoted.Column"`.
  //    Trace metrics produced by `translateSimpleAggregation` always contain
  //    exactly one such reference, so this is unambiguous.
  const columnPattern =
    /[a-zA-Z_][a-zA-Z0-9_]*\.(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/g;
  const matches = expression.match(columnPattern);
  if (!matches || matches.length === 0) return null;
  // Return the last (innermost) match to skip function-like identifiers.
  return matches[matches.length - 1] ?? null;
}

/**
 * Replace all occurrences of a column reference in an expression with a new
 * alias. Used to rewrite the outer SELECT of a mixed eval/trace query so that
 * the original aggregation (including wrappers like `coalesce(..., 0)`) applies
 * to the per-trace column instead of the raw column.
 *
 * The boundary check uses `(?<![\w.])` / `(?![\w.])` rather than `\b` because
 * `\b` treats `.` as a word boundary, which would incorrectly match `ts.Total`
 * inside `ts.TotalCost`. For bracketed expressions like
 * `ts.Attributes['langwatch.user_id']` the closing `]` is followed by `,`/`)`
 * which satisfies the lookahead.
 */
function replaceColumnWithAlias(
  expression: string,
  column: string,
  alias: string,
): string {
  // Escape regex metacharacters in the column reference before replacing.
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Anchor with negative lookbehind/lookahead so `ts.TotalCost` does not match
  // inside `ts.TotalCostRatio`, and `ts.Attributes['x']` does not match inside
  // some hypothetical `ats.Attributes['x']`.
  return expression.replace(
    new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`, "g"),
    alias,
  );
}

/**
 * Build a timeseries query using CTE for arrayJoin grouping (labels, events)
 * or span-level grouping (model, span_type).
 * This prevents trace duplication from affecting aggregate counts.
 */
function buildArrayJoinTimeseriesQuery(
  input: TimeseriesQueryInput,
  groupByColumn: string,
  groupByHandlesUnknown: boolean,
  metricTranslations: MetricTranslation[],
  joinClauses: string,
  baseWhere: string,
  filterWhere: string,
  filterParams: Record<string, unknown>,
  timeZone: string,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;

  // Build date truncation for CTE
  const dateTrunc =
    input.timeScale !== "full" && typeof input.timeScale === "number"
      ? getDateTruncFunction(input.timeScale, timeZone)
      : null;

  // CTE: Get distinct (TraceId, group_key) pairs with per-trace metrics
  // This ensures each trace is counted once per group key value
  // If groupByColumn already handles 'unknown' conversion (like model, span_type),
  // just use it directly. Otherwise, wrap with if(...IS NULL, 'unknown', ...).
  const groupKeyExpr = groupByHandlesUnknown
    ? `${groupByColumn} AS group_key`
    : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`;

  const periodCaseExpr = `CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END`;

  // Separate eval and non-eval metrics so we can pre-aggregate evaluation metrics
  // at trace granularity inside the CTE. Without this, the evaluation_runs JOIN
  // fans out each trace into N rows (one per evaluation run), and the raw
  // `es.Passed` / `es.Score` expressions leak into the outer SELECT where the
  // `es` alias no longer exists.
  //
  // @regression issue #3088
  const simpleMetrics = metricTranslations.filter((m) => !m.requiresSubquery);

  // Pipeline metrics that group by trace_id are redundant in the arrayJoin path
  // because the CTE already deduplicates by (trace_id, group_key). Re-translate
  // them as simple metrics so they participate in the outer SELECT instead of
  // being silently dropped.
  for (let i = 0; i < input.series.length; i++) {
    const series = input.series[i]!;
    const translation = metricTranslations[i]!;
    if (!translation.requiresSubquery || !series.pipeline) continue;

    if (series.pipeline.field === "trace_id") {
      const innerTranslation = translateMetric(
        series.metric,
        series.aggregation,
        i,
        series.key,
        series.subkey,
      );
      simpleMetrics.push({
        ...innerTranslation,
        alias: translation.alias,
        selectExpression: innerTranslation.selectExpression.replace(
          new RegExp(
            ` AS ${innerTranslation.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          ),
          ` AS ${translation.alias}`,
        ),
      });
    }
  }
  const hasEvalMixWithTrace = hasEvalMixedWithTraceMetrics(simpleMetrics);

  // When eval metrics are mixed with trace metrics, switch from SELECT DISTINCT
  // (which cannot dedupe the eval fan-out because eval columns differ per row)
  // to GROUP BY trace_id, group_key, period [, date], wrapping trace-level columns
  // in any() and computing eval metrics as per-trace aggregates. The outer query
  // then re-aggregates the per-trace eval values via mapEvalAggregationToOuter().

  const cteSelectExprs: string[] = [
    `${ts}.TraceId AS trace_id`,
    groupKeyExpr,
    `${periodCaseExpr} AS period`,
  ];

  if (dateTrunc) {
    cteSelectExprs.push(`${dateTrunc} AS date`);
  }

  // Include metric base columns in CTE for aggregation in outer query.
  // When using the grouped CTE, wrap trace-level columns in any() since they
  // are constant per (trace_id, group_key) combination.
  const traceColumnWrapper = (col: string) =>
    hasEvalMixWithTrace ? `any(${col})` : col;
  // IMPORTANT: When adding a new trace-level column to metric-translator.ts, it
  // MUST also be added to this CTE select list AND to DEDUP_FIELD_MAPPINGS
  // (consumed by transformMetricForDedup below). The simple-path
  // buildMixedEvalTimeseriesQuery uses dynamic column extraction via
  // extractTraceAggregationColumn, but this arrayJoin path still uses the
  // hard-coded approach. Missing the update here will make the new column
  // silently return null (or throw) when combined with an arrayJoin groupBy.
  // TODO(#3115): port this path to extractTraceAggregationColumn for parity.
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TotalCost`)} AS trace_total_cost`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TotalDurationMs`)} AS trace_duration_ms`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TotalPromptTokenCount`)} AS trace_prompt_tokens`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TotalCompletionTokenCount`)} AS trace_completion_tokens`,
  );

  // When pre-aggregating eval metrics per-trace, emit each eval metric's full
  // expression (without its alias) as a `<alias>__per_trace` column inside the
  // CTE. In the outer query, we'll wrap this per-trace column in the cross-trace
  // aggregation returned by mapEvalAggregationToOuter().
  //
  // Per-trace aliases are quoted because they start with the metric index digit.
  const evalPerTraceAliases = new Map<string, string>();
  if (hasEvalMixWithTrace) {
    for (const metric of simpleMetrics) {
      if (!metric.requiredJoins.includes("evaluation_runs")) continue;
      const perTraceAlias = quoteIdentifier(`${metric.alias}__per_trace`);
      const exprWithoutAlias = stripSelectExpressionAlias(
        metric.selectExpression,
        metric.alias,
      );
      cteSelectExprs.push(`${exprWithoutAlias} AS ${perTraceAlias}`);
      evalPerTraceAliases.set(metric.alias, perTraceAlias);
    }
  }

  // Include evaluation columns in CTE when evaluation metrics are used.
  // When hasEvalMixWithTrace is true the CTE uses GROUP BY (not SELECT DISTINCT),
  // so non-grouped columns must be wrapped in any(). The raw eval columns are
  // only consumed by the non-mixed transformMetricForDedup path, but wrapping
  // them keeps the CTE valid for both modes.
  const es = tableAliases.evaluation_runs;
  const metricExprs = simpleMetrics.map((m) => m.selectExpression);
  const referencedEvalCols = extractReferencedEvaluationColumns(metricExprs);
  for (const col of referencedEvalCols) {
    const colExpr = `${es}.${col}`;
    cteSelectExprs.push(
      `${hasEvalMixWithTrace ? `any(${colExpr})` : colExpr} AS eval_${snakeCase(col)}`,
    );
  }

  // Build outer SELECT expressions
  const outerSelectExprs: string[] = ["period"];
  if (dateTrunc) {
    outerSelectExprs.push("date");
  }
  outerSelectExprs.push("group_key");

  // Transform metrics to work on deduplicated data
  // count() becomes uniqExact(trace_id), sum/avg work on first value per trace
  for (const metric of simpleMetrics) {
    const perTraceAlias = evalPerTraceAliases.get(metric.alias);
    if (perTraceAlias !== undefined) {
      // Eval metric: outer query re-aggregates the per-trace value across traces.
      const outerAgg = mapEvalAggregationToOuter(metric.selectExpression);
      if (!outerAgg) {
        throw new Error(
          `Cannot map evaluation metric aggregation to outer aggregation for expression: "${metric.selectExpression}". ` +
            `This likely means metric-translator.ts emits a conditional aggregation pattern that mapEvalAggregationToOuter doesn't yet handle. ` +
            `Update AGGREGATION_PATTERNS in mapEvalAggregationToOuter to add the new mapping.`,
        );
      }
      outerSelectExprs.push(
        `${outerAgg}(${perTraceAlias}) AS ${quoteIdentifier(metric.alias)}`,
      );
      continue;
    }
    // Transform the metric expression for the deduplicated context
    const transformedExpr = transformMetricForDedup(
      metric.selectExpression,
      metric.alias,
    );
    outerSelectExprs.push(transformedExpr);
  }

  // Build GROUP BY for outer query
  const outerGroupBy: string[] = ["period"];
  if (dateTrunc) {
    outerGroupBy.push("date");
  }
  outerGroupBy.push("group_key");

  // Build HAVING clause - only apply for string-type fields that don't handle unknown
  // Skip for boolean fields like evaluations.evaluation_passed (which use 0/1, not empty strings)
  const havingClause =
    !groupByHandlesUnknown && input.groupBy !== "evaluations.evaluation_passed"
      ? "HAVING group_key != ''"
      : "";

  // CTE body: use GROUP BY when pre-aggregating eval metrics per trace,
  // otherwise fall back to SELECT DISTINCT for backward-compatible behavior.
  let cteBody: string;
  if (hasEvalMixWithTrace) {
    const cteGroupByCols: string[] = ["trace_id", "group_key", "period"];
    if (dateTrunc) cteGroupByCols.push("date");
    cteBody = `
      SELECT
        ${cteSelectExprs.join(",\n        ")}
      FROM ${dedupedTraceSummaries(ts)}
      ${joinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
      GROUP BY ${cteGroupByCols.join(", ")}
    `;
  } else {
    cteBody = `
      SELECT DISTINCT
        ${cteSelectExprs.join(",\n        ")}
      FROM ${dedupedTraceSummaries(ts)}
      ${joinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
    `;
  }

  const sql = `
    WITH deduped_traces AS (${cteBody})
    SELECT
      ${outerSelectExprs.join(",\n      ")}
    FROM deduped_traces
    WHERE period IS NOT NULL
    GROUP BY ${outerGroupBy.join(", ")}
    ${havingClause}
    ORDER BY period${dateTrunc ? ", date" : ""}
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
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build the UNION ALL SQL for the groupBy path in buildSubqueryTimeseriesQuery.
 * Returns the complete SQL + params object when groupByColumn is active.
 *
 * Each branch handles a different combination of metric types:
 * - simple only: SELECT directly from simple_metrics CTEs
 * - single subquery only: SELECT directly from that metric's CTE
 * - mixed / multiple subquery: FULL OUTER JOIN all CTEs on group_key
 */
function buildGroupByUnionAllQuery({
  input,
  ctes,
  simpleMetrics,
  subqueryMetrics,
  filterParams,
}: {
  input: TimeseriesQueryInput;
  ctes: string[];
  simpleMetrics: MetricTranslation[];
  subqueryMetrics: MetricTranslation[];
  filterParams: Record<string, unknown>;
}): BuiltQuery {
  const simpleAliases = simpleMetrics.map((m) => quoteIdentifier(m.alias));
  const subqueryAliasExprs = subqueryMetrics.map(
    (m) => `metric_value AS ${quoteIdentifier(m.alias)}`,
  );

  const currentParts: string[] = ["'current' AS period", "group_key"];
  const previousParts: string[] = ["'previous' AS period", "group_key"];

  let currentFrom = "";
  let previousFrom = "";

  if (simpleMetrics.length > 0 && subqueryMetrics.length === 0) {
    // Simple metrics only: SELECT directly from the simple_metrics CTEs
    currentParts.push(...simpleAliases);
    previousParts.push(...simpleAliases);
    currentFrom = "FROM simple_metrics_current";
    previousFrom = "FROM simple_metrics_previous";
  } else if (simpleMetrics.length === 0 && subqueryMetrics.length === 1) {
    // Single subquery metric only: SELECT directly from the subquery CTE
    const singleSubquery = subqueryMetrics[0];
    const singleAliasExpr = subqueryAliasExprs[0];
    if (!singleSubquery || !singleAliasExpr) {
      throw new Error("Expected exactly one subquery metric");
    }
    const cteName = `cte_${singleSubquery.alias}`;
    currentParts.push(singleAliasExpr);
    previousParts.push(singleAliasExpr);
    currentFrom = `FROM ${cteName}_current`;
    previousFrom = `FROM ${cteName}_previous`;
  } else if (simpleMetrics.length > 0 || subqueryMetrics.length > 0) {
    // Mixed or multiple subquery metrics: JOIN the CTEs on group_key
    const allCurrentSources: string[] = [];
    const allPreviousSources: string[] = [];
    const allCurrentCols: string[] = [];
    const allPreviousCols: string[] = [];

    if (simpleMetrics.length > 0) {
      allCurrentSources.push("simple_metrics_current smc");
      allPreviousSources.push("simple_metrics_previous smp");
      simpleAliases.forEach((a) => {
        allCurrentCols.push(`smc.${a}`);
        allPreviousCols.push(`smp.${a}`);
      });
    }

    subqueryMetrics.forEach((m, i) => {
      const cteName = `cte_${m.alias}`;
      const alias = `sq${i}`;
      const quotedAlias = quoteIdentifier(m.alias);
      if (allCurrentSources.length === 0) {
        allCurrentSources.push(`${cteName}_current ${alias}`);
        allPreviousSources.push(`${cteName}_previous ${alias}`);
      } else {
        const baseCurrentAlias = allCurrentSources[0]?.split(" ")[1] ?? alias;
        const basePreviousAlias = allPreviousSources[0]?.split(" ")[1] ?? alias;
        allCurrentSources.push(
          `FULL OUTER JOIN ${cteName}_current ${alias} ON ${baseCurrentAlias}.group_key = ${alias}.group_key`,
        );
        allPreviousSources.push(
          `FULL OUTER JOIN ${cteName}_previous ${alias} ON ${basePreviousAlias}.group_key = ${alias}.group_key`,
        );
      }
      allCurrentCols.push(`${alias}.metric_value AS ${quotedAlias}`);
      allPreviousCols.push(`${alias}.metric_value AS ${quotedAlias}`);
    });

    currentParts.push(...allCurrentCols);
    previousParts.push(...allPreviousCols);
    currentFrom = `FROM ${allCurrentSources.join("\n    ")}`;
    previousFrom = `FROM ${allPreviousSources.join("\n    ")}`;
  }

  const sql = `
    WITH
      ${ctes.join(",\n      ")}
    SELECT ${currentParts.join(", ")} ${currentFrom}
    UNION ALL
    SELECT ${previousParts.join(", ")} ${previousFrom}
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
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build a timeseries query using CTEs for subquery (pipeline) metrics.
 * This handles metrics that require two-level aggregation (e.g., avg threads per user).
 */
function buildSubqueryTimeseriesQuery(
  input: TimeseriesQueryInput,
  simpleMetrics: MetricTranslation[],
  subqueryMetrics: MetricTranslation[],
  joinClauses: string,
  baseWhere: string,
  filterWhere: string,
  filterParams: Record<string, unknown>,
  groupByColumn: string | null = null,
  groupByHandlesUnknown = false,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ctes: string[] = [];

  // Build group_key expression when groupBy is active, matching the pattern used in
  // buildArrayJoinTimeseriesQuery and the standard query path.
  const groupKeyExpr = groupByColumn
    ? groupByHandlesUnknown
      ? `${groupByColumn} AS group_key`
      : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`
    : null;

  // Build CTEs for each subquery metric, one for current and one for previous period
  // Use 'cte_' prefix to ensure CTE names don't start with a digit (which is invalid SQL)
  for (const metric of subqueryMetrics) {
    if (!metric.subquery) continue;
    const subquery = metric.subquery;
    const cteName = `cte_${metric.alias}`;

    // When groupByColumn is set, propagate group_key into the CTE so the outer query
    // can group results by it. The group_key is added to both the inner SELECT and
    // inner GROUP BY of the subquery.
    const groupKeyInnerSelect = groupKeyExpr ? `, ${groupKeyExpr}` : "";
    const groupKeyInnerGroupBy = groupByColumn ? `, group_key` : "";

    // Check if this is a nested subquery (3-level aggregation)
    if (subquery.nestedSubquery) {
      const nested = subquery.nestedSubquery;
      const havingClause = nested.having ? `HAVING ${nested.having}` : "";

      // CTE for current period with nested subquery
      ctes.push(`
      ${cteName}_current AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM (
            SELECT ${nested.select}
            FROM ${dedupedTraceSummaries(ts)}
            ${joinClauses}
            WHERE ${ts}.TenantId = {tenantId:String}
              AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
              AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
              ${filterWhere}
            GROUP BY ${nested.groupBy}
            ${havingClause}
          ) thread_data
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);

      // CTE for previous period with nested subquery
      ctes.push(`
      ${cteName}_previous AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM (
            SELECT ${nested.select}
            FROM ${dedupedTraceSummaries(ts)}
            ${joinClauses}
            WHERE ${ts}.TenantId = {tenantId:String}
              AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
              AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
              ${filterWhere}
            GROUP BY ${nested.groupBy}
            ${havingClause}
          ) thread_data
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);
    } else {
      // Standard 2-level aggregation
      // CTE for current period
      ctes.push(`
      ${cteName}_current AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM ${dedupedTraceSummaries(ts)}
          ${joinClauses}
          WHERE ${ts}.TenantId = {tenantId:String}
            AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
            AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
            ${filterWhere}
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);

      // CTE for previous period
      ctes.push(`
      ${cteName}_previous AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM ${dedupedTraceSummaries(ts)}
          ${joinClauses}
          WHERE ${ts}.TenantId = {tenantId:String}
            AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
            AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
            ${filterWhere}
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);
    }
  }

  // Build simple metrics query for current period
  // Quote aliases that start with digits for ClickHouse compatibility
  const simpleSelectExprs: string[] = [];
  if (groupKeyExpr) {
    simpleSelectExprs.push(groupKeyExpr);
  }
  for (const metric of simpleMetrics) {
    // Replace unquoted alias with quoted alias in the selectExpression
    const quotedAlias = quoteIdentifier(metric.alias);
    const quotedExpression = metric.selectExpression.replace(
      ` AS ${metric.alias}`,
      ` AS ${quotedAlias}`,
    );
    simpleSelectExprs.push(quotedExpression);
  }

  // CTE for simple metrics current period
  const simpleGroupBy = groupByColumn ? "\n        GROUP BY group_key" : "";
  if (simpleMetrics.length > 0) {
    ctes.push(`
      simple_metrics_current AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts)}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
          AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
          ${filterWhere}${simpleGroupBy}
      )`);

    ctes.push(`
      simple_metrics_previous AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts)}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
          AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
          ${filterWhere}${simpleGroupBy}
      )`);
  }

  // When groupByColumn is present, delegate to the grouped UNION ALL builder.
  // Scalar subqueries cannot be used here because the CTEs now return multiple rows
  // (one per group_key value).
  if (groupByColumn) {
    return buildGroupByUnionAllQuery({
      input,
      ctes,
      simpleMetrics,
      subqueryMetrics,
      filterParams,
    });
  }

  // No groupBy: use scalar subqueries wrapped in COALESCE to guarantee a row even
  // when there is no data in one of the periods.
  const currentSelectExprs: string[] = ["'current' AS period"];
  const previousSelectExprs: string[] = ["'previous' AS period"];

  // Add simple metrics columns (quote aliases that start with digits)
  // Wrap entire subquery in COALESCE to handle empty result sets (0 rows returns NULL)
  for (const metric of simpleMetrics) {
    if (simpleMetrics.length > 0) {
      const quotedAlias = quoteIdentifier(metric.alias);
      currentSelectExprs.push(
        `coalesce((SELECT ${quotedAlias} FROM simple_metrics_current), 0) AS ${quotedAlias}`,
      );
      previousSelectExprs.push(
        `coalesce((SELECT ${quotedAlias} FROM simple_metrics_previous), 0) AS ${quotedAlias}`,
      );
    }
  }

  // Add subquery metrics columns (use cte_ prefix to match CTE names, quote aliases)
  // Wrap entire subquery in COALESCE to handle empty result sets (0 rows returns NULL)
  for (const metric of subqueryMetrics) {
    const cteName = `cte_${metric.alias}`;
    const quotedAlias = quoteIdentifier(metric.alias);
    currentSelectExprs.push(
      `coalesce((SELECT metric_value FROM ${cteName}_current), 0) AS ${quotedAlias}`,
    );
    previousSelectExprs.push(
      `coalesce((SELECT metric_value FROM ${cteName}_previous), 0) AS ${quotedAlias}`,
    );
  }

  const sql = `
    WITH
      ${ctes.join(",\n      ")}
    SELECT ${currentSelectExprs.join(", ")}
    UNION ALL
    SELECT ${previousSelectExprs.join(", ")}
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
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build a date-bucketed pipeline query for pipeline metrics with numeric timeScale.
 * Uses CTE-based two-level (or three-level for nested) aggregation with date bucketing.
 *
 * NOTE: This is structurally different from buildSubqueryTimeseriesQuery (timeScale="full")
 * which splits current/previous into separate CTEs joined via UNION ALL. Here, both periods
 * coexist in one CTE using a CASE-based period column + date bucketing.
 *
 * Injection safety: All user-facing values (projectId, dates, groupByKey, filter values) go
 * through ClickHouse parameterized placeholders ({tenantId:String}, etc.). The interpolated
 * SQL fragments (subquery.innerSelect, outerAggregation, groupByColumn) are produced by
 * translatePipelineAggregation/getGroupByExpression from typed enums and constant column
 * references — never from raw user input.
 *
 * Output rows: period, date, [group_key,] <metric_alias>
 */
function buildDateBucketedPipelineQuery({
  input,
  simpleMetrics = [],
  pipelineMetrics,
  groupByColumn,
  groupByHandlesUnknown,
  joinClauses,
  baseWhere,
  filterWhere,
  filterParams,
  timeZone,
}: {
  input: TimeseriesQueryInput;
  simpleMetrics?: MetricTranslation[];
  pipelineMetrics: MetricTranslation[];
  groupByColumn: string | null;
  groupByHandlesUnknown: boolean;
  joinClauses: string;
  baseWhere: string;
  filterWhere: string;
  filterParams: Record<string, unknown>;
  timeZone: string;
}): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const dateTrunc = getDateTruncFunction(
    input.timeScale as number,
    timeZone,
  );

  const periodCase = `
    CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END`;

  const groupKeyExpr = groupByColumn
    ? groupByHandlesUnknown
      ? `${groupByColumn} AS group_key`
      : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`
    : null;

  const fullFilterWhere = filterWhere;

  const groupKeyHaving = buildGroupKeyHavingClause({
    groupByColumn,
    groupByHandlesUnknown,
    groupBy: input.groupBy,
    groupByKey: input.groupByKey,
  });

  const ctes: string[] = pipelineMetrics.map((metric) =>
    buildPipelineMetricCTE(metric, {
      ts,
      periodCase,
      dateTrunc,
      groupByColumn,
      groupKeyExpr,
      groupKeyHaving,
      joinClauses,
      baseWhere,
      fullFilterWhere,
    }),
  );

  // Build a CTE for simple (non-pipeline) metrics so they are not dropped
  // when mixed with pipeline metrics on numeric timeScale.
  const hasSimple = simpleMetrics.length > 0;
  if (hasSimple) {
    const simpleSelectExprs = [
      `${periodCase} AS period`,
      `${dateTrunc} AS date`,
      ...(groupKeyExpr ? [groupKeyExpr] : []),
      ...simpleMetrics.map((m) => m.selectExpression),
    ];
    const simpleGroupByCols = ["period", "date"];
    if (groupByColumn) simpleGroupByCols.push("group_key");

    ctes.push(`
      simple_metrics AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts)}
        ${joinClauses}
        WHERE ${baseWhere}
          ${fullFilterWhere}
        GROUP BY ${simpleGroupByCols.join(", ")}
        ${groupKeyHaving}
      )`);
  }

  // Build final SELECT — join all CTEs on (period, date[, group_key])
  const joinKeys = groupByColumn
    ? ["period", "date", "group_key"]
    : ["period", "date"];

  // Determine the anchor CTE (first source in the FROM/JOIN chain)
  const firstPipelineCteName = `cte_${pipelineMetrics[0]!.alias}`;
  const anchorCte = hasSimple ? "simple_metrics" : firstPipelineCteName;

  let finalSelect: string;
  if (!hasSimple && pipelineMetrics.length === 1) {
    // Single pipeline metric, no simple metrics — simple path
    finalSelect = `SELECT * FROM ${firstPipelineCteName} WHERE period IS NOT NULL ORDER BY period, date`;
  } else {
    // Multiple sources: FULL OUTER JOIN on (period, date[, group_key])
    let joinSql = anchorCte;
    const selectCols = [...joinKeys.map((k) => `${anchorCte}.${k}`)];

    // Add simple metric columns from anchor
    if (hasSimple) {
      for (const m of simpleMetrics) {
        selectCols.push(`${anchorCte}.${quoteIdentifier(m.alias)}`);
      }
    }

    // Determine which pipeline CTEs need joining (skip anchor if it's the first pipeline CTE)
    const pipelineCTEsToJoin = hasSimple
      ? pipelineMetrics
      : pipelineMetrics.slice(1);

    // If anchor is the first pipeline CTE, add its column
    if (!hasSimple) {
      selectCols.push(
        `${firstPipelineCteName}.${quoteIdentifier(pipelineMetrics[0]!.alias)}`,
      );
    }

    for (const metric of pipelineCTEsToJoin) {
      const cteName = `cte_${metric.alias}`;
      const onClause = joinKeys
        .map((k) => `${anchorCte}.${k} = ${cteName}.${k}`)
        .join(" AND ");
      joinSql += `\n    FULL OUTER JOIN ${cteName} ON ${onClause}`;
      selectCols.push(`${cteName}.${quoteIdentifier(metric.alias)}`);
    }

    finalSelect = `SELECT ${selectCols.join(", ")} FROM ${joinSql} WHERE ${anchorCte}.period IS NOT NULL ORDER BY ${anchorCte}.period, ${anchorCte}.date`;
  }

  const sql = `
    WITH
      ${ctes.join(",\n      ")}
    ${finalSelect}
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
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/** Shared context for building a pipeline metric CTE */
interface PipelineCTEContext {
  ts: string;
  periodCase: string;
  dateTrunc: string;
  groupByColumn: string | null;
  groupKeyExpr: string | null;
  groupKeyHaving: string;
  joinClauses: string;
  baseWhere: string;
  fullFilterWhere: string;
}

/**
 * Build a single pipeline metric CTE with date bucketing.
 * Handles both standard 2-level and nested 3-level aggregations.
 */
function buildPipelineMetricCTE(
  metric: MetricTranslation,
  ctx: PipelineCTEContext,
): string {
  if (!metric.subquery) {
    throw new Error(`Metric "${metric.alias}" is missing subquery definition`);
  }
  const subquery = metric.subquery;
  const cteName = `cte_${metric.alias}`;
  const hasGroup = !!ctx.groupByColumn;
  const groupPrefix = hasGroup ? "group_key, " : "";
  const quotedAlias = quoteIdentifier(metric.alias);

  // Outer aggregation expression (strip original alias, re-alias with quoting)
  const outerAggExpr = subquery.outerAggregation.replace(
    ` AS ${metric.alias}`,
    "",
  );

  // Outer GROUP BY / HAVING
  const outerGroupByCols = ["period", "date"];
  if (hasGroup) outerGroupByCols.push("group_key");
  const outerHaving = ctx.groupKeyHaving;

  // Inner select: the base scan with period/date bucketing
  const baseSelectCols = [
    `${ctx.periodCase} AS period`,
    `${ctx.dateTrunc} AS date`,
    ...(ctx.groupKeyExpr ? [ctx.groupKeyExpr] : []),
  ];

  const baseFrom = `
          FROM ${dedupedTraceSummaries(ctx.ts)}
          ${ctx.joinClauses}
          WHERE ${ctx.baseWhere}
            ${ctx.fullFilterWhere}`;

  if (subquery.nestedSubquery) {
    // 3-level aggregation (e.g., threads per user)
    const nested = subquery.nestedSubquery;
    const nestedHaving = nested.having ? `HAVING ${nested.having}` : "";

    const level2GroupByCols = ["period", "date"];
    if (hasGroup) level2GroupByCols.push("group_key");
    level2GroupByCols.push(subquery.innerGroupBy);

    return `
      ${cteName} AS (
        SELECT period, date, ${groupPrefix}${outerAggExpr} AS ${quotedAlias}
        FROM (
          SELECT period, date, ${groupPrefix}${subquery.innerSelect}
          FROM (
            SELECT
              ${baseSelectCols.join(",\n              ")},
              ${nested.select}
            ${baseFrom}
            GROUP BY period, date, ${groupPrefix}${nested.groupBy}
            ${nestedHaving}
          ) thread_data
          GROUP BY ${level2GroupByCols.join(", ")}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        GROUP BY ${outerGroupByCols.join(", ")}
        ${outerHaving}
      )`;
  }

  // Standard 2-level aggregation
  const innerGroupByCols = ["period", "date"];
  if (hasGroup) innerGroupByCols.push("group_key");
  innerGroupByCols.push(subquery.innerGroupBy);

  return `
      ${cteName} AS (
        SELECT period, date, ${groupPrefix}${outerAggExpr} AS ${quotedAlias}
        FROM (
          SELECT
            ${baseSelectCols.join(",\n            ")},
            ${subquery.innerSelect}
          ${baseFrom}
          GROUP BY ${innerGroupByCols.join(", ")}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        GROUP BY ${outerGroupByCols.join(", ")}
        ${outerHaving}
      )`;
}

/** Maps source field names to their corresponding CTE column names */
const DEDUP_FIELD_MAPPINGS: Record<string, string> = {
  TotalCost: "trace_total_cost",
  TotalDurationMs: "trace_duration_ms",
  TotalPromptTokenCount: "trace_prompt_tokens",
  TotalCompletionTokenCount: "trace_completion_tokens",
};

/** Aggregation patterns and their transformation logic */
const AGGREGATION_HANDLERS: Array<{
  pattern: RegExp;
  transform: (col: string, expr: string) => string | null;
}> = [
  {
    pattern: /\bsum\s*\(/,
    transform: (col) => `sum(${col})`,
  },
  {
    pattern: /\bavg\s*\(/,
    transform: (col) => `avg(${col})`,
  },
  {
    pattern: /\bmin\s*\(/,
    transform: (col) => `min(${col})`,
  },
  {
    pattern: /\bmax\s*\(/,
    transform: (col) => `max(${col})`,
  },
  {
    pattern: /\bquantileTDigest\s*\(/,
    transform: (col, expr) => {
      const match = expr.match(/quantileTDigest\s*\(\s*([\d.]+)\s*\)/);
      return match ? `quantileTDigest(${match[1]})(${col})` : null;
    },
  },
  {
    pattern: /\bquantileExact\s*\(/,
    transform: (col, expr) => {
      const match = expr.match(/quantileExact\s*\(\s*([\d.]+)\s*\)/);
      return match ? `quantileExact(${match[1]})(${col})` : null;
    },
  },
];

/**
 * Map an evaluation metric's conditional aggregation (e.g. `avgIf`, `sumIf`)
 * to the cross-trace aggregation used in the outer query.
 *
 * Context: when evaluation metrics are pre-aggregated per trace inside a CTE
 * (to avoid inflating trace-level metrics via eval-run fan-out), the outer
 * query has a scalar per-trace value and must re-aggregate across traces.
 * This helper picks the correct aggregation based on the original conditional
 * aggregation, so semantics remain as close as possible to the pre-fix query.
 *
 * Returns `null` if no known aggregation is found (caller should fall back
 * to `avg` as a safe default for rates/averages).
 */
function mapEvalAggregationToOuter(selectExpression: string): string | null {
  const mappings: Array<{ pattern: RegExp; outer: string }> = [
    { pattern: /\bavgIf\s*\(/, outer: "avg" },
    { pattern: /\bsumIf\s*\(/, outer: "sum" },
    { pattern: /\bminIf\s*\(/, outer: "min" },
    { pattern: /\bmaxIf\s*\(/, outer: "max" },
    // uniqIf -> sum: per-trace `uniqIf(EvaluationId, ...)` produces a per-trace
    // count of unique evaluation runs, and summing across traces is correct
    // because EvaluationId is a primary key per evaluation run and each run
    // belongs to exactly one trace. If that 1:1 invariant ever changes,
    // summing would overcount and this mapping must be revisited.
    { pattern: /\buniqIf\s*\(/, outer: "sum" },
    { pattern: /\bcountIf\s*\(/, outer: "sum" },
    { pattern: /\bquantileExactIf\s*\(/, outer: "avg" },
  ];
  for (const { pattern, outer } of mappings) {
    if (pattern.test(selectExpression)) return outer;
  }
  return null;
}

/**
 * Strip the trailing ` AS <alias>` from a SELECT expression, returning just
 * the underlying aggregation expression. Used when we need to re-alias the
 * expression as a per-trace column (e.g. `<alias>__per_trace`).
 */
function stripSelectExpressionAlias(
  selectExpression: string,
  alias: string,
): string {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return selectExpression
    .replace(new RegExp(`\\s+AS\\s+${escaped}\\s*$`), "")
    .trim();
}

/**
 * Transform a metric expression to work with deduplicated trace data.
 * count() becomes uniqExact(trace_id) to count distinct traces.
 * Sum/avg of trace-level values use the CTE columns.
 */
function transformMetricForDedup(
  selectExpression: string,
  alias: string,
): string {
  // Handle count() -> uniqExact(trace_id)
  if (/\bcount\s*\(\s*\*?\s*\)/.test(selectExpression)) {
    return `uniqExact(trace_id) AS ${alias}`;
  }

  // Handle uniq/uniqExact of TraceId -> uniqExact(trace_id)
  if (
    (/\buniq\s*\(/.test(selectExpression) ||
      /\buniqExact\s*\(/.test(selectExpression)) &&
    selectExpression.includes("TraceId")
  ) {
    return `uniqExact(trace_id) AS ${alias}`;
  }

  // Find matching field and apply aggregation transformation
  for (const [fieldName, cteColumn] of Object.entries(DEDUP_FIELD_MAPPINGS)) {
    if (!selectExpression.includes(fieldName)) continue;

    for (const handler of AGGREGATION_HANDLERS) {
      if (!handler.pattern.test(selectExpression)) continue;

      const transformed = handler.transform(cteColumn, selectExpression);
      if (!transformed) continue;

      // Preserve coalesce wrapper if present
      const hasCoalesce = /\bcoalesce\s*\(/.test(selectExpression);
      const result = hasCoalesce ? `coalesce(${transformed}, 0)` : transformed;
      return `${result} AS ${alias}`;
    }
  }

  // Handle evaluation metrics that reference evaluation_runs columns (es.Passed, es.Score, etc.)
  // Replace table-qualified references with CTE column aliases so the outer SELECT is valid.
  // Uses the same extractReferencedEvaluationColumns as the CTE projection to stay in sync.
  const es = tableAliases.evaluation_runs;
  const referencedEvalCols = extractReferencedEvaluationColumns([
    selectExpression,
  ]);
  if (referencedEvalCols.size > 0) {
    let rewritten = selectExpression;
    for (const col of referencedEvalCols) {
      rewritten = rewritten.replaceAll(
        `${es}.${col}`,
        `eval_${snakeCase(col)}`,
      );
    }
    return rewritten;
  }

  // Handle event-based metrics that reference stored_spans columns (ss."Events.Name", etc.)
  // In the CTE context with arrayJoin grouping, the group_key already filters to matching events.
  // Only rewrite count-like metrics — their semantics map to uniqExact(trace_id)
  // in the CTE context where group_key already filters to matching events.
  // Value-based aggregations (avgArray, sumArray, etc.) pass through unchanged
  // because rewriting them would silently change "average score" to "count of traces".
  const ss = tableAliases.stored_spans;
  if (
    selectExpression.includes(`${ss}."Events.Name"`) ||
    selectExpression.includes(`${ss}."Events.Attributes"`)
  ) {
    if (
      /\bcountIf\s*\(/.test(selectExpression) ||
      /\bcount\s*\(/.test(selectExpression) ||
      /\buniq/.test(selectExpression)
    ) {
      return `uniqExact(trace_id) AS ${alias}`;
    }
  }

  // Default: return as-is (may need extension for other metric types)
  return selectExpression;
}

/**
 * Build a query for dataForFilter (dropdown data)
 */
export function buildDataForFilterQuery(
  projectId: string,
  field: FilterField,
  startDate: Date,
  endDate: Date,
  key?: string,
  subkey?: string,
  searchQuery?: string,
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const es = tableAliases.evaluation_runs;

  // Translate filters if provided
  const filterTranslation = translateAllFilters(filters ?? {});
  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";
  const filterExpressions = [filterTranslation.whereClause];
  const filterJoins = Array.from(filterTranslation.requiredJoins)
    .map((table) => {
      const requiredColumns = resolveRequiredColumns(table, filterExpressions);
      return buildJoinClause(table, requiredColumns);
    })
    .join("\n");

  let sql: string;
  let joins = "";

  // Build query based on field type
  switch (field) {
    case "topics.topics":
      sql = `
        SELECT
          ${ts}.TopicId AS field,
          ${ts}.TopicId AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.TopicId IS NOT NULL
          AND ${ts}.TopicId != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.TopicId ILIKE {searchQuery:String}` : ""}
        GROUP BY ${ts}.TopicId
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "topics.subtopics":
      sql = `
        SELECT
          ${ts}.SubTopicId AS field,
          ${ts}.SubTopicId AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.SubTopicId IS NOT NULL
          AND ${ts}.SubTopicId != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.SubTopicId ILIKE {searchQuery:String}` : ""}
        GROUP BY ${ts}.SubTopicId
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "metadata.user_id":
      sql = `
        SELECT
          ${ts}.Attributes['langwatch.user_id'] AS field,
          ${ts}.Attributes['langwatch.user_id'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['langwatch.user_id'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.Attributes['langwatch.user_id'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "metadata.thread_id":
      sql = `
        SELECT
          ${ts}.Attributes['gen_ai.conversation.id'] AS field,
          ${ts}.Attributes['gen_ai.conversation.id'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['gen_ai.conversation.id'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.Attributes['gen_ai.conversation.id'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "spans.model":
      joins = buildJoinClause("stored_spans", new Set(["SpanAttributes"]));
      sql = `
        SELECT
          ${ss}.SpanAttributes['gen_ai.request.model'] AS field,
          ${ss}.SpanAttributes['gen_ai.request.model'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${joins}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ss}.SpanAttributes['gen_ai.request.model'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ss}.SpanAttributes['gen_ai.request.model'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "spans.type":
      joins = buildJoinClause("stored_spans", new Set(["SpanAttributes"]));
      sql = `
        SELECT
          ${ss}.SpanAttributes['langwatch.span.type'] AS field,
          ${ss}.SpanAttributes['langwatch.span.type'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${joins}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ss}.SpanAttributes['langwatch.span.type'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ss}.SpanAttributes['langwatch.span.type'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "evaluations.evaluator_id":
    case "evaluations.evaluator_id.guardrails_only":
      joins = buildJoinClause("evaluation_runs");
      sql = `
        SELECT
          ${es}.EvaluatorId AS field,
          concat('[', coalesce(${es}.EvaluatorName, ${es}.EvaluatorType, 'custom'), '] ', coalesce(${es}.EvaluatorName, '')) AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${joins}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          ${field === "evaluations.evaluator_id.guardrails_only" ? `AND ${es}.IsGuardrail = 1` : ""}
          ${filterWhere}
          ${searchQuery ? `AND ${es}.EvaluatorName ILIKE {searchQuery:String}` : ""}
        GROUP BY ${es}.EvaluatorId, ${es}.EvaluatorName, ${es}.EvaluatorType
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "traces.error":
      sql = `
        SELECT
          if(toUInt8(coalesce(${ts}.ContainsErrorStatus, 0)) = 1, 'true', 'false') AS field,
          if(toUInt8(coalesce(${ts}.ContainsErrorStatus, 0)) = 1, 'Traces with error', 'Traces without error') AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          ${filterWhere}
        GROUP BY toUInt8(coalesce(${ts}.ContainsErrorStatus, 0))
        ORDER BY count DESC
      `;
      break;

    default:
      // Fallback: return empty result
      sql = `SELECT '' AS field, '' AS label, 0 AS count WHERE 1=0`;
  }

  return {
    sql,
    params: {
      tenantId: projectId,
      startDate,
      endDate,
      searchQuery: searchQuery ? `%${searchQuery}%` : undefined,
      ...filterTranslation.params,
    },
  };
}

/**
 * Build a query for top used documents (RAG analytics)
 */
export function buildTopDocumentsQuery(
  projectId: string,
  startDate: Date,
  endDate: Date,
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  // Translate filters
  const filterTranslation = translateAllFilters(filters ?? {});
  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";

  // Build query to get top documents from RAG contexts
  // Documents are stored in SpanAttributes['langwatch.rag.contexts'] as JSON
  const sql = `
    WITH document_refs AS (
      SELECT
        ${ts}.TraceId,
        toString(context.document_id) AS document_id,
        toString(context.content) AS content
      FROM ${dedupedTraceSummaries(ts)}
      JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
      ARRAY JOIN JSONExtract(${ss}.SpanAttributes['langwatch.rag.contexts'], 'Array(JSON)') AS context
      WHERE ${ts}.TenantId = {tenantId:String}
        AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
        AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
        AND ${ss}.SpanAttributes['langwatch.rag.contexts'] != ''
        ${filterWhere}
    )
    SELECT
      document_id AS documentId,
      count() AS count,
      any(TraceId) AS traceId,
      any(content) AS content
    FROM document_refs
    WHERE document_id != ''
    GROUP BY document_id
    ORDER BY count DESC
    LIMIT 10
  `;

  const totalSql = `
    SELECT uniq(toString(context.document_id)) AS total
    FROM ${dedupedTraceSummaries(ts)}
    JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
    ARRAY JOIN JSONExtract(${ss}.SpanAttributes['langwatch.rag.contexts'], 'Array(JSON)') AS context
    WHERE ${ts}.TenantId = {tenantId:String}
      AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
      AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
      AND ${ss}.SpanAttributes['langwatch.rag.contexts'] != ''
      ${filterWhere}
  `;

  return {
    sql: `${sql}; ${totalSql}`,
    params: {
      tenantId: projectId,
      startDate,
      endDate,
      ...filterTranslation.params,
    },
  };
}

/**
 * Build a query for feedbacks
 */
export function buildFeedbacksQuery(
  projectId: string,
  startDate: Date,
  endDate: Date,
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  // Translate filters
  const filterTranslation = translateAllFilters(filters ?? {});
  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";

  // Build query to get feedback events
  // Events are stored in stored_spans as parallel arrays
  const sql = `
    SELECT
      ${ts}.TraceId AS trace_id,
      ${ss}.SpanId AS event_id,
      toUnixTimestamp64Milli(event_timestamp) AS started_at,
      event_name AS event_type,
      event_attrs AS attributes
    FROM ${dedupedTraceSummaries(ts)}
    JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
    ARRAY JOIN
      ${ss}."Events.Timestamp" AS event_timestamp,
      ${ss}."Events.Name" AS event_name,
      ${ss}."Events.Attributes" AS event_attrs
    WHERE ${ts}.TenantId = {tenantId:String}
      AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
      AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
      AND event_name = 'thumbs_up_down'
      AND mapContains(event_attrs, 'event.metrics.vote')
      ${filterWhere}
    ORDER BY event_timestamp DESC
    LIMIT 100
  `;

  return {
    sql,
    params: {
      tenantId: projectId,
      startDate,
      endDate,
      ...filterTranslation.params,
    },
  };
}

// Exported for test coverage — do not use outside tests.
export const __testOnly__ = {
  mapEvalAggregationToOuter,
  extractTraceAggregationColumn,
  replaceColumnWithAlias,
  hasEvalMixedWithTraceMetrics,
};
