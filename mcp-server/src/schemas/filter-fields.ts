export interface FilterFieldInfo {
  field: string;
  description: string;
  example?: string;
}

export const filterFields: FilterFieldInfo[] = [
  {
    field: "topics.topics",
    description: "Main topic classification of the trace",
    example: "billing",
  },
  {
    field: "topics.subtopics",
    description: "Subtopic classification",
    example: "refund-request",
  },
  {
    field: "metadata.user_id",
    description: "User ID from trace metadata",
    example: "user-123",
  },
  {
    field: "metadata.thread_id",
    description: "Conversation thread ID",
    example: "thread-456",
  },
  {
    field: "metadata.customer_id",
    description: "Customer/organization ID",
    example: "customer-789",
  },
  {
    field: "metadata.labels",
    description: "Custom labels attached to traces",
    example: "production",
  },
  {
    field: "metadata.key",
    description: "Custom metadata key",
    example: "environment",
  },
  {
    field: "metadata.value",
    description: "Custom metadata value (used with metadata.key)",
    example: "staging",
  },
  {
    field: "metadata.prompt_ids",
    description: "Prompt IDs used in the trace",
  },
  {
    field: "traces.error",
    description: "Whether the trace has errors",
    example: "true",
  },
  {
    field: "spans.type",
    description: "Span type (llm, tool, agent, chain, rag)",
    example: "llm",
  },
  {
    field: "spans.model",
    description: "LLM model name used in spans",
    example: "gpt-4o",
  },
  {
    field: "evaluations.evaluator_id",
    description: "Evaluator that ran on the trace",
  },
  {
    field: "evaluations.evaluator_id.guardrails_only",
    description: "Evaluator ID filtered to guardrails only",
  },
  {
    field: "evaluations.passed",
    description: "Whether evaluations passed",
    example: "true",
  },
  {
    field: "evaluations.score",
    description: "Evaluation score (numeric)",
  },
  {
    field: "evaluations.state",
    description: "Evaluation state (processed, error, skipped)",
  },
  {
    field: "evaluations.label",
    description: "Evaluation label result",
  },
  {
    field: "events.event_type",
    description: "Type of event (thumbs_up_down, custom)",
    example: "thumbs_up_down",
  },
  {
    field: "events.metrics.key",
    description: "Event metric key",
  },
  {
    field: "events.metrics.value",
    description: "Event metric value (numeric)",
  },
  {
    field: "events.event_details.key",
    description: "Event detail key",
  },
  {
    field: "annotations.hasAnnotation",
    description: "Whether trace has human annotations",
    example: "true",
  },
  {
    field: "sentiment.input_sentiment",
    description: "Detected sentiment of input",
    example: "positive",
  },
];
