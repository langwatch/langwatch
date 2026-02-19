/**
 * Metric Translator - Converts ES metric definitions to ClickHouse SQL expressions.
 *
 * This module translates the ES aggregation patterns used in analytics metrics
 * to equivalent ClickHouse SQL expressions.
 */

import type {
  AggregationTypes,
  PercentileAggregationTypes,
  PipelineAggregationTypes,
} from "../types";
import {
  type CHTable,
  getFieldMapping,
  qualifiedColumn,
  tableAliases,
} from "./field-mappings";

/**
 * Maximum thread session duration in milliseconds (3 hours).
 *
 * WHY: Sessions longer than 3 hours are capped to prevent outliers
 * (e.g., tabs left open overnight) from skewing average duration metrics.
 * This matches the Elasticsearch behavior for consistency during migration.
 */
const MAX_THREAD_SESSION_DURATION_MS = 3 * 60 * 60 * 1000; // 10800000ms = 3 hours

/**
 * Generate a unique parameter name for metrics using random suffix.
 * Uses 'm_' prefix to avoid collisions with filter params.
 */
function genMetricParamName(prefix: string): string {
  // Use first 8 chars of random UUID for uniqueness without excessive length
  const suffix = crypto.randomUUID().slice(0, 8);
  return `m_${prefix}_${suffix}`;
}

/**
 * Result of translating an ES metric to CH SQL
 */
export interface MetricTranslation {
  /** The SELECT expression (e.g., "avg(TotalDurationMs)") */
  selectExpression: string;
  /** Alias for the result column */
  alias: string;
  /** Tables that need to be JOINed */
  requiredJoins: CHTable[];
  /** Parameter values for parameterized queries */
  params: Record<string, unknown>;
  /** Additional GROUP BY expressions if needed */
  groupByExpression?: string;
  /** Whether this metric requires a subquery (e.g., pipeline aggregations) */
  requiresSubquery?: boolean;
  /** Subquery definition if required */
  subquery?: {
    innerSelect: string;
    innerGroupBy: string;
    outerAggregation: string;
    /** For 3-level aggregations (e.g., avg thread duration per user) */
    nestedSubquery?: {
      select: string;
      groupBy: string;
      having?: string;
    };
  };
}

/**
 * Percentile values for aggregation types
 */
export const percentileToPercent: Record<PercentileAggregationTypes, number> = {
  median: 0.5,
  p99: 0.99,
  p95: 0.95,
  p90: 0.9,
};

/**
 * Check if aggregation type is a percentile
 */
export function isPercentileAggregation(
  agg: AggregationTypes,
): agg is PercentileAggregationTypes {
  return ["median", "p99", "p95", "p90"].includes(agg);
}

/**
 * Get the ClickHouse conditional aggregation function name.
 * Maps ES aggregation names to their CH "*If" counterparts.
 * Special cases:
 * - cardinality -> uniqIf (cardinalityIf doesn't exist)
 * - terms -> uniqIf (terms is also a cardinality operation)
 */
function getConditionalAggregation(aggregation: AggregationTypes): string {
  switch (aggregation) {
    case "cardinality":
    case "terms":
      return "uniqIf";
    default:
      return `${aggregation}If`;
  }
}

/**
 * Translate a simple numeric aggregation (avg, sum, min, max)
 */
function translateSimpleAggregation(
  columnExpr: string,
  aggregation: AggregationTypes,
  alias: string,
): string {
  switch (aggregation) {
    case "avg":
      return `avg(${columnExpr}) AS ${alias}`;
    case "sum":
      // Use COALESCE to return 0 instead of null to match ES behavior
      return `coalesce(sum(${columnExpr}), 0) AS ${alias}`;
    case "min":
      return `min(${columnExpr}) AS ${alias}`;
    case "max":
      return `max(${columnExpr}) AS ${alias}`;
    case "cardinality":
      return `uniq(${columnExpr}) AS ${alias}`;
    case "terms":
      // Terms aggregation in ES counts unique values - use uniq in CH
      return `uniq(${columnExpr}) AS ${alias}`;
    default:
      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        // Use quantileExact for accurate percentiles (matching ES behavior)
        // quantileTDigest is faster but has ±5% error at distribution extremes
        return `quantileExact(${percentile})(${columnExpr}) AS ${alias}`;
      }
      return `count(${columnExpr}) AS ${alias}`;
  }
}

