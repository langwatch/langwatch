/**
 * AnalyticsService
 *
 * Clean app-layer service that queries the denormalized analytics fact tables
 * (analytics_trace_facts, analytics_evaluation_facts) to produce timeseries,
 * filter options, top documents, and feedback results.
 *
 * No legacy imports — this service is self-contained within the app-layer.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { addDays, differenceInCalendarDays } from "date-fns";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type {
  AnalyticsTimeseriesInput,
  AnalyticsSeriesInput,
  TimeseriesBucket,
  TimeseriesResult,
  FilterOption,
  TopDocument,
  FeedbackEvent,
} from "./analytics.types";
import {
  metricColumnMap,
  groupByColumnMap,
  filterColumnMap,
  factTableNames,
  type FactTable,
} from "./metric-column-map";

/** Resolver that returns the ClickHouse client for a project, or null if unavailable */
export type ClickHouseClientResolver = (
  projectId: string,
) => Promise<ClickHouseClient | null>;

/** ClickHouse query settings for analytics queries */
const QUERY_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};

/** Maximum number of timeseries buckets before auto-adjusting to daily granularity */
const MAX_TIMESERIES_BUCKETS = 1000;
/** Minutes in a day */
const MINUTES_PER_DAY = 24 * 60;
/** Milliseconds per minute */
const MS_PER_MINUTE = 1000 * 60;

/** ClickHouse quantile values for percentile aggregations */
const PERCENTILE_VALUES: Record<string, number> = {
  median: 0.5,
  p99: 0.99,
  p95: 0.95,
  p90: 0.9,
};

/**
 * AnalyticsService queries denormalized analytics fact tables.
 *
 * Produces timeseries, filter options, top documents, and feedback results.
 * All queries filter by TenantId and OccurredAt for partition pruning.
 */
export class AnalyticsService {
  private readonly logger = createLogger("langwatch:analytics:app-layer");
  private readonly tracer = getLangWatchTracer("langwatch.analytics.appLayer");

  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  // ==========================================================================
  // getTimeseries
  // ==========================================================================

  /**
   * Query timeseries data for one or more metric series, split into
   * current and previous periods for comparison.
   */
  async getTimeseries(
    input: AnalyticsTimeseriesInput,
  ): Promise<TimeseriesResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTimeseries",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        const client = await this.requireClient(input.projectId);

        const { previousPeriodStartDate, startDate, endDate } =
          this.computePeriodDates(input);

        const adjustedTimeScale = this.adjustTimeScale(
          input.timeScale,
          startDate,
          endDate,
        );

        const needsEvaluation = this.seriesNeedTable(
          input.series,
          "evaluation",
        );
        const needsTrace = this.seriesNeedTable(input.series, "trace");
        const groupByNeedsEvaluation =
          input.groupBy != null &&
          groupByColumnMap[input.groupBy]?.table === "evaluation";

        const { sql, params } = this.buildTimeseriesQuery({
          projectId: input.projectId,
          startDate,
          endDate,
          previousPeriodStartDate,
          series: input.series,
          filters: input.filters,
          groupBy: input.groupBy,
          groupByKey: input.groupByKey,
          timeScale: adjustedTimeScale,
          timeZone: input.timeZone,
          needsEvaluation: needsEvaluation || groupByNeedsEvaluation,
          needsTrace: needsTrace || !needsEvaluation,
        });

        this.logger.debug({ sql, params }, "Executing timeseries query");

