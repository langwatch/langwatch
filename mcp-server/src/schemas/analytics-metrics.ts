export interface MetricInfo {
  category: string;
  name: string;
  label: string;
  allowedAggregations: string[];
  description: string;
}

export const analyticsMetrics: MetricInfo[] = [
  // metadata
  {
    category: "metadata",
    name: "trace_id",
    label: "Traces",
    allowedAggregations: ["cardinality"],
    description: "Count of unique traces",
  },
  {
    category: "metadata",
    name: "user_id",
    label: "Users",
    allowedAggregations: ["cardinality"],
    description: "Count of unique users",
  },
  {
    category: "metadata",
    name: "thread_id",
    label: "Threads",
    allowedAggregations: ["cardinality"],
    description: "Count of unique conversation threads",
  },
  {
    category: "metadata",
    name: "span_type",
    label: "Span Type",
    allowedAggregations: ["cardinality"],
    description: "Count of spans, optionally filtered by span type",
  },
  // sentiment
  {
    category: "sentiment",
    name: "input_sentiment",
    label: "Input Sentiment Score",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Sentiment analysis score of inputs",
  },
  {
    category: "sentiment",
    name: "thumbs_up_down",
    label: "Thumbs Up/Down Score",
    allowedAggregations: [
      "terms",
      "cardinality",
      "avg",
      "sum",
      "min",
      "max",
      "median",
      "p99",
      "p95",
      "p90",
    ],
    description: "User feedback score (-1 to 1)",
  },
  // performance
  {
    category: "performance",
    name: "completion_time",
    label: "Completion Time",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Time to complete the trace (ms)",
  },
  {
    category: "performance",
    name: "first_token",
    label: "Time to First Token",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Time to first token (ms)",
  },
  {
    category: "performance",
    name: "total_cost",
    label: "Total Cost",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Cost per trace in USD",
  },
  {
    category: "performance",
    name: "prompt_tokens",
    label: "Prompt Tokens",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Input token count",
  },
  {
    category: "performance",
    name: "completion_tokens",
    label: "Completion Tokens",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Output token count",
  },
  {
    category: "performance",
    name: "total_tokens",
    label: "Total Tokens",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Total token count (input + output)",
  },
  {
    category: "performance",
    name: "tokens_per_second",
    label: "Tokens per Second",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Token generation speed",
  },
  // events
  {
    category: "events",
    name: "event_type",
    label: "Event Type",
    allowedAggregations: ["cardinality"],
    description: "Count of events, optionally filtered by event type",
  },
  {
    category: "events",
    name: "event_score",
    label: "Event Score",
    allowedAggregations: [
      "terms",
      "avg",
      "sum",
      "min",
      "max",
      "median",
      "p99",
      "p95",
      "p90",
    ],
    description: "Numeric score from events (requires event_type key and metrics key)",
  },
  {
    category: "events",
    name: "event_details",
    label: "Event Details",
    allowedAggregations: ["cardinality"],
    description:
      "Event detail key/value distribution (requires event_type key and details key)",
  },
  // evaluations
  {
    category: "evaluations",
    name: "evaluation_score",
    label: "Evaluation Score",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description: "Numeric evaluation score (requires evaluator_id key)",
  },
  {
    category: "evaluations",
    name: "evaluation_pass_rate",
    label: "Evaluation Pass Rate",
    allowedAggregations: ["avg", "sum", "min", "max", "median", "p99", "p95", "p90"],
    description:
      "Percentage of traces passing evaluation (requires evaluator_id key)",
  },
  {
    category: "evaluations",
    name: "evaluation_runs",
    label: "Evaluation Runs",
    allowedAggregations: ["cardinality"],
    description: "Count of evaluation executions",
  },
  // threads
  {
    category: "threads",
    name: "average_duration_per_thread",
    label: "Thread Duration",
    allowedAggregations: ["avg"],
    description: "Average duration of conversation threads (ms)",
  },
];