/**
 * Translate aggregation for array expressions.
 * Uses ClickHouse array functions (arraySum, arrayAvg, etc.)
 * to aggregate values extracted from arrays.
 */
function translateArrayAggregation(
  arrayExpr: string,
  aggregation: AggregationTypes,
  alias: string,
): string {
  switch (aggregation) {
    case "avg":
      // Flatten arrays across rows and compute average
      return `avgArray(${arrayExpr}) AS ${alias}`;
    case "sum":
      // Sum all values from arrays across rows
      return `coalesce(sumArray(${arrayExpr}), 0) AS ${alias}`;
    case "min":
      return `minArray(${arrayExpr}) AS ${alias}`;
    case "max":
      return `maxArray(${arrayExpr}) AS ${alias}`;
    case "cardinality":
      // Count distinct values across all arrays
      return `uniqArray(${arrayExpr}) AS ${alias}`;
    case "terms":
      return `uniqArray(${arrayExpr}) AS ${alias}`;
    default:
      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        // Use quantilesExactArray for percentiles on arrays
        return `quantileExactArray(${percentile})(${arrayExpr}) AS ${alias}`;
      }
      // Default to counting array elements
      return `sum(length(${arrayExpr})) AS ${alias}`;
  }
}

/**
 * Build alias for a metric aggregation
 */
export function buildMetricAlias(
  index: number,
  metric: string,
  aggregation: AggregationTypes,
  key?: string,
  subkey?: string,
): string {
  const parts = [index.toString(), metric.replace(/\./g, "_"), aggregation];
  if (key) parts.push(key.replace(/[^a-zA-Z0-9]/g, "_"));
  if (subkey) parts.push(subkey.replace(/[^a-zA-Z0-9]/g, "_"));
  return parts.join("__");
}

/**
 * Translate a metric definition to ClickHouse SQL.
 *
 * WHY PREFIX-BASED ROUTING: Metrics are organized by category prefix
 * (metadata.*, performance.*, evaluations.*, events.*, sentiment.*, threads.*)
 * to mirror the ES aggregation structure. Each category may require different
 * JOINs and has different column mappings. The prefix routing ensures each
 * metric type gets its specialized translation logic.
 */
export function translateMetric(
  metric: string,
  aggregation: AggregationTypes,
  index: number,
  key?: string,
  subkey?: string,
): MetricTranslation {
  const alias = buildMetricAlias(index, metric, aggregation, key, subkey);
  const requiredJoins: CHTable[] = [];

  // Handle specific metric categories
  if (metric.startsWith("metadata.")) {
    return translateMetadataMetric(metric, aggregation, alias, requiredJoins);
  }

  if (metric.startsWith("performance.")) {
    return translatePerformanceMetric(metric, aggregation, alias, requiredJoins);
  }

  if (metric.startsWith("evaluations.")) {
    return translateEvaluationMetric(
      metric,
      aggregation,
      alias,
      requiredJoins,
      key,
    );
  }

  if (metric.startsWith("events.")) {
    return translateEventMetric(
      metric,
      aggregation,
      alias,
      requiredJoins,
      key,
      subkey,
    );
  }

  if (metric.startsWith("sentiment.")) {
    return translateSentimentMetric(metric, aggregation, alias, requiredJoins);
  }

  if (metric.startsWith("threads.")) {
    return translateThreadsMetric(metric, aggregation, alias, requiredJoins);
  }

  // Default: try to map directly
  const mapping = getFieldMapping(metric);
  if (mapping) {
    const column = qualifiedColumn(metric);
    if (mapping.table !== "trace_summaries") {
      requiredJoins.push(mapping.table);
    }
    return {
      selectExpression: translateSimpleAggregation(column, aggregation, alias),
      alias,
      requiredJoins,
      params: {},
    };
  }

  // Fallback for unknown metrics
  return {
    selectExpression: `count() AS ${alias}`,
    alias,
    requiredJoins,
    params: {},
  };
}

