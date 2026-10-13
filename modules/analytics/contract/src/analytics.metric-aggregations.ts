import {
  type AggregationTypes,
  allAggregationTypes,
  numericAggregationTypes,
  percentileAggregationTypes,
} from "./analytics.input-schemas.ts";

const numericMetricAggregations: readonly AggregationTypes[] = [
  ...numericAggregationTypes,
  ...percentileAggregationTypes,
];

const scoreAggregations: readonly AggregationTypes[] = allAggregationTypes.filter(
  (aggregation) => aggregation !== "cardinality" && aggregation !== "terms",
);

/** Every analytics metric and the aggregations it supports; anything else is refused (#8013). */
export const analyticsMetricAggregations: Readonly<Record<string, readonly AggregationTypes[]>> = {
  "metadata.trace_id": ["cardinality"],
  "metadata.user_id": ["cardinality"],
  "metadata.thread_id": ["cardinality"],
  "metadata.span_type": ["cardinality"],
  "sentiment.thumbs_up_down": allAggregationTypes,
  "performance.completion_time": numericMetricAggregations,
  "performance.first_token": numericMetricAggregations,
  "performance.total_cost": numericMetricAggregations,
  "performance.cost_billed": numericMetricAggregations,
  "performance.cost_non_billed": numericMetricAggregations,
  "performance.prompt_tokens": numericMetricAggregations,
  "performance.completion_tokens": numericMetricAggregations,
  "performance.cache_read_tokens": numericMetricAggregations,
  "performance.cache_write_tokens": numericMetricAggregations,
  "performance.reasoning_tokens": numericMetricAggregations,
  "performance.total_processed_tokens": numericMetricAggregations,
  "performance.total_tokens": numericMetricAggregations,
  "performance.tokens_per_second": numericMetricAggregations,
  "events.event_type": ["cardinality"],
  "events.event_score": allAggregationTypes.filter((aggregation) => aggregation !== "cardinality"),
  "events.event_details": ["cardinality"],
  "evaluations.evaluation_score": scoreAggregations,
  "evaluations.evaluation_pass_rate": scoreAggregations,
  "evaluations.evaluation_runs": ["cardinality"],
  "threads.average_duration_per_thread": ["avg"],
};