        try {
          const result = await client.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            clickhouse_settings: QUERY_SETTINGS,
          });

          const rows = (await result.json()) as Array<Record<string, unknown>>;

          const parsed = this.parseTimeseriesResults(
            rows,
            input.series,
            input.groupBy,
            input.timeScale,
          );

          span.setAttribute("bucket.count", parsed.currentPeriod.length);
          return parsed;
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error, sql },
            "Failed to execute timeseries query",
          );
          throw error;
        }
      },
    );
  }

  // ==========================================================================
  // getFilterOptions
  // ==========================================================================

  /**
   * Query distinct values for a filter field, with counts, for populating
   * filter dropdowns in the UI.
   */
  async getFilterOptions(input: {
    projectId: string;
    field: string;
    startDate: number;
    endDate: number;
    key?: string;
    subkey?: string;
    searchQuery?: string;
  }): Promise<FilterOption[]> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getFilterOptions",
      { attributes: { "tenant.id": input.projectId, "filter.field": input.field } },
      async (span) => {
        const client = await this.requireClient(input.projectId);

        const mapping = filterColumnMap[input.field];
        if (!mapping) {
          this.logger.warn({ field: input.field }, "No filter column mapping found");
          return [];
        }

        const tableName = factTableNames[mapping.table];
        const alias = mapping.table === "trace" ? "tf" : "ef";
        const params: Record<string, unknown> = {
          tenantId: input.projectId,
          startDate: this.formatDateParam(new Date(input.startDate)),
          endDate: this.formatDateParam(new Date(input.endDate)),
        };

        let columnExpr: string;
        let fromClause: string;

        if (mapping.isArray) {
          columnExpr = `${mapping.column}_item`;
          fromClause = `${tableName} ${alias}\nARRAY JOIN ${alias}.${mapping.column} AS ${mapping.column}_item`;
        } else {
          columnExpr = `${alias}.${mapping.column}`;
          fromClause = `${tableName} ${alias}`;
        }

        let whereExtra = "";
        if (input.key && mapping.table === "evaluation") {
          params.filterKey = input.key;
          whereExtra += ` AND ${alias}.EvaluatorId = {filterKey:String}`;
        }

        if (input.searchQuery) {
          params.searchQuery = `%${input.searchQuery}%`;
          whereExtra += ` AND toString(${columnExpr}) ILIKE {searchQuery:String}`;
        }

        const sql = `
          SELECT
            toString(${columnExpr}) AS field,
            toString(${columnExpr}) AS label,
            count() AS count
          FROM ${fromClause}
          WHERE ${alias}.TenantId = {tenantId:String}
            AND ${alias}.OccurredAt >= {startDate:DateTime64(3)}
            AND ${alias}.OccurredAt <= {endDate:DateTime64(3)}
            AND ${columnExpr} != ''
            AND ${columnExpr} IS NOT NULL
            ${whereExtra}
          GROUP BY ${columnExpr}
          ORDER BY count DESC
          LIMIT 100
        `;

        try {
          const result = await client.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            clickhouse_settings: QUERY_SETTINGS,
          });

          const rows = (await result.json()) as Array<{
            field: string;
            label: string;
            count: string | number;
          }>;

          span.setAttribute("result.count", rows.length);

          return rows.map((row) => ({
            field: row.field,
            label: row.label,
            count:
              typeof row.count === "string"
                ? parseInt(row.count, 10)
                : row.count,
          }));
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error, sql },
            "Failed to execute filter options query",
          );
          throw error;
        }
      },
    );
  }

  // ==========================================================================
  // getTopDocuments
  // ==========================================================================

  /**
   * Query the most frequently used RAG documents within the given time range.
   */
  async getTopDocuments(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<{ documents: TopDocument[]; totalUnique: number }> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTopDocuments",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        const client = await this.requireClient(input.projectId);

        const params: Record<string, unknown> = {
          tenantId: input.projectId,
          startDate: this.formatDateParam(new Date(input.startDate)),
          endDate: this.formatDateParam(new Date(input.endDate)),
        };

        const topDocsSql = `
          SELECT
            doc_id AS documentId,
            count() AS count,
            any(tf.TraceId) AS traceId,
            any(doc_content) AS content
          FROM analytics_trace_facts tf
          ARRAY JOIN tf.RAGDocumentIds AS doc_id, tf.RAGDocumentContents AS doc_content
          WHERE tf.TenantId = {tenantId:String}
            AND tf.OccurredAt >= {startDate:DateTime64(3)}
            AND tf.OccurredAt <= {endDate:DateTime64(3)}
            AND doc_id != ''
          GROUP BY doc_id
          ORDER BY count DESC
          LIMIT 10
        `;

        const totalSql = `
          SELECT uniq(doc_id) AS total
          FROM analytics_trace_facts tf
          ARRAY JOIN tf.RAGDocumentIds AS doc_id
          WHERE tf.TenantId = {tenantId:String}
            AND tf.OccurredAt >= {startDate:DateTime64(3)}
            AND tf.OccurredAt <= {endDate:DateTime64(3)}
            AND doc_id != ''
        `;

        try {
          const [topDocsResult, totalResult] = await Promise.all([
            client.query({
              query: topDocsSql,
              query_params: params,
              format: "JSONEachRow",
              clickhouse_settings: QUERY_SETTINGS,
            }),
            client.query({
              query: totalSql,
              query_params: params,
              format: "JSONEachRow",
              clickhouse_settings: QUERY_SETTINGS,
            }),
          ]);

          const topDocs = (await topDocsResult.json()) as Array<{
            documentId: string;
            count: string | number;
            traceId: string;
            content?: string;
          }>;

          const totalRows = (await totalResult.json()) as Array<{
            total: string | number;
          }>;

          const total = totalRows[0]?.total ?? 0;

          span.setAttribute("document.count", topDocs.length);

          return {
            documents: topDocs.map((doc) => ({
              documentId: doc.documentId,
              count:
                typeof doc.count === "string"
                  ? parseInt(doc.count, 10)
                  : doc.count,
              traceId: doc.traceId,
              content: doc.content,
            })),
            totalUnique:
              typeof total === "string" ? parseInt(total, 10) : total,
          };
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error },
            "Failed to execute top documents query",
          );
          throw error;
        }
      },
    );
  }

  // ==========================================================================
  // getFeedbacks
  // ==========================================================================

  /**
   * Query feedback events (thumbs up/down) from trace facts.
   */
  async getFeedbacks(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<FeedbackEvent[]> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getFeedbacks",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        const client = await this.requireClient(input.projectId);

        const params: Record<string, unknown> = {
          tenantId: input.projectId,
          startDate: this.formatDateParam(new Date(input.startDate)),
          endDate: this.formatDateParam(new Date(input.endDate)),
        };

        const sql = `
          SELECT
            tf.TraceId AS trace_id,
            concat(tf.TraceId, '-feedback') AS event_id,
            toUnixTimestamp64Milli(tf.OccurredAt) AS started_at,
            'thumbs_up_down' AS event_type,
            tf.ThumbsUpDownVote AS vote
          FROM analytics_trace_facts tf
          WHERE tf.TenantId = {tenantId:String}
            AND tf.OccurredAt >= {startDate:DateTime64(3)}
            AND tf.OccurredAt <= {endDate:DateTime64(3)}
            AND tf.ThumbsUpDownVote IS NOT NULL
          ORDER BY tf.OccurredAt DESC
          LIMIT 1000
        `;

        try {
          const result = await client.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            clickhouse_settings: QUERY_SETTINGS,
          });

          const rows = (await result.json()) as Array<{
            trace_id: string;
            event_id: string;
            started_at: string | number;
            event_type: string;
            vote: number | null;
          }>;

          const events = rows.map((row) => {
            const startedAt =
              typeof row.started_at === "string"
                ? parseInt(row.started_at, 10)
                : row.started_at;

            const metrics: Array<{ key: string; value: number }> = [];
            if (row.vote != null) {
              metrics.push({ key: "vote", value: row.vote });
            }

            return {
              event_id: row.event_id,
              event_type: row.event_type,
              project_id: input.projectId,
              trace_id: row.trace_id,
              timestamps: {
                started_at: startedAt,
                inserted_at: startedAt,
                updated_at: startedAt,
              },
              metrics,
              event_details: [] as Array<{ key: string; value: string }>,
            };
          });

          span.setAttribute("event.count", events.length);
          return events;
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error },
            "Failed to execute feedbacks query",
          );
          throw error;
        }
      },
    );
  }

  // ==========================================================================
  // Private: Period Date Computation
  // ==========================================================================

  /**
   * Compute previous period start, current period start, and end dates
   * for comparison charts. Mirrors the logic from the analytics common utils.
   */
  private computePeriodDates(input: {
    startDate: number;
    endDate: number;
    timeScale?: number | "full";
  }): {
    previousPeriodStartDate: Date;
    startDate: Date;
    endDate: Date;
  } {
    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);

    const periodInDays =
      typeof input.timeScale === "number"
        ? input.timeScale / MINUTES_PER_DAY
        : 1;

    const daysDifference = Math.max(
      periodInDays,
      differenceInCalendarDays(endDate, startDate) + 1,
    );
    const previousPeriodStartDate = addDays(startDate, -daysDifference);

    return { previousPeriodStartDate, startDate, endDate };
  }

  /**
   * Adjust timeScale to avoid producing too many timeseries buckets.
   * Falls back to daily granularity if the estimated bucket count exceeds the limit.
   */
  private adjustTimeScale(
    timeScale: number | "full" | undefined,
    startDate: Date,
    endDate: Date,
  ): number | "full" | undefined {
    if (typeof timeScale === "number") {
      const totalMinutes =
        (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE;
      const estimatedBuckets = totalMinutes / timeScale;
      if (estimatedBuckets > MAX_TIMESERIES_BUCKETS) {
        return MINUTES_PER_DAY;
      }
      return timeScale;
    }
    if (timeScale === undefined) {
      return MINUTES_PER_DAY;
    }
    return timeScale;
  }

  // ==========================================================================
  // Private: Timeseries Query Building
  // ==========================================================================

  /**
   * Build the SQL query for getTimeseries.
   *
   * Handles:
   * - Simple metrics (trace count, avg cost, etc.)
   * - Metrics with key (evaluation score for specific evaluator)
   * - GroupBy on simple columns
   * - Previous/current period comparison
   * - timeScale "full" mode
   *
   * TODO: Pipeline aggregations (per-user, per-thread subqueries)
   * TODO: Array groupBy (ARRAY JOIN for labels, models, event types)
   * TODO: Event score/details metrics (ARRAY JOIN on score arrays)
   */
  private buildTimeseriesQuery({
    projectId,
    startDate,
    endDate,
    previousPeriodStartDate,
    series,
    filters,
    groupBy,
    groupByKey,
    timeScale,
    timeZone,
    needsEvaluation,
    needsTrace,
  }: {
    projectId: string;
    startDate: Date;
    endDate: Date;
    previousPeriodStartDate: Date;
    series: AnalyticsSeriesInput[];
    filters?: Record<string, unknown>;
    groupBy?: string;
    groupByKey?: string;
    timeScale?: number | "full";
    timeZone: string;
    needsEvaluation: boolean;
    needsTrace: boolean;
  }): { sql: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {
      tenantId: projectId,
      startDate: this.formatDateParam(previousPeriodStartDate),
      currentStartDate: this.formatDateParam(startDate),
      endDate: this.formatDateParam(endDate),
    };

    // Determine primary table and alias
    const usesJoin = needsEvaluation && needsTrace;
    const primaryTable: FactTable =
      needsEvaluation && !needsTrace ? "evaluation" : "trace";
    const primaryAlias = primaryTable === "trace" ? "tf" : "ef";
    const primaryTableName = factTableNames[primaryTable];

    // Build SELECT expressions
    const selectParts: string[] = [];

    // Period column
    if (timeScale === "full") {
      selectParts.push(
        `CASE WHEN ${primaryAlias}.OccurredAt < {currentStartDate:DateTime64(3)} THEN 'previous' ELSE 'current' END AS period`,
      );
    } else {
      const intervalMinutes =
        typeof timeScale === "number" ? timeScale : MINUTES_PER_DAY;
      params.intervalMinutes = intervalMinutes;
      selectParts.push(
        `toStartOfInterval(${primaryAlias}.OccurredAt, INTERVAL {intervalMinutes:UInt32} MINUTE, {timeZone:String}) AS date`,
      );
      selectParts.push(
        `CASE WHEN ${primaryAlias}.OccurredAt < {currentStartDate:DateTime64(3)} THEN 'previous' ELSE 'current' END AS period`,
      );
      params.timeZone = timeZone;
    }

    // GroupBy column
    let groupByExpr: string | null = null;
    if (groupBy) {
      const groupMapping = groupByColumnMap[groupBy];
      if (groupMapping) {
        const groupAlias = groupMapping.table === "trace" ? "tf" : "ef";

        if (groupMapping.isArray) {
          // TODO: ARRAY JOIN for array groupBy columns
          // For now, fall back to toString of the array
          groupByExpr = `toString(${groupAlias}.${groupMapping.column})`;
        } else {
          groupByExpr = `toString(${groupAlias}.${groupMapping.column})`;
        }

        selectParts.push(`${groupByExpr} AS group_key`);
      }
    }

    // Metric aggregation expressions
    for (let i = 0; i < series.length; i++) {
      const s = series[i]!;
      const alias = this.buildMetricAlias(i, s);
      const aggExpr = this.buildAggregationExpression({
        series: s,
        index: i,
        params,
        primaryAlias,
        usesJoin,
      });
      selectParts.push(`${aggExpr} AS ${alias}`);
    }

    // Build FROM clause
    let fromClause = `${primaryTableName} ${primaryAlias}`;
    if (usesJoin) {
      const secondaryTable: FactTable =
        primaryTable === "trace" ? "evaluation" : "trace";
      const secondaryAlias = secondaryTable === "trace" ? "tf" : "ef";
      const secondaryTableName = factTableNames[secondaryTable];
      fromClause += `\nJOIN ${secondaryTableName} ${secondaryAlias} ON ${primaryAlias}.TenantId = ${secondaryAlias}.TenantId AND ${primaryAlias}.TraceId = ${secondaryAlias}.TraceId`;
    }

    // Build WHERE clause
    const whereParts: string[] = [
      `${primaryAlias}.TenantId = {tenantId:String}`,
      `${primaryAlias}.OccurredAt >= {startDate:DateTime64(3)}`,
      `${primaryAlias}.OccurredAt <= {endDate:DateTime64(3)}`,
    ];

    // Apply shared filters
    const filterClauses = this.buildFilterWhereClauses({
      filters: (filters as Record<string, unknown>) ?? {},
      params,
      alias: primaryAlias,
      primaryTable,
    });
    if (filterClauses) {
      whereParts.push(filterClauses.replace(/^\s*AND\s*/, ""));
    }

    // Apply groupByKey filter (for evaluations with evaluator filter)
    if (groupByKey && groupBy) {
      const groupMapping = groupByColumnMap[groupBy];
      if (groupMapping) {
        const gAlias = groupMapping.table === "trace" ? "tf" : "ef";
        if (
          groupBy.startsWith("evaluations.") &&
          groupMapping.table === "evaluation"
        ) {
          params.groupByKey = groupByKey;
          whereParts.push(`${gAlias}.EvaluatorId = {groupByKey:String}`);
        }
      }
    }

    // Build GROUP BY
    const groupByParts: string[] = [];
    if (timeScale !== "full") {
      groupByParts.push("date");
    }
    groupByParts.push("period");
    if (groupByExpr) {
      groupByParts.push("group_key");
    }

    const sql = `
      SELECT
        ${selectParts.join(",\n        ")}
      FROM ${fromClause}
      WHERE ${whereParts.join("\n        AND ")}
      GROUP BY ${groupByParts.join(", ")}
      ORDER BY ${timeScale === "full" ? "period" : "date, period"}
    `;

    return { sql, params };
  }

  // ==========================================================================
  // Private: Aggregation Expression Building
  // ==========================================================================

  /**
   * Build the aggregation expression for a single series metric.
   *
   * Maps aggregation types to ClickHouse functions:
   * - avg, sum, min, max: direct aggregation
   * - cardinality, terms: uniq()
   * - median, p99, p95, p90: quantileExact()
   *
   * For evaluation metrics with a key (evaluatorId), applies conditional
   * aggregation using the *If suffix pattern.
   */
  private buildAggregationExpression({
    series,
    index,
    params,
    primaryAlias,
    usesJoin,
  }: {
    series: AnalyticsSeriesInput;
    index: number;
    params: Record<string, unknown>;
    primaryAlias: string;
    usesJoin: boolean;
  }): string {
    const mapping = metricColumnMap[series.metric];
    if (!mapping) {
      this.logger.warn(
        { metric: series.metric },
        "No metric column mapping found, defaulting to count",
      );
      return `count()`;
    }

    const tableAlias = mapping.table === "trace" ? "tf" : "ef";
    if (tableAlias !== primaryAlias && !usesJoin) {
      this.logger.warn(
        { metric: series.metric, table: mapping.table, primaryAlias },
        "Metric requires table not in query, falling back to count",
      );
      return `count()`;
    }

    const columnExpr = mapping.column.startsWith("(")
      ? mapping.column
      : `${tableAlias}.${mapping.column}`;

    // Handle pipeline aggregations (per-user, per-thread)
    if (series.pipeline) {
      // TODO: Implement proper pipeline aggregations with subqueries.
      // For now, fall back to simple aggregation as a reasonable approximation.
      this.logger.debug(
        { metric: series.metric, pipeline: series.pipeline },
        "Pipeline aggregation not yet fully implemented, using simple fallback",
      );
      return this.buildSimpleAggregation(
        columnExpr,
        series.aggregation,
        mapping.isIdentity,
      );
    }

    // Handle key-filtered evaluation metrics (e.g., evaluation score for specific evaluator)
    if (series.key && mapping.table === "evaluation") {
      const keyParam = `metric_key_${index}`;
      params[keyParam] = series.key;
      return this.buildConditionalAggregation(
        columnExpr,
        series.aggregation,
        `${tableAlias}.EvaluatorId = {${keyParam}:String}`,
      );
    }

    // Handle key-filtered trace metrics (e.g., event_type with specific type)
    if (series.key && series.metric === "events.event_type") {
      const keyParam = `metric_key_${index}`;
      params[keyParam] = series.key;
      return this.buildConditionalAggregation(
        `${tableAlias}.TraceId`,
        "cardinality",
        `has(${tableAlias}.EventTypes, {${keyParam}:String})`,
      );
    }

    // Simple aggregation
    return this.buildSimpleAggregation(
      columnExpr,
      series.aggregation,
      mapping.isIdentity,
    );
  }

  /**
   * Build a simple aggregation expression (no condition).
   */
  private buildSimpleAggregation(
    columnExpr: string,
    aggregation: string,
    isIdentity?: boolean,
  ): string {
    if (isIdentity) {
      return `uniq(${columnExpr})`;
    }

    switch (aggregation) {
      case "avg":
        return `avg(${columnExpr})`;
      case "sum":
        return `coalesce(sum(${columnExpr}), 0)`;
      case "min":
        return `min(${columnExpr})`;
      case "max":
        return `max(${columnExpr})`;
      case "cardinality":
      case "terms":
        return `uniq(${columnExpr})`;
      default: {
        const percentile = PERCENTILE_VALUES[aggregation];
        if (percentile !== undefined) {
          return `quantileExact(${percentile})(${columnExpr})`;
        }
        return `count(${columnExpr})`;
      }
    }
  }

  /**
   * Build a conditional aggregation expression (with ClickHouse *If suffix).
   */
  private buildConditionalAggregation(
    columnExpr: string,
    aggregation: string,
    condition: string,
  ): string {
    switch (aggregation) {
      case "avg":
        return `avgIf(${columnExpr}, ${condition})`;
      case "sum":
        return `coalesce(sumIf(${columnExpr}, ${condition}), 0)`;
      case "min":
        return `minIf(${columnExpr}, ${condition})`;
      case "max":
        return `maxIf(${columnExpr}, ${condition})`;
      case "cardinality":
      case "terms":
        return `uniqIf(${columnExpr}, ${condition})`;
      default: {
        const percentile = PERCENTILE_VALUES[aggregation];
        if (percentile !== undefined) {
          return `quantileExactIf(${percentile})(${columnExpr}, ${condition})`;
        }
        return `countIf(${columnExpr}, ${condition})`;
      }
    }
  }

  // ==========================================================================
  // Private: Timeseries Result Parsing
  // ==========================================================================

  /**
   * Parse ClickHouse rows into the TimeseriesResult format expected by the frontend.
   */
  private parseTimeseriesResults(
    rows: Array<Record<string, unknown>>,
    series: AnalyticsSeriesInput[],
    groupBy?: string,
    timeScale?: number | "full",
  ): TimeseriesResult {
    const bucketMap = {
      previous: new Map<string, TimeseriesBucket>(),
      current: new Map<string, TimeseriesBucket>(),
    };

    for (const row of rows) {
      const period = row.period as string;
      const dateKey =
        timeScale === "full"
          ? "full"
          : ((row.date as string) ?? new Date().toISOString());

      const targetMap =
        period === "current" ? bucketMap.current : bucketMap.previous;

      let bucket = targetMap.get(dateKey);
      if (!bucket) {
        bucket = { date: dateKey };
        targetMap.set(dateKey, bucket);
      }

      if (groupBy && row.group_key !== undefined && row.group_key !== null) {
        const groupKey = String(row.group_key);
        if (!bucket[groupBy]) {
          bucket[groupBy] = {};
        }
        const groupData = bucket[groupBy] as Record<
          string,
          Record<string, number>
        >;
        if (!groupData[groupKey]) {
          groupData[groupKey] = {};
        }

        for (let i = 0; i < series.length; i++) {
          const s = series[i]!;
          const alias = this.buildMetricAlias(i, s);
          const seriesName = this.buildSeriesName(s, i);
          const value = row[alias];
          if (value !== undefined && value !== null) {
            groupData[groupKey]![seriesName] = Number(value);
          }
        }
      } else {
        for (let i = 0; i < series.length; i++) {
          const s = series[i]!;
          const alias = this.buildMetricAlias(i, s);
          const seriesName = this.buildSeriesName(s, i);
          const value = row[alias];
          if (value !== undefined && value !== null) {
            bucket[seriesName] = Number(value);
          }
        }
      }
    }

    // Convert maps to sorted arrays
    const previousPeriod: TimeseriesBucket[] = [];
    const currentPeriod: TimeseriesBucket[] = [];

    for (const [, bucket] of Array.from(bucketMap.previous.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      previousPeriod.push(bucket);
    }
    for (const [, bucket] of Array.from(bucketMap.current.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      currentPeriod.push(bucket);
    }

    // Trim previous period to not exceed current period length
    const correctedPrevious = previousPeriod.slice(
      Math.max(0, previousPeriod.length - currentPeriod.length),
    );

    // Fill missing metric keys with 0 across both periods
    this.normalizeMetricKeys(correctedPrevious, currentPeriod, groupBy);

    return {
      previousPeriod: correctedPrevious,
      currentPeriod,
    };
  }

  /**
   * Build the series name key for result buckets.
   * Format: "{index}/{metric}/{aggregation}" or with key/pipeline variants.
   * Must match what the frontend expects.
   */
  buildSeriesName(series: AnalyticsSeriesInput, index: number): string {
    const aggregation =
      series.aggregation === "terms" ? "cardinality" : series.aggregation;

    if (series.pipeline) {
      return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
    }

    if (series.key) {
      return `${index}/${series.metric}/${aggregation}/${series.key}`;
    }

    return `${index}/${series.metric}/${aggregation}`;
  }

  /**
   * Build the metric alias used in SQL SELECT AS and result row keys.
   * Must be a valid SQL identifier.
   */
  private buildMetricAlias(index: number, series: AnalyticsSeriesInput): string {
    const parts = [
      index.toString(),
      series.metric.replace(/\./g, "_"),
      series.aggregation,
    ];
    if (series.key) parts.push(series.key.replace(/[^a-zA-Z0-9]/g, "_"));
    if (series.subkey) parts.push(series.subkey.replace(/[^a-zA-Z0-9]/g, "_"));
    return parts.join("__");
  }

  /**
   * Normalize metric keys across both periods so all buckets have all metrics.
   * This ensures charts don't have gaps where data is missing from one period.
   */
  private normalizeMetricKeys(
    previousPeriod: TimeseriesBucket[],
    currentPeriod: TimeseriesBucket[],
    groupBy?: string,
  ): void {
    const allMetricKeys = new Set<string>();
    const allGroupedMetricSubKeys = new Set<string>();

    for (const bucket of [...previousPeriod, ...currentPeriod]) {
      for (const key of Object.keys(bucket)) {
        if (key === "date") continue;

        const value = bucket[key];

        if (
          groupBy &&
          key === groupBy &&
          typeof value === "object" &&
          value !== null
        ) {
          const groupData = value as Record<string, Record<string, number>>;
          for (const metrics of Object.values(groupData)) {
            for (const metricKey of Object.keys(metrics)) {
              allGroupedMetricSubKeys.add(metricKey);
            }
          }
        } else {
          allMetricKeys.add(key);
        }
      }
    }

    for (const bucket of [...previousPeriod, ...currentPeriod]) {
      for (const key of allMetricKeys) {
        if (bucket[key] === undefined) {
          bucket[key] = 0;
        }
      }

      if (groupBy && bucket[groupBy] && typeof bucket[groupBy] === "object") {
        const groupData = bucket[groupBy] as Record<
          string,
          Record<string, number>
        >;

        for (const groupKey of Object.keys(groupData)) {
          for (const metricKey of allGroupedMetricSubKeys) {
            if (groupData[groupKey]![metricKey] === undefined) {
              groupData[groupKey]![metricKey] = 0;
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // Private: Filter Building
  // ==========================================================================

  /**
   * Build WHERE clause fragments from the shared filter input.
   * Handles simple equality filters and array membership (has()) filters.
   * Returns a string of " AND ..." clauses or empty string.
   */
  private buildFilterWhereClauses({
    filters,
    params,
    alias,
    primaryTable,
  }: {
    filters: Record<string, unknown>;
    params: Record<string, unknown>;
    alias: string;
    primaryTable: FactTable;
  }): string {
    const clauses: string[] = [];
    let paramIdx = 0;

    for (const [field, value] of Object.entries(filters)) {
      if (!value) continue;

      const mapping = filterColumnMap[field];
      if (!mapping) continue;

      const values = this.flattenFilterValues(value);
      if (values.length === 0) continue;

      const filterAlias =
        mapping.table === primaryTable
          ? alias
          : mapping.table === "trace"
            ? "tf"
            : "ef";

      const paramName = `filter_${paramIdx++}`;
      params[paramName] = values;

      if (mapping.isArray) {
        clauses.push(
          `hasAny(${filterAlias}.${mapping.column}, {${paramName}:Array(String)})`,
        );
      } else {
        if (values.length === 1) {
          const singleParam = `${paramName}_single`;
          params[singleParam] = values[0];
          clauses.push(
            `${filterAlias}.${mapping.column} = {${singleParam}:String}`,
          );
        } else {
          clauses.push(
            `${filterAlias}.${mapping.column} IN {${paramName}:Array(String)}`,
          );
        }
      }
    }

    if (clauses.length === 0) return "";
    return " AND " + clauses.join(" AND ");
  }

  /**
   * Flatten nested filter value structures to a flat string array.
   *
   * Filters can be:
   * - string[] — simple values
   * - Record<string, string[]> — keyed values (e.g., evaluator_id -> [values])
   * - Record<string, Record<string, string[]>> — double-keyed
   */
  private flattenFilterValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value as string[];
    }

    if (typeof value === "object" && value !== null) {
      const results: string[] = [];
      for (const v of Object.values(value)) {
        results.push(...this.flattenFilterValues(v));
      }
      return results;
    }

    return [];
  }

  // ==========================================================================
  // Private: Helpers
  // ==========================================================================

  /**
   * Check if any series in the input requires a specific fact table.
   */
  private seriesNeedTable(
    series: AnalyticsSeriesInput[],
    table: FactTable,
  ): boolean {
    return series.some((s) => {
      const mapping = metricColumnMap[s.metric];
      return mapping?.table === table;
    });
  }

  /**
   * Resolve the ClickHouse client or throw if unavailable.
   */
  private async requireClient(projectId: string): Promise<ClickHouseClient> {
    const client = await this.resolveClient(projectId);
    if (!client) {
      throw new Error("ClickHouse client not available");
    }
    return client;
  }

  /**
   * Format a Date as a ClickHouse DateTime64(3) parameter string.
   */
  private formatDateParam(date: Date): string {
    return date.toISOString().replace("T", " ").replace("Z", "");
  }
}
