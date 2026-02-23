/**
 * Aggregation Builder - Builds complete ClickHouse queries for analytics.
 *
 * This module combines metric translations, filter translations, and grouping
 * into complete ClickHouse SQL queries.
 */

import type { AggregationTypes } from "../types";
import type { SeriesInputType } from "../registry";
import type { FilterField } from "../../filters/types";
import { type CHTable, buildJoinClause, tableAliases } from "./field-mappings";
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
  | "sentiment.input_sentiment"
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
  additionalWhere?: string;
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
    column: `${tableAliases.evaluation_runs}.Passed`,
    requiredJoins: ["evaluation_runs"],
    additionalWhere: groupByKey
      ? `${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String}`
      : undefined,
  }),

  "evaluations.evaluation_label": () => ({
    column: `${tableAliases.evaluation_runs}.Label`,
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

  "sentiment.input_sentiment": () => ({
    column: `multiIf(
      toFloat64OrNull(${tableAliases.trace_summaries}.Attributes['langwatch.input.satisfaction_score']) >= 0.1, 'positive',
      toFloat64OrNull(${tableAliases.trace_summaries}.Attributes['langwatch.input.satisfaction_score']) <= -0.1, 'negative',
      'neutral'
    )`,
    requiredJoins: [],
  }),

  "sentiment.thumbs_up_down": () => ({
    // Extract the vote value from Events.Attributes where event name is 'thumbs_up_down'
    // and convert to 'thumbs_up' (vote=1) or 'thumbs_down' (vote=-1)
    // Events.Name and Events.Attributes are parallel arrays, so we zip them to filter
    column: `arrayJoin(
      arrayMap(
        (n, a) -> multiIf(
          toInt32OrNull(a['event.metrics.vote']) = 1, 'thumbs_up',
          toInt32OrNull(a['event.metrics.vote']) = -1, 'thumbs_down',
          ''
        ),
        arrayFilter(
          (n, a) -> n = 'thumbs_up_down' AND mapContains(a, 'event.metrics.vote'),
          ${tableAliases.stored_spans}."Events.Name",
          ${tableAliases.stored_spans}."Events.Attributes"
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
  let groupByAdditionalWhere: string | undefined;
  if (input.groupBy) {
    const groupByExpr = getGroupByExpression(input.groupBy, input.groupByKey);
    groupByColumn = groupByExpr.column;
    usesArrayJoin = groupByExpr.usesArrayJoin ?? false;
    groupByHandlesUnknown = groupByExpr.handlesUnknown ?? false;
    groupByRequiresSpans = groupByExpr.requiredJoins.includes("stored_spans");
    groupByAdditionalWhere = groupByExpr.additionalWhere;
    for (const join of groupByExpr.requiredJoins) {
      allJoins.add(join);
    }
  }

  // Build JOIN clauses
  const joinClauses = Array.from(allJoins)
    .map((table) => buildJoinClause(table))
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

  // Add groupBy additional WHERE clause if present (e.g., for filtering by specific evaluator)
  if (groupByAdditionalWhere) {
    filterWhere += ` AND ${groupByAdditionalWhere}`;
  }

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

  // Warn if pipeline metrics will be dropped (only supported with timeScale "full")
  if (subqueryMetrics.length > 0 && input.timeScale !== "full") {
    // Pipeline metrics require CTEs and are only fully supported in "full" timeScale mode.
    // When timeScale is numeric, they're omitted from the query. This is a known limitation.
    logger.warn(
      {
        droppedMetrics: subqueryMetrics.map((m) => m.alias),
        timeScale: input.timeScale,
      },
      "Pipeline metrics require timeScale='full' and will be omitted",
    );
  }

  // For timeScale "full" (summary queries), always use CTE-based query to ensure
  // both current and previous periods return data (even if one is empty)
  if (input.timeScale === "full") {
    return buildSubqueryTimeseriesQuery(
      input,
      simpleMetrics,
      subqueryMetrics,
      joinClauses,
      baseWhere,
      filterWhere,
      allTranslationParams,
    );
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

  // Filter out empty groupBy values to match ES terms aggregation behavior
  // Skip HAVING if column already handles 'unknown' conversion (those already excluded empty strings)
  // Skip HAVING for boolean fields like evaluations.evaluation_passed (which use 0/1, not empty strings)
  const havingClause =
    groupByColumn &&
    !groupByHandlesUnknown &&
    input.groupBy !== "evaluations.evaluation_passed"
      ? "HAVING group_key != ''"
      : "";

  // Build the complete SQL
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM trace_summaries ${ts}
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
  const cteSelectExprs: string[] = [
    `${ts}.TraceId AS trace_id`,
    groupKeyExpr,
    `CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period`,
  ];

  if (dateTrunc) {
    cteSelectExprs.push(`${dateTrunc} AS date`);
  }

  // Add per-trace values for metrics that need aggregation
  // For count-based metrics, we'll use uniqExact(trace_id) in outer query
  // For other metrics (sum, avg of TotalCost, etc.), we include the values
  const simpleMetrics = metricTranslations.filter((m) => !m.requiresSubquery);

  // Include metric base columns in CTE for aggregation in outer query
  // Add common trace-level columns that metrics might need
  cteSelectExprs.push(`${ts}.TotalCost AS trace_total_cost`);
  cteSelectExprs.push(`${ts}.TotalDurationMs AS trace_duration_ms`);
  cteSelectExprs.push(`${ts}.TotalPromptTokenCount AS trace_prompt_tokens`);
  cteSelectExprs.push(
    `${ts}.TotalCompletionTokenCount AS trace_completion_tokens`,
  );

  // Build outer SELECT expressions
  const outerSelectExprs: string[] = ["period"];
  if (dateTrunc) {
    outerSelectExprs.push("date");
  }
  outerSelectExprs.push("group_key");

  // Transform metrics to work on deduplicated data
  // count() becomes uniqExact(trace_id), sum/avg work on first value per trace
  for (const metric of simpleMetrics) {
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

  const sql = `
    WITH deduped_traces AS (
      SELECT DISTINCT
        ${cteSelectExprs.join(",\n        ")}
      FROM trace_summaries ${ts}
      ${joinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
    )
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
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ctes: string[] = [];

  // Build CTEs for each subquery metric, one for current and one for previous period
  // Use 'cte_' prefix to ensure CTE names don't start with a digit (which is invalid SQL)
  for (const metric of subqueryMetrics) {
    const subquery = metric.subquery!;
    const cteName = `cte_${metric.alias}`;

    // Check if this is a nested subquery (3-level aggregation)
    if (subquery.nestedSubquery) {
      const nested = subquery.nestedSubquery;
      const havingClause = nested.having ? `HAVING ${nested.having}` : "";

      // CTE for current period with nested subquery
      ctes.push(`
      ${cteName}_current AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value
        FROM (
          SELECT ${subquery.innerSelect}
          FROM (
            SELECT ${nested.select}
            FROM trace_summaries ${ts}
            ${joinClauses}
            WHERE ${ts}.TenantId = {tenantId:String}
              AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
              AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
              ${filterWhere}
            GROUP BY ${nested.groupBy}
            ${havingClause}
          ) thread_data
          GROUP BY ${subquery.innerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
      )`);

      // CTE for previous period with nested subquery
      ctes.push(`
      ${cteName}_previous AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value
        FROM (
          SELECT ${subquery.innerSelect}
          FROM (
            SELECT ${nested.select}
            FROM trace_summaries ${ts}
            ${joinClauses}
            WHERE ${ts}.TenantId = {tenantId:String}
              AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
              AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
              ${filterWhere}
            GROUP BY ${nested.groupBy}
            ${havingClause}
          ) thread_data
          GROUP BY ${subquery.innerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
      )`);
    } else {
      // Standard 2-level aggregation
      // CTE for current period
      ctes.push(`
      ${cteName}_current AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value
        FROM (
          SELECT ${subquery.innerSelect}
          FROM trace_summaries ${ts}
          ${joinClauses}
          WHERE ${ts}.TenantId = {tenantId:String}
            AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
            AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
            ${filterWhere}
          GROUP BY ${subquery.innerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
      )`);

      // CTE for previous period
      ctes.push(`
      ${cteName}_previous AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value
        FROM (
          SELECT ${subquery.innerSelect}
          FROM trace_summaries ${ts}
          ${joinClauses}
          WHERE ${ts}.TenantId = {tenantId:String}
            AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
            AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
            ${filterWhere}
          GROUP BY ${subquery.innerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
      )`);
    }
  }

  // Build simple metrics query for current period
  // Quote aliases that start with digits for ClickHouse compatibility
  const simpleSelectExprs: string[] = [];
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
  if (simpleMetrics.length > 0) {
    ctes.push(`
      simple_metrics_current AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM trace_summaries ${ts}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
          AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
          ${filterWhere}
      )`);

    ctes.push(`
      simple_metrics_previous AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM trace_summaries ${ts}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
          AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
          ${filterWhere}
      )`);
  }

  // Build final SELECT that combines simple and subquery metrics
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
  const filterJoins = Array.from(filterTranslation.requiredJoins)
    .map((table) => buildJoinClause(table))
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
        FROM trace_summaries ${ts}
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
        FROM trace_summaries ${ts}
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
        FROM trace_summaries ${ts}
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
        FROM trace_summaries ${ts}
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
      joins = buildJoinClause("stored_spans");
      sql = `
        SELECT
          ${ss}.SpanAttributes['gen_ai.request.model'] AS field,
          ${ss}.SpanAttributes['gen_ai.request.model'] AS label,
          count() AS count
        FROM trace_summaries ${ts}
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
      joins = buildJoinClause("stored_spans");
      sql = `
        SELECT
          ${ss}.SpanAttributes['langwatch.span.type'] AS field,
          ${ss}.SpanAttributes['langwatch.span.type'] AS label,
          count() AS count
        FROM trace_summaries ${ts}
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
        FROM trace_summaries ${ts}
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
        FROM trace_summaries ${ts}
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
      FROM trace_summaries ${ts}
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
    FROM trace_summaries ${ts}
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
    FROM trace_summaries ${ts}
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
