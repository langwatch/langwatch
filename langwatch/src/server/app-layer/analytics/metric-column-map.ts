/**
 * Metric Column Map
 *
 * Maps analytics metric names, groupBy fields, and filter fields to their
 * corresponding columns in the denormalized analytics fact tables.
 *
 * This replaces the complex metric-translator.ts + field-mappings.ts from
 * the existing ClickHouse analytics service. Because the fact tables are
 * pre-denormalized, we only need a simple lookup — no JOINs, no Map access,
 * no subqueries for basic metrics.
 */

/** Which analytics fact table contains the data */
export type FactTable = "trace" | "evaluation";

/** Mapping from a metric name to its fact table column */
export interface MetricColumnMapping {
  table: FactTable;
  /** The ClickHouse column expression (may include SQL expressions like coalesce) */
  column: string;
  /**
   * For identity/cardinality metrics where the column represents a unique ID.
   * These use uniq() instead of count().
   */
  isIdentity?: boolean;
}

/**
 * Maps SeriesInputType.metric values to fact table columns.
 *
 * The keys match the flattened metric enum values from registry.ts
 * (e.g., "metadata.trace_id", "performance.total_cost").
 */
export const metricColumnMap: Record<string, MetricColumnMapping> = {
  // -- metadata.* --
  "metadata.trace_id": {
    table: "trace",
    column: "TraceId",
    isIdentity: true,
  },
  "metadata.user_id": {
    table: "trace",
    column: "UserId",
    isIdentity: true,
  },
  "metadata.thread_id": {
    table: "trace",
    column: "ThreadId",
    isIdentity: true,
  },
  "metadata.span_type": {
    table: "trace",
    column: "TraceId",
    isIdentity: true,
  },

  // -- performance.* --
  "performance.completion_time": {
    table: "trace",
    column: "TotalDurationMs",
  },
  "performance.first_token": {
    table: "trace",
    column: "TimeToFirstTokenMs",
  },
  "performance.total_cost": {
    table: "trace",
    column: "TotalCost",
  },
  "performance.prompt_tokens": {
    table: "trace",
    column: "TotalPromptTokens",
  },
  "performance.completion_tokens": {
    table: "trace",
    column: "TotalCompletionTokens",
  },
  "performance.total_tokens": {
    table: "trace",
    column:
      "(coalesce(TotalPromptTokens, 0) + coalesce(TotalCompletionTokens, 0))",
  },
  "performance.tokens_per_second": {
    table: "trace",
    column: "TokensPerSecond",
  },

  // -- evaluations.* --
  "evaluations.evaluation_score": {
    table: "evaluation",
    column: "Score",
  },
  "evaluations.evaluation_pass_rate": {
    table: "evaluation",
    column: "toFloat64(Passed)",
  },
  "evaluations.evaluation_runs": {
    table: "evaluation",
    column: "EvaluationId",
    isIdentity: true,
  },

  // -- sentiment.* --
  "sentiment.thumbs_up_down": {
    table: "trace",
    column: "ThumbsUpDownVote",
  },

  // -- events.* --
  // event_type counts traces that have specific event types
  "events.event_type": {
    table: "trace",
    column: "TraceId",
    isIdentity: true,
  },
  // TODO: events.event_score and events.event_details need ARRAY JOIN on
  // EventScoreKeys/EventScoreValues — handle as special cases in the service
  "events.event_score": {
    table: "trace",
    column: "TraceId",
    isIdentity: true,
  },
  "events.event_details": {
    table: "trace",
    column: "TraceId",
    isIdentity: true,
  },

  // -- threads.* --
  // TODO: threads.average_duration_per_thread requires a subquery grouping
  // by ThreadId first — handle as special case in the service
  "threads.average_duration_per_thread": {
    table: "trace",
    column: "TotalDurationMs",
  },
};

/**
 * Maps groupBy field names to fact table columns.
 *
 * The keys match the flattened group enum values from registry.ts
 * (e.g., "topics.topics", "metadata.user_id").
 */
export const groupByColumnMap: Record<
  string,
  { table: FactTable; column: string; isArray?: boolean }
> = {
  "topics.topics": { table: "trace", column: "TopicId" },
  "metadata.user_id": { table: "trace", column: "UserId" },
  "metadata.thread_id": { table: "trace", column: "ThreadId" },
  "metadata.customer_id": { table: "trace", column: "CustomerId" },
  "metadata.labels": { table: "trace", column: "Labels", isArray: true },
  "metadata.model": { table: "trace", column: "ModelNames", isArray: true },
  "metadata.span_type": { table: "trace", column: "EventTypes", isArray: true },
  "error.has_error": { table: "trace", column: "ContainsError" },
  "evaluations.evaluation_passed": { table: "evaluation", column: "Passed" },
  "evaluations.evaluation_label": { table: "evaluation", column: "Label" },
  "evaluations.evaluation_processing_state": {
    table: "evaluation",
    column: "Status",
  },
  "events.event_type": { table: "trace", column: "EventTypes", isArray: true },
  "sentiment.thumbs_up_down": {
    table: "trace",
    column: "ThumbsUpDownVote",
  },
};

/**
 * Maps filter field names (from FilterField enum) to fact table columns.
 *
 * Used to build WHERE clauses from the shared filter input format.
 */
export const filterColumnMap: Record<
  string,
  { table: FactTable; column: string; isArray?: boolean }
> = {
  "metadata.user_id": { table: "trace", column: "UserId" },
  "metadata.thread_id": { table: "trace", column: "ThreadId" },
  "metadata.customer_id": { table: "trace", column: "CustomerId" },
  "metadata.labels": { table: "trace", column: "Labels", isArray: true },
  "topics.topics": { table: "trace", column: "TopicId" },
  "metadata.topic_id": { table: "trace", column: "TopicId" },
  "topics.subtopics": { table: "trace", column: "SubTopicId" },
  "metadata.subtopic_id": { table: "trace", column: "SubTopicId" },
  "spans.model": { table: "trace", column: "ModelNames", isArray: true },
  "spans.type": { table: "trace", column: "EventTypes", isArray: true },
  "evaluations.evaluator_id": { table: "evaluation", column: "EvaluatorId" },
  "evaluations.type": { table: "evaluation", column: "EvaluatorType" },
  "evaluations.passed": { table: "evaluation", column: "Passed" },
  "evaluations.score": { table: "evaluation", column: "Score" },
  "evaluations.state": { table: "evaluation", column: "Status" },
  "evaluations.label": { table: "evaluation", column: "Label" },
  "error.has_error": { table: "trace", column: "ContainsError" },
  "events.event_type": { table: "trace", column: "EventTypes", isArray: true },
  "traces.error": { table: "trace", column: "ContainsError" },
};

/**
 * Fact table names used in SQL queries
 */
export const factTableNames: Record<FactTable, string> = {
  trace: "analytics_trace_facts",
  evaluation: "analytics_evaluation_facts",
};
