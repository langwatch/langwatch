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
): { column: string; requiredJoins: CHTable[] } {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const es = tableAliases.evaluation_states;

  switch (groupBy) {
    case "topics.topics":
      return { column: `${ts}.TopicId`, requiredJoins: [] };

    case "metadata.user_id":
      return {
        column: `${ts}.Attributes['user.id']`,
        requiredJoins: [],
      };

    case "metadata.thread_id":
      return {
        column: `${ts}.Attributes['thread.id']`,
        requiredJoins: [],
      };

    case "metadata.customer_id":
      return {
        column: `${ts}.Attributes['customer.id']`,
        requiredJoins: [],
      };

    case "metadata.labels":
      return {
        column: `arrayJoin(JSONExtract(${ts}.Attributes['langwatch.labels'], 'Array(String)'))`,
        requiredJoins: [],
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
  if (input.groupBy) {
    const groupByExpr = getGroupByExpression(input.groupBy, input.groupByKey);
    groupByColumn = groupByExpr.column;
    for (const join of groupByExpr.requiredJoins) {
      allJoins.add(join);
    }
  }

  // Build JOIN clauses
  const joinClauses = Array.from(allJoins)
    .map((table) => buildJoinClause(table))
    .join("\n");

  // Build SELECT expressions
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
    selectExprs.push(`if(${groupByColumn} = '' OR ${groupByColumn} IS NULL, 'unknown', ${groupByColumn}) AS group_key`);
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
          ${ts}.Attributes['user.id'] AS field,
          ${ts}.Attributes['user.id'] AS label,
          count() AS count
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['user.id'] != ''
          ${searchQuery ? `AND ${ts}.Attributes['user.id'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "metadata.thread_id":
      sql = `
        SELECT
          ${ts}.Attributes['thread.id'] AS field,
          ${ts}.Attributes['thread.id'] AS label,
          count() AS count
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['thread.id'] != ''
          ${searchQuery ? `AND ${ts}.Attributes['thread.id'] ILIKE {searchQuery:String}` : ""}
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
          if(${ts}.ContainsErrorStatus = 1, 'true', 'false') AS field,
          if(${ts}.ContainsErrorStatus = 1, 'Traces with error', 'Traces without error') AS label,
          count() AS count
        FROM trace_summaries ${ts} FINAL
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.CreatedAt >= {startDate:DateTime64(3)}
          AND ${ts}.CreatedAt < {endDate:DateTime64(3)}
        GROUP BY ${ts}.ContainsErrorStatus
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
        JSONExtractString(context, 'document_id') AS document_id,
        JSONExtractString(context, 'content') AS content
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
    SELECT uniq(JSONExtractString(context, 'document_id')) AS total
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
