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
} from "./field-mappings";
import {
  type MetricTranslation,
  translateMetric,
  translatePipelineAggregation,
} from "./metric-translator";
import { translateAllFilters, type FilterTranslation } from "./filter-translator";

/** Maximum number of filter options returned by filter queries */
const MAX_FILTER_OPTIONS = 10000;

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
 * Get the ClickHouse date truncation function for a time scale
 */
function getDateTruncFunction(
  timeScaleMinutes: number,
  timeZone: string,
): string {
  // Convert minutes to appropriate interval
  if (timeScaleMinutes <= 1) {
    return `toStartOfMinute(ts.CreatedAt, '${timeZone}')`;
  } else if (timeScaleMinutes <= 60) {
    return `toStartOfInterval(ts.CreatedAt, INTERVAL ${timeScaleMinutes} MINUTE, '${timeZone}')`;
  } else if (timeScaleMinutes <= 1440) {
    // Up to 1 day
    const hours = Math.floor(timeScaleMinutes / 60);
    return `toStartOfInterval(ts.CreatedAt, INTERVAL ${hours} HOUR, '${timeZone}')`;
  } else {
    // Days
    const days = Math.floor(timeScaleMinutes / 1440);
    if (days === 1) {
      return `toStartOfDay(ts.CreatedAt, '${timeZone}')`;
    } else if (days <= 7) {
      return `toStartOfInterval(ts.CreatedAt, INTERVAL ${days} DAY, '${timeZone}')`;
    } else if (days <= 31) {
      return `toStartOfWeek(ts.CreatedAt, 1, '${timeZone}')`;
    } else {
      return `toStartOfMonth(ts.CreatedAt, '${timeZone}')`;
    }
  }
}

/**
 * Get the groupBy column expression for a group field
 */
function getGroupByExpression(
  groupBy: string,
  groupByKey?: string,
): { column: string; requiredJoins: CHTable[]; usesArrayJoin?: boolean } {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const es = tableAliases.evaluation_states;

  switch (groupBy) {
    case "topics.topics":
      return { column: `${ts}.TopicId`, requiredJoins: [] };

    case "metadata.user_id":
      return {
        column: `${ts}.Attributes['langwatch.user_id']`,
        requiredJoins: [],
      };

    case "metadata.thread_id":
      return {
        column: `${ts}.Attributes['gen_ai.conversation.id']`,
        requiredJoins: [],
      };

    case "metadata.customer_id":
      return {
        column: `${ts}.Attributes['langwatch.customer_id']`,
        requiredJoins: [],
      };

    case "metadata.labels":
      return {
        column: `arrayJoin(JSONExtract(${ts}.Attributes['langwatch.labels'], 'Array(String)'))`,
        requiredJoins: [],
        usesArrayJoin: true,
      };

    case "metadata.model":
      return {
        column: `${ss}.SpanAttributes['gen_ai.request.model']`,
        requiredJoins: ["stored_spans"],
      };

    case "metadata.span_type":
      return {
        column: `${ss}.SpanAttributes['langwatch.span.type']`,
        requiredJoins: ["stored_spans"],
      };

    case "evaluations.evaluation_passed": {
      const evaluatorCondition = groupByKey
        ? `AND ${es}.EvaluatorId = '${groupByKey.replace(/'/g, "''")}'`
        : "";
      return {
        column: `${es}.Passed`,
        requiredJoins: ["evaluation_states"],
      };
    }

    case "evaluations.evaluation_label": {
      return {
        column: `${es}.Label`,
        requiredJoins: ["evaluation_states"],
      };
    }

    case "evaluations.evaluation_processing_state": {
      return {
        column: `${es}.Status`,
        requiredJoins: ["evaluation_states"],
      };
    }

    case "events.event_type":
      return {
        column: `arrayJoin(${ss}."Events.Name")`,
        requiredJoins: ["stored_spans"],
        usesArrayJoin: true,
      };

    case "sentiment.input_sentiment":
      return {
        column: `multiIf(
          toFloat64OrNull(${ts}.Attributes['langwatch.input.satisfaction_score']) >= 0.1, 'positive',
          toFloat64OrNull(${ts}.Attributes['langwatch.input.satisfaction_score']) <= -0.1, 'negative',
          'neutral'
        )`,
        requiredJoins: [],
      };

    case "error.has_error":
      return {
        column: `if(${ss}.StatusCode = 2, 'with error', 'without error')`,
        requiredJoins: ["stored_spans"],
      };

    default:
      return { column: `${ts}.TraceId`, requiredJoins: [] };
  }
}