/**
 * Translate metadata metrics (trace_id, user_id, thread_id, span_type)
 */
function translateMetadataMetric(
  metric: string,
  aggregation: AggregationTypes,
  alias: string,
  requiredJoins: CHTable[],
): MetricTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  switch (metric) {
    case "metadata.trace_id":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TraceId`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "metadata.user_id":
      // For cardinality, filter out empty/null user_ids to match ES terms aggregation behavior
      if (aggregation === "cardinality") {
        return {
          selectExpression: `uniqIf(${ts}.Attributes['langwatch.user_id'], ${ts}.Attributes['langwatch.user_id'] != '') AS ${alias}`,
          alias,
          requiredJoins,
          params: {},
        };
      }
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.Attributes['langwatch.user_id']`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "metadata.thread_id":
      // For cardinality, filter out empty/null thread_ids to match ES terms aggregation behavior
      if (aggregation === "cardinality") {
        return {
          selectExpression: `uniqIf(${ts}.Attributes['gen_ai.conversation.id'], ${ts}.Attributes['gen_ai.conversation.id'] != '') AS ${alias}`,
          alias,
          requiredJoins,
          params: {},
        };
      }
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.Attributes['gen_ai.conversation.id']`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "metadata.span_type":
      // Requires JOIN with stored_spans
      // Use the requested aggregation on TraceId to match ES behavior
      requiredJoins.push("stored_spans");
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TraceId`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };
  }
}

/**
 * Translate performance metrics
 */
