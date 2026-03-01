/**
 * Canonical attribute key constants.
 *
 * These constants provide a single source of truth for all attribute keys
 * used in the canonicalization process, reducing magic strings and improving
 * maintainability.
 */
export const ATTR_KEYS = {
  // Span type
  SPAN_TYPE: "langwatch.span.type",

  // GenAI canonical attributes
  GEN_AI_OPERATION_NAME: "gen_ai.operation.name",
  GEN_AI_PROVIDER_NAME: "gen_ai.provider.name",
  GEN_AI_REQUEST_MODEL: "gen_ai.request.model",
  GEN_AI_RESPONSE_MODEL: "gen_ai.response.model",
  GEN_AI_RESPONSE_ID: "gen_ai.response.id",
  GEN_AI_RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
  GEN_AI_REQUEST_SYSTEM_INSTRUCTION: "gen_ai.request.system_instruction",
  GEN_AI_REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  GEN_AI_REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  GEN_AI_REQUEST_TOP_P: "gen_ai.request.top_p",
  GEN_AI_REQUEST_FREQUENCY_PENALTY: "gen_ai.request.frequency_penalty",
  GEN_AI_REQUEST_PRESENCE_PENALTY: "gen_ai.request.presence_penalty",
  GEN_AI_REQUEST_SEED: "gen_ai.request.seed",
  GEN_AI_REQUEST_STOP_SEQUENCES: "gen_ai.request.stop_sequences",
  GEN_AI_REQUEST_CHOICE_COUNT: "gen_ai.request.choice.count",
  GEN_AI_INPUT_MESSAGES: "gen_ai.input.messages",
  GEN_AI_OUTPUT_MESSAGES: "gen_ai.output.messages",
  GEN_AI_OUTPUT_TYPE: "gen_ai.output.type",
  GEN_AI_USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  GEN_AI_USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  GEN_AI_USAGE_PROMPT_TOKENS: "gen_ai.usage.prompt_tokens",
  GEN_AI_USAGE_COMPLETION_TOKENS: "gen_ai.usage.completion_tokens",
  GEN_AI_CONVERSATION_ID: "gen_ai.conversation.id",
  GEN_AI_AGENT_ID: "gen_ai.agent.id",
  GEN_AI_AGENT_DESCRIPTION: "gen_ai.agent.description",
  GEN_AI_DATA_SOURCE_ID: "gen_ai.data_source.id",
  GEN_AI_TOOL_DEFINITIONS: "gen_ai.tool.definitions",

  // Legacy GenAI attributes
  GEN_AI_PROMPT: "gen_ai.prompt",
  GEN_AI_COMPLETION: "gen_ai.completion",
  GEN_AI_AGENT: "gen_ai.agent",
  GEN_AI_AGENT_NAME: "gen_ai.agent.name",
  GEN_AI_SYSTEM: "gen_ai.system",

  // Vercel AI SDK attributes
  AI_PROMPT: "ai.prompt",
  AI_PROMPT_MESSAGES: "ai.prompt.messages",
  AI_RESPONSE: "ai.response",
  AI_RESPONSE_TEXT: "ai.response.text",
  AI_MODEL: "ai.model",
  AI_USAGE: "ai.usage",
  AI_TOOL_CALL: "ai.toolCall",
  AI_TOOL_CALL_NAME: "ai.toolCall.name",
  AI_TOOL_CALL_ARGS: "ai.toolCall.args",

  // OpenTelemetry LLM attributes
  LLM_MODEL_NAME: "llm.model_name",
  LLM_INPUT_MESSAGES: "llm.input_messages",
  LLM_OUTPUT_MESSAGES: "llm.output_messages",
  LLM_INVOCATION_PARAMETERS: "llm.invocation_parameters",
  LLM_REQUEST_TYPE: "llm.request.type",

  // Legacy/other attributes
  TYPE: "type",
  LANGWATCH_TYPE: "langwatch.type",
  OPERATION_NAME: "operation.name",
  AGENT_NAME: "agent.name",
  SYSTEM_NAME: "system.name",
  SERVICE_NAME: "service.name",
  SPAN_KIND: "span.kind",
  OTEL_SPAN_KIND: "otel.span.kind",
  INCOMING_SPAN_KIND: "incomingSpan.kind",

  // LangWatch cost and estimation attributes
  LANGWATCH_SPAN_COST: "langwatch.span.cost",
  LANGWATCH_TOKENS_ESTIMATED: "langwatch.tokens.estimated",
  LANGWATCH_METRICS: "langwatch.metrics",
  LANGWATCH_MODEL_INPUT_COST_PER_TOKEN: "langwatch.model.inputCostPerToken",
  LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN: "langwatch.model.outputCostPerToken",

  // LangWatch attributes
  LANGWATCH_INPUT: "langwatch.input",
  LANGWATCH_OUTPUT: "langwatch.output",
  LANGWATCH_RESERVED_VALUE_TYPES: "langwatch.reserved.value_types",
  LANGWATCH_PARAMS: "langwatch.params",
  LANGWATCH_RAG_CONTEXTS: "langwatch.rag.contexts",
  LANGWATCH_RAG_CONTEXTS_LEGACY: "langwatch.rag_contexts",
  LANGWATCH_THREAD_ID: "langwatch.thread.id",
  LANGWATCH_THREAD_ID_LEGACY: "langwatch.thread_id",
  LANGWATCH_THREAD_ID_LEGACY_ROOT: "thread_id",
  LANGWATCH_USER_ID: "langwatch.user.id",
  LANGWATCH_USER_ID_LEGACY: "langwatch.user_id",
  LANGWATCH_USER_ID_LEGACY_ROOT: "user_id",
  LANGWATCH_CUSTOMER_ID: "langwatch.customer.id",
  LANGWATCH_CUSTOMER_ID_LEGACY: "langwatch.customer_id",
  LANGWATCH_CUSTOMER_ID_LEGACY_ROOT: "customer_id",
  LANGWATCH_LANGGRAPH_THREAD_ID: "langwatch.langgraph.thread_id",
  LANGWATCH_LANGGRAPH_NODE: "langwatch.langgraph.langgraph_node",
  LANGWATCH_LANGGRAPH_STEP: "langwatch.langgraph.langgraph_step",
  LANGWATCH_LABELS: "langwatch.labels",
  LANGWATCH_TAGS: "langwatch.tags", // Legacy/alternative name

  // LangWatch reserved attributes
  LANGWATCH_RESERVED_PII_REDACTION_STATUS:
    "langwatch.reserved.pii_redaction_status",
  LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS:
    "langwatch.reserved.pii_redaction_partial_span_ids",
  LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS:
    "langwatch.reserved.pii_redaction_skipped_span_ids",

  // Error attributes
  ERROR_TYPE: "error.type",
  ERROR_MESSAGE: "error.message",
  ERROR_HAS_ERROR: "error.has_error",
  EXCEPTION_TYPE: "exception.type",
  EXCEPTION_MESSAGE: "exception.message",
  STATUS_MESSAGE: "status.message",
  SPAN_ERROR_HAS_ERROR: "span.error.has_error",
  SPAN_ERROR_MESSAGE: "span.error.message",

  // Output attributes
  OUTPUT: "output",
  OUTPUT_VALUE: "output.value",

  // Input attributes
  INPUT: "input",
  INPUT_VALUE: "input.value",

  // Traceloop attributes
  TRACELOOP_SPAN_KIND: "traceloop.span.kind",
  TRACELOOP_ENTITY_INPUT: "traceloop.entity.input",
  TRACELOOP_ENTITY_OUTPUT: "traceloop.entity.output",

  // OpenInference attributes
  OPENINFERENCE_SPAN_KIND: "openinference.span.kind",
  OPENINFERENCE_USER_ID: "user.id",
  OPENINFERENCE_SESSION_ID: "session.id",
  OPENINFERENCE_TAG_TAGS: "tag.tags",

  // Haystack attributes
  RETRIEVAL_DOCUMENTS: "retrieval.documents",

  // Logfire attributes
  RAW_INPUT: "raw_input",

  // Mastra attributes
  MASTRA_INPUT: "input",
  MASTRA_OUTPUT: "mastra.output",
  MASTRA_SPAN_TYPE: "mastra.span.type",
} as const;

export const SPAN_TYPE_TO_GEN_AI_OP: Record<string, string> = {
  llm: "chat",
  tool: "tool",
  agent: "agent",
  rag: "retrieval",
};