/**
 * Build the complete timeseries query
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

  // Handle groupBy
  let groupByColumn: string | null = null;
  let usesArrayJoin = false;
  if (input.groupBy) {
    const groupByExpr = getGroupByExpression(input.groupBy, input.groupByKey);
    groupByColumn = groupByExpr.column;
    usesArrayJoin = groupByExpr.usesArrayJoin ?? false;
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
      (${ts}.CreatedAt >= {currentStart:DateTime64(3)} AND ${ts}.CreatedAt < {currentEnd:DateTime64(3)})
      OR
      (${ts}.CreatedAt >= {previousStart:DateTime64(3)} AND ${ts}.CreatedAt < {previousEnd:DateTime64(3)})
    )
  `;

  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";

  // When using arrayJoin for grouping (like labels), we need a CTE approach to avoid
  // trace duplication affecting counts. The CTE deduplicates (TraceId, group_key) pairs
  // and preserves metrics per trace for accurate aggregation.
  if (usesArrayJoin && groupByColumn) {
    return buildArrayJoinTimeseriesQuery(
      input,
      groupByColumn,
      metricTranslations,
      joinClauses,
      baseWhere,
      filterWhere,
      filterTranslation.params,
      timeZone,
    );
  }

  // Build SELECT expressions for standard query
  const selectExprs: string[] = [];

  // Add period indicator
  selectExprs.push(`
    CASE
      WHEN ${ts}.CreatedAt >= {currentStart:DateTime64(3)} AND ${ts}.CreatedAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.CreatedAt >= {previousStart:DateTime64(3)} AND ${ts}.CreatedAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period
  `);

  // Add date grouping if not "full"
  if (input.timeScale !== "full" && typeof input.timeScale === "number") {
    const dateTrunc = getDateTruncFunction(input.timeScale, timeZone);
    selectExprs.push(`${dateTrunc} AS date`);
  }

  // Add groupBy column if present
  // Use 'unknown' for null/empty values to match ES behavior (missing: "unknown")
  if (groupByColumn) {
    selectExprs.push(`if(${groupByColumn} IS NULL OR toString(${groupByColumn}) = '', 'unknown', toString(${groupByColumn})) AS group_key`);
  }

  // Add metric expressions
  // Filter out pipeline metrics that require subqueries for now
  const simpleMetrics = metricTranslations.filter((m) => !m.requiresSubquery);
  for (const metric of simpleMetrics) {
    selectExprs.push(metric.selectExpression);
  }

  // Build GROUP BY
  const groupByExprs: string[] = ["period"];
  if (input.timeScale !== "full" && typeof input.timeScale === "number") {
    groupByExprs.push("date");
  }
  if (groupByColumn) {
    groupByExprs.push("group_key");
  }

  // No HAVING filter needed - empty/null values are converted to 'unknown' above
  // to match ES behavior (missing: "unknown")
  const havingClause = "";

  // Build the complete SQL
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM trace_summaries ${ts} FINAL
    ${joinClauses}
    WHERE ${baseWhere}
      ${filterWhere}
    GROUP BY ${groupByExprs.join(", ")}
    ${havingClause}
    ORDER BY period${input.timeScale !== "full" && typeof input.timeScale === "number" ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...filterTranslation.params,
    },
  };
}

/**
 * Build a timeseries query using CTE for arrayJoin grouping (labels, events).
 * This prevents trace duplication from affecting aggregate counts.
 */
function buildArrayJoinTimeseriesQuery(
  input: TimeseriesQueryInput,
  groupByColumn: string,
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
  const cteSelectExprs: string[] = [
    `${ts}.TraceId AS trace_id`,
    `if(${groupByColumn} IS NULL OR toString(${groupByColumn}) = '', 'unknown', toString(${groupByColumn})) AS group_key`,
    `CASE
      WHEN ${ts}.CreatedAt >= {currentStart:DateTime64(3)} AND ${ts}.CreatedAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.CreatedAt >= {previousStart:DateTime64(3)} AND ${ts}.CreatedAt < {previousEnd:DateTime64(3)} THEN 'previous'
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
  cteSelectExprs.push(`${ts}.TotalCompletionTokenCount AS trace_completion_tokens`);

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
    const transformedExpr = transformMetricForDedup(metric.selectExpression, metric.alias);
    outerSelectExprs.push(transformedExpr);
  }

  // Build GROUP BY for outer query
  const outerGroupBy: string[] = ["period"];
  if (dateTrunc) {
    outerGroupBy.push("date");
  }
  outerGroupBy.push("group_key");

  const sql = `
    WITH deduped_traces AS (
      SELECT DISTINCT
        ${cteSelectExprs.join(",\n        ")}
      FROM trace_summaries ${ts} FINAL
      ${joinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
    )
    SELECT
      ${outerSelectExprs.join(",\n      ")}
    FROM deduped_traces
    WHERE period IS NOT NULL
    GROUP BY ${outerGroupBy.join(", ")}
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
    },
  };
}

/**
 * Transform a metric expression to work with deduplicated trace data.
 * count() becomes uniqExact(trace_id) to count distinct traces.
 * Sum/avg of trace-level values use the CTE columns.
 */