function translatePerformanceMetric(
  metric: string,
  aggregation: AggregationTypes,
  alias: string,
  requiredJoins: CHTable[],
): MetricTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  switch (metric) {
    case "performance.completion_time":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TotalDurationMs`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "performance.first_token":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TimeToFirstTokenMs`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "performance.total_cost":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TotalCost`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "performance.prompt_tokens":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TotalPromptTokenCount`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "performance.completion_tokens":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TotalCompletionTokenCount`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "performance.total_tokens":
      // Sum of prompt + completion tokens
      return {
        selectExpression: translateSimpleAggregation(
          `(coalesce(${ts}.TotalPromptTokenCount, 0) + coalesce(${ts}.TotalCompletionTokenCount, 0))`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "performance.tokens_per_second": {
      // Calculate per-span TPS matching ES behavior:
      // ES computes TPS for each LLM span individually, then averages them.
      // Only include spans that have output_tokens > 0 (ES returns null for 0 tokens)
      // TPS = output_tokens / (DurationMs / 1000)
      //
      // Note: Uses canonical OTel attribute name (gen_ai.usage.output_tokens)
      // which is canonicalized from legacy gen_ai.usage.completion_tokens
      requiredJoins.push("stored_spans");
      const outputTokens = `toFloat64OrNull(${ss}.SpanAttributes['gen_ai.usage.output_tokens'])`;
      const spanTps = `${outputTokens} / nullIf(${ss}.DurationMs / 1000.0, 0)`;
      const hasTokens = `${outputTokens} > 0 AND ${ss}.DurationMs > 0`;

      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        return {
          selectExpression: `quantileExactIf(${percentile})(${spanTps}, ${hasTokens}) AS ${alias}`,
          alias,
          requiredJoins,
          params: {},
        };
      }
      return {
        selectExpression: `${getConditionalAggregation(aggregation)}(${spanTps}, ${hasTokens}) AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };
    }

    case "spans.metrics.prompt_tokens":
      // Span-level prompt tokens (for grouping by span-level attributes like model)
      // Uses canonical OTel name: gen_ai.usage.input_tokens
      requiredJoins.push("stored_spans");
      return {
        selectExpression: translateSimpleAggregation(
          `toFloat64OrNull(${ss}.SpanAttributes['gen_ai.usage.input_tokens'])`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "spans.metrics.completion_tokens":
      // Span-level completion tokens (for grouping by span-level attributes like model)
      // Uses canonical OTel name: gen_ai.usage.output_tokens
      requiredJoins.push("stored_spans");
      return {
        selectExpression: translateSimpleAggregation(
          `toFloat64OrNull(${ss}.SpanAttributes['gen_ai.usage.output_tokens'])`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };
  }
}

/**
 * Translate evaluation metrics
 */
function translateEvaluationMetric(
  metric: string,
  aggregation: AggregationTypes,
  alias: string,
  requiredJoins: CHTable[],
  evaluatorId?: string,
): MetricTranslation {
  requiredJoins.push("evaluation_runs");
  const es = tableAliases.evaluation_runs;

  // Build evaluator filter condition with parameterized query to prevent SQL injection
  const params: Record<string, unknown> = {};
  let evaluatorCondition = "1=1";
  if (evaluatorId) {
    const evalIdParam = genMetricParamName("evaluatorId");
    evaluatorCondition = `${es}.EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  switch (metric) {
    case "evaluations.evaluation_score":
      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        return {
          selectExpression: `quantileExactIf(${percentile})(${es}.Score, ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
          alias,
          requiredJoins,
          params,
        };
      }
      return {
        selectExpression: `${getConditionalAggregation(aggregation)}(${es}.Score, ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
        alias,
        requiredJoins,
        params,
      };

    case "evaluations.evaluation_pass_rate":
      // Calculate pass rate as average of passed (0/1)
      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        return {
          selectExpression: `quantileExactIf(${percentile})(toFloat64(${es}.Passed), ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
          alias,
          requiredJoins,
          params,
        };
      }
      return {
        selectExpression: `${getConditionalAggregation(aggregation)}(toFloat64(${es}.Passed), ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
        alias,
        requiredJoins,
        params,
      };

    case "evaluations.evaluation_runs":
      return {
        selectExpression: `uniqIf(${es}.EvaluationId, ${evaluatorCondition}) AS ${alias}`,
        alias,
        requiredJoins,
        params,
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
        params,
      };
  }
}

/**
 * Translate event metrics (event_type, event_score, event_details)
 */
function translateEventMetric(
  metric: string,
  aggregation: AggregationTypes,
  alias: string,
  requiredJoins: CHTable[],
  eventType?: string,
  metricKey?: string,
): MetricTranslation {
  requiredJoins.push("stored_spans");
  const ss = tableAliases.stored_spans;

  switch (metric) {
    case "events.event_type": {
      // Count events of a specific type using parameterized query
      const params: Record<string, unknown> = {};
      let typeCondition: string;

      if (eventType) {
        const eventTypeParam = genMetricParamName("eventType");
        typeCondition = `has(${ss}."Events.Name", {${eventTypeParam}:String})`;
        params[eventTypeParam] = eventType;
      } else {
        typeCondition = `length(${ss}."Events.Name") > 0`;
      }

      return {
        selectExpression: `countIf(${typeCondition}) AS ${alias}`,
        alias,
        requiredJoins,
        params,
      };
    }

    case "events.event_score": {
      // Extract score values from Events.Attributes and apply aggregation
      // Events.Attributes is Array(Map(String, String))
      // Score is stored in 'event.metrics.score' key
      // Use paired arrayFilter to correlate event type with its attributes
      // Using parameterized queries to prevent SQL injection
      const params: Record<string, unknown> = {};
      const scoreKeyParam = genMetricParamName("scoreKey");
      params[scoreKeyParam] = metricKey ?? "event.metrics.score";

      let scoreExtraction: string;

      if (eventType) {
        // Filter to specific event type and extract scores at matching indices
        const eventTypeParam = genMetricParamName("eventType");
        params[eventTypeParam] = eventType;
        scoreExtraction = `arrayFilter(
          x -> x IS NOT NULL,
          arrayMap(
            (n, a) -> if(n = {${eventTypeParam}:String}, toFloat64OrNull(a[{${scoreKeyParam}:String}]), NULL),
            ${ss}."Events.Name",
            ${ss}."Events.Attributes"
          )
        )`;
      } else {
        // Extract all scores
        scoreExtraction = `arrayFilter(
          x -> x IS NOT NULL,
          arrayMap(a -> toFloat64OrNull(a[{${scoreKeyParam}:String}]), ${ss}."Events.Attributes")
        )`;
      }

      // Apply aggregation to the extracted scores array
      const aggExpr = translateArrayAggregation(scoreExtraction, aggregation, alias);
      return {
        selectExpression: aggExpr,
        alias,
        requiredJoins,
        params,
      };
    }

    case "events.event_details":
      // ES implementation requires key (event_type) and subkey (event_details.key)
      // and only supports cardinality aggregation. CH implementation not yet complete.
      throw new Error(
        `Metric events.event_details is not yet supported in ClickHouse ` +
          `(aggregation=${aggregation}, metricKey=${metricKey ?? "undefined"})`,
      );

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };
  }
}

/**
 * Translate sentiment metrics
 */
function translateSentimentMetric(
  metric: string,
  aggregation: AggregationTypes,
  alias: string,
  requiredJoins: CHTable[],
): MetricTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  switch (metric) {
    case "sentiment.input_sentiment":
      // Input sentiment score from attributes
      return {
        selectExpression: translateSimpleAggregation(
          `toFloat64OrNull(${ts}.Attributes['langwatch.input.satisfaction_score'])`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
        params: {},
      };

    case "sentiment.thumbs_up_down":
      // Thumbs up/down from events
      requiredJoins.push("stored_spans");
      return {
        selectExpression: `countIf(has(${ss}."Events.Name", 'thumbs_up_down')) AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };
  }
}

