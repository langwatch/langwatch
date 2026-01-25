/**
 * Metric Translator - Converts ES metric definitions to ClickHouse SQL expressions.
 *
 * This module translates the ES aggregation patterns used in analytics metrics
 * to equivalent ClickHouse SQL expressions.
 */

import type { AggregationTypes, PercentileAggregationTypes } from "../types";
import {
  type CHTable,
  getFieldMapping,
  qualifiedColumn,
  tableAliases,
} from "./field-mappings";

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
  /** Additional GROUP BY expressions if needed */
  groupByExpression?: string;
  /** Whether this metric requires a subquery (e.g., pipeline aggregations) */
  requiresSubquery?: boolean;
  /** Subquery definition if required */
  subquery?: {
    innerSelect: string;
    innerGroupBy: string;
    outerAggregation: string;
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
      return `sum(${columnExpr}) AS ${alias}`;
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
        return `quantileTDigest(${percentile})(${columnExpr}) AS ${alias}`;
      }
      return `count(${columnExpr}) AS ${alias}`;
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
 * Translate a metric definition to ClickHouse SQL
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
    };
  }

  // Fallback for unknown metrics
  return {
    selectExpression: `count() AS ${alias}`,
    alias,
    requiredJoins,
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
      };

    case "metadata.user_id":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.Attributes['langwatch.user_id']`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
      };

    case "metadata.thread_id":
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.Attributes['gen_ai.conversation.id']`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
      };

    case "metadata.span_type":
      // Requires JOIN with stored_spans
      requiredJoins.push("stored_spans");
      return {
        selectExpression: translateSimpleAggregation(
          `${ss}.SpanId`,
          "cardinality",
          alias,
        ),
        alias,
        requiredJoins,
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
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
      };

    case "performance.tokens_per_second":
      // Pre-computed in trace_summaries
      return {
        selectExpression: translateSimpleAggregation(
          `${ts}.TokensPerSecond`,
          aggregation,
          alias,
        ),
        alias,
        requiredJoins,
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
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
  requiredJoins.push("evaluation_states");
  const es = tableAliases.evaluation_states;

  // Build evaluator filter condition if key is provided
  const evaluatorCondition = evaluatorId
    ? `${es}.EvaluatorId = '${evaluatorId.replace(/'/g, "''")}'`
    : "1=1";

  switch (metric) {
    case "evaluations.evaluation_score":
      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        return {
          selectExpression: `quantileTDigestIf(${percentile})(${es}.Score, ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
          alias,
          requiredJoins,
        };
      }
      return {
        selectExpression: `${aggregation}If(${es}.Score, ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
        alias,
        requiredJoins,
      };

    case "evaluations.evaluation_pass_rate":
      // Calculate pass rate as average of passed (0/1)
      if (isPercentileAggregation(aggregation)) {
        const percentile = percentileToPercent[aggregation];
        return {
          selectExpression: `quantileTDigestIf(${percentile})(toFloat64(${es}.Passed), ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
          alias,
          requiredJoins,
        };
      }
      return {
        selectExpression: `${aggregation}If(toFloat64(${es}.Passed), ${evaluatorCondition} AND ${es}.Status = 'processed') AS ${alias}`,
        alias,
        requiredJoins,
      };

    case "evaluations.evaluation_runs":
      return {
        selectExpression: `uniqIf(${es}.EvaluationId, ${evaluatorCondition}) AS ${alias}`,
        alias,
        requiredJoins,
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
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
      // Count events of a specific type
      const typeCondition = eventType
        ? `has(${ss}."Events.Name", '${eventType.replace(/'/g, "''")}')`
        : `length(${ss}."Events.Name") > 0`;

      return {
        selectExpression: `countIf(${typeCondition}) AS ${alias}`,
        alias,
        requiredJoins,
      };
    }

    case "events.event_score": {
      // This is complex - events are in arrays within stored_spans
      // We need to use arrayFilter and extract metrics from Events.Attributes
      // For now, return a simplified version
      const eventCondition = eventType
        ? `has(${ss}."Events.Name", '${eventType.replace(/'/g, "''")}')`
        : "1=1";

      // Events.Attributes is Array(Map(String, String)) - need to extract metric value
      // This is a simplified implementation
      return {
        selectExpression: `countIf(${eventCondition}) AS ${alias}`,
        alias,
        requiredJoins,
      };
    }

    case "events.event_details":
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
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
      };

    case "sentiment.thumbs_up_down":
      // Thumbs up/down from events
      requiredJoins.push("stored_spans");
      return {
        selectExpression: `countIf(has(${ss}."Events.Name", 'thumbs_up_down')) AS ${alias}`,
        alias,
        requiredJoins,
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
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

  switch (metric) {
    case "threads.average_duration_per_thread":
      // This requires a subquery: first compute duration per thread, then average
      return {
        selectExpression: `avg(thread_duration) AS ${alias}`,
        alias,
        requiredJoins,
        requiresSubquery: true,
        subquery: {
          innerSelect: `${ts}.Attributes['gen_ai.conversation.id'] AS thread_id, max(${ts}.CreatedAt) - min(${ts}.CreatedAt) AS thread_duration`,
          innerGroupBy: "thread_id",
          outerAggregation: `avg(thread_duration) AS ${alias}`,
        },
      };

    default:
      return {
        selectExpression: `count() AS ${alias}`,
        alias,
        requiredJoins,
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
  pipelineAggregation: string,
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

  // Map pipeline aggregation to CH function
  const outerAgg =
    pipelineAggregation === "sum"
      ? "sum"
      : pipelineAggregation === "avg"
        ? "avg"
        : pipelineAggregation === "min"
          ? "min"
          : "max";

  return {
    selectExpression: `${outerAgg}(inner_value) AS ${alias}`,
    alias,
    requiredJoins: innerMetric.requiredJoins,
    requiresSubquery: true,
    subquery: {
      innerSelect: `${pipelineColumn} AS pipeline_key, ${innerMetric.selectExpression.replace(` AS ${alias}`, "")} AS inner_value`,
      innerGroupBy: "pipeline_key",
      outerAggregation: `${outerAgg}(inner_value) AS ${alias}`,
    },
  };
}