function transformMetricForDedup(selectExpression: string, alias: string): string {
  // Match patterns like "count() AS alias" or "count(*) AS alias"
  if (/\bcount\s*\(\s*\*?\s*\)/.test(selectExpression)) {
    return `uniqExact(trace_id) AS ${alias}`;
  }

  // Match "uniq(...)" or "cardinality" - these should become uniqExact(trace_id)
  if (/\buniq\s*\(/.test(selectExpression) || /\buniqExact\s*\(/.test(selectExpression)) {
    // For cardinality of trace_id, use uniqExact(trace_id)
    if (selectExpression.includes("TraceId")) {
      return `uniqExact(trace_id) AS ${alias}`;
    }
  }

  // For sum of TotalCost - use the CTE column
  // Handle both with and without coalesce wrapper
  if (selectExpression.includes("TotalCost")) {
    if (/\bsum\s*\(/.test(selectExpression)) {
      // Preserve coalesce wrapper if present
      if (/\bcoalesce\s*\(/.test(selectExpression)) {
        return `coalesce(sum(trace_total_cost), 0) AS ${alias}`;
      }
      return `sum(trace_total_cost) AS ${alias}`;
    }
    if (/\bavg\s*\(/.test(selectExpression)) {
      return `avg(trace_total_cost) AS ${alias}`;
    }
  }

  // For duration metrics
  if (selectExpression.includes("TotalDurationMs")) {
    if (/\bavg\s*\(/.test(selectExpression)) {
      return `avg(trace_duration_ms) AS ${alias}`;
    }
    if (/\bsum\s*\(/.test(selectExpression)) {
      if (/\bcoalesce\s*\(/.test(selectExpression)) {
        return `coalesce(sum(trace_duration_ms), 0) AS ${alias}`;
      }
      return `sum(trace_duration_ms) AS ${alias}`;
    }
    if (/\bmax\s*\(/.test(selectExpression)) {
      return `max(trace_duration_ms) AS ${alias}`;
    }
    if (/\bmin\s*\(/.test(selectExpression)) {
      return `min(trace_duration_ms) AS ${alias}`;
    }
    // Handle percentile aggregations
    if (/\bquantileTDigest\s*\(/.test(selectExpression)) {
      const percentileMatch = selectExpression.match(/quantileTDigest\s*\(\s*([\d.]+)\s*\)/);
      if (percentileMatch) {
        return `quantileTDigest(${percentileMatch[1]})(trace_duration_ms) AS ${alias}`;
      }
    }
  }

  // For token metrics
  if (selectExpression.includes("TotalPromptTokenCount") || selectExpression.includes("TotalCompletionTokenCount")) {
    if (/\bsum\s*\(/.test(selectExpression)) {
      const col = selectExpression.includes("TotalPromptTokenCount") ? "trace_prompt_tokens" : "trace_completion_tokens";
      if (/\bcoalesce\s*\(/.test(selectExpression)) {
        return `coalesce(sum(${col}), 0) AS ${alias}`;
      }
      return `sum(${col}) AS ${alias}`;
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
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const es = tableAliases.evaluation_states;

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
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ts}.TopicId IS NOT NULL
          AND ${ts}.TopicId != ''
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
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ts}.SubTopicId IS NOT NULL
          AND ${ts}.SubTopicId != ''
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
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['langwatch.user_id'] != ''
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
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['gen_ai.conversation.id'] != ''
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
        FROM trace_summaries ${ts} FINAL
        ${joins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ss}.SpanAttributes['gen_ai.request.model'] != ''
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
        FROM trace_summaries ${ts} FINAL
        ${joins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ss}.SpanAttributes['langwatch.span.type'] != ''
          ${searchQuery ? `AND ${ss}.SpanAttributes['langwatch.span.type'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "evaluations.evaluator_id":
    case "evaluations.evaluator_id.guardrails_only":
      joins = buildJoinClause("evaluation_states");
      sql = `
        SELECT
          ${es}.EvaluatorId AS field,
          concat('[', coalesce(${es}.EvaluatorName, ${es}.EvaluatorType, 'custom'), '] ', coalesce(${es}.EvaluatorName, '')) AS label,
          count() AS count
        FROM trace_summaries ${ts} FINAL
        ${joins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          ${field === "evaluations.evaluator_id.guardrails_only" ? `AND ${es}.IsGuardrail = 1` : ""}
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
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
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
      FROM trace_summaries ${ts} FINAL
      JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
      ARRAY JOIN JSONExtract(${ss}.SpanAttributes['langwatch.rag.contexts'], 'Array(JSON)') AS context
      WHERE ${ts}.TenantId = {tenantId:String}
        AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
        AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
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
    FROM trace_summaries ${ts} FINAL
    JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
    ARRAY JOIN JSONExtract(${ss}.SpanAttributes['langwatch.rag.contexts'], 'Array(JSON)') AS context
    WHERE ${ts}.TenantId = {tenantId:String}
      AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
      AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
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
    FROM trace_summaries ${ts} FINAL
    JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
    ARRAY JOIN
      ${ss}."Events.Timestamp" AS event_timestamp,
      ${ss}."Events.Name" AS event_name,
      ${ss}."Events.Attributes" AS event_attrs
    WHERE ${ts}.TenantId = {tenantId:String}
      AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
      AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
      AND event_name = 'thumbs_up_down'
      AND mapContains(event_attrs, 'feedback')
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