/**
 * Translate threads metrics (average_duration_per_thread)
 */
function translateThreadsMetric(
  metric: string,
  aggregation: AggregationTypes,
  alias: string,
  requiredJoins: CHTable[],
): MetricTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  switch (metric) {
    case "threads.average_duration_per_thread":
      // This requires a subquery: first compute duration per thread, then average
      // Use trace_summaries.OccurredAt which is the trace's execution time
      // (= earliest span start time, matches ES's timestamps.started_at)
      // DateTime64 subtraction returns seconds, multiply by 1000 for milliseconds
      return {
        selectExpression: `avg(thread_duration) AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
        requiresSubquery: true,
        subquery: {
          innerSelect: `${ts}.Attributes['gen_ai.conversation.id'] AS thread_id, least((max(${ts}.OccurredAt) - min(${ts}.OccurredAt)) * 1000, ${MAX_THREAD_SESSION_DURATION_MS}) AS thread_duration`,
          innerGroupBy: "thread_id",
          outerAggregation: `avg(thread_duration) AS ${alias}`,
        },
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
        params: {},
      };
  }
}

/**
 * Translate a pipeline aggregation (per-user, per-thread metrics)
 */
export function translatePipelineAggregation(
  metric: string,
  aggregation: AggregationTypes,
  pipelineField: string,
  pipelineAggregation: PipelineAggregationTypes,
  index: number,
  key?: string,
  subkey?: string,
): MetricTranslation {
  const ts = tableAliases.trace_summaries;
  const alias = buildMetricAlias(
    index,
    metric,
    aggregation,
    key,
    subkey,
  );

  // Get the pipeline field expression
  // ES terms aggregation excludes null/missing values, so we just use the column directly
  // and filter out empty values via HAVING clause
  let pipelineColumn: string;
  switch (pipelineField) {
    case "trace_id":
      pipelineColumn = `${ts}.TraceId`;
      break;
    case "user_id":
      pipelineColumn = `${ts}.Attributes['langwatch.user_id']`;
      break;
    case "thread_id":
      pipelineColumn = `${ts}.Attributes['gen_ai.conversation.id']`;
      break;
    case "customer_id":
      pipelineColumn = `${ts}.Attributes['langwatch.customer_id']`;
      break;
    default:
      pipelineColumn = `${ts}.TraceId`;
  }

  // Get the inner metric translation
  const innerMetric = translateMetric(metric, aggregation, index, key, subkey);

  // Special handling for threads.average_duration_per_thread with pipeline
  // This requires a 3-level aggregation:
  // 1. Group by (user_id, thread_id), compute thread duration
  // 2. Group by user_id, compute avg thread duration per user
  // 3. Compute avg across users
  if (metric === "threads.average_duration_per_thread" && innerMetric.requiresSubquery) {
    const threadIdCol = `${ts}.Attributes['gen_ai.conversation.id']`;
    // pipelineAggregation is typed as PipelineAggregationTypes (sum/avg/min/max)
    // which matches CH function names directly
    const outerAgg = pipelineAggregation;

    // Build a nested subquery for 3-level aggregation
    // Use trace_summaries.OccurredAt which is set to the trace's execution start time
    // This matches ES's timestamps.started_at at the trace level
    return {
      selectExpression: `${outerAgg}(user_avg_duration) AS ${alias}`,
      alias,
      requiredJoins: innerMetric.requiredJoins,
      params: innerMetric.params,
      requiresSubquery: true,
      subquery: {
        // Inner: compute avg thread duration per user
        innerSelect: `
          pipeline_key,
          avg(thread_duration) AS user_avg_duration
        `,
        innerGroupBy: "pipeline_key",
        outerAggregation: `${outerAgg}(user_avg_duration) AS ${alias}`,
        // Custom nested CTE for thread duration calculation
        nestedSubquery: {
          // Use trace_summaries.OccurredAt (= trace's execution start time)
          // DateTime64 subtraction returns seconds, multiply by 1000 for milliseconds
          // Filter out empty pipeline_key values via HAVING to match ES terms aggregation behavior
          select: `${pipelineColumn} AS pipeline_key, ${threadIdCol} AS thread_id, least((max(${ts}.OccurredAt) - min(${ts}.OccurredAt)) * 1000, ${MAX_THREAD_SESSION_DURATION_MS}) AS thread_duration`,
          groupBy: "pipeline_key, thread_id",
          having: `thread_id IS NOT NULL AND toString(thread_id) != '' AND pipeline_key IS NOT NULL AND toString(pipeline_key) != ''`,
        },
      },
    };
  }

  // If inner metric already requires a subquery (e.g., other nested metrics),
  // we can't nest it in a pipeline aggregation. Return null as a fallback.
  if (innerMetric.requiresSubquery) {
    return {
      selectExpression: `NULL AS ${alias}`,
      alias,
      requiredJoins: innerMetric.requiredJoins,
      params: innerMetric.params,
      requiresSubquery: false, // Don't add to subquery metrics list
    };
  }

  // pipelineAggregation is typed as PipelineAggregationTypes (sum/avg/min/max)
  // which matches CH function names directly
  const outerAgg = pipelineAggregation;

  // Remove alias from selectExpression using regex anchored to end of string
  // Escape special regex characters in alias to prevent injection issues
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selectWithoutAlias = innerMetric.selectExpression.replace(
    new RegExp(` AS ${escapedAlias}$`),
    "",
  );

  return {
    selectExpression: `${outerAgg}(inner_value) AS ${alias}`,
    alias,
    requiredJoins: innerMetric.requiredJoins,
    params: innerMetric.params,
    requiresSubquery: true,
    subquery: {
      // Filter out empty pipeline_key values via HAVING to match ES terms aggregation behavior
      innerSelect: `${pipelineColumn} AS pipeline_key, ${selectWithoutAlias} AS inner_value`,
      innerGroupBy: "pipeline_key",
      outerAggregation: `${outerAgg}(inner_value) AS ${alias}`,
    },
  };
}
