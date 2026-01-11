import type {
  NormalizedSpan,
  NormalizedAttributes,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type {
  BaseSpan,
  ChatMessage,
  Span,
  SpanTypes,
  SpanInputOutput,
  SpanTimestamps,
  SpanMetrics,
  ErrorCapture,
  RAGChunk,
} from "~/server/tracer/types";

/**
 * Converts attribute values to JSON-serializable format.
 * Handles bigint conversion to number.
 */
function toJsonSerializable(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSerializable);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = toJsonSerializable(v);
    }
    return result;
  }
  return value;
}

/**
 * Extracts input from span attributes.
 * Looks for common semantic convention keys for input.
 */
function extractInput(
  spanAttributes: NormalizedAttributes
): SpanInputOutput | null {
  // Priority 1: gen_ai.input.messages (canonical GenAI semantic convention)
  const genAiInputMessages = spanAttributes["gen_ai.input.messages"];
  if (genAiInputMessages !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiInputMessages) as ChatMessage[],
    };
  }

  // Try legacy gen_ai semantic conventions
  const genAiInput =
    spanAttributes["gen_ai.prompt"] ??
    spanAttributes["gen_ai.request.messages"];
  if (genAiInput !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiInput) as ChatMessage[],
    };
  }

  // Try LLM semantic conventions
  const llmInput =
    spanAttributes["llm.input_messages"] ?? spanAttributes["llm.prompts"];
  if (llmInput !== undefined) {
    return {
      type: "json",
      value: toJsonSerializable(llmInput) as
        | string
        | number
        | boolean
        | null
        | Record<string, unknown>
        | unknown[],
    };
  }

  // Try generic input attribute
  const input = spanAttributes.input ?? spanAttributes["langwatch.input"];
  if (input !== undefined) {
    if (typeof input === "string") {
      return { type: "text", value: input };
    }
    return {
      type: "json",
      value: toJsonSerializable(input) as
        | string
        | number
        | boolean
        | null
        | Record<string, unknown>
        | unknown[],
    };
  }

  return null;
}

/**
 * Extracts output from span attributes.
 * Looks for common semantic convention keys for output.
 */
function extractOutput(
  spanAttributes: NormalizedAttributes
): SpanInputOutput | null {
  // Priority 1: gen_ai.output.messages (canonical GenAI semantic convention)
  const genAiOutputMessages = spanAttributes["gen_ai.output.messages"];
  if (genAiOutputMessages !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiOutputMessages) as ChatMessage[],
    };
  }

  // Try legacy gen_ai semantic conventions
  const genAiOutput =
    spanAttributes["gen_ai.completion"] ??
    spanAttributes["gen_ai.response.messages"];
  if (genAiOutput !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiOutput) as ChatMessage[],
    };
  }

  // Try LLM semantic conventions
  const llmOutput =
    spanAttributes["llm.output_messages"] ?? spanAttributes["llm.completions"];
  if (llmOutput !== undefined) {
    return {
      type: "json",
      value: toJsonSerializable(llmOutput) as
        | string
        | number
        | boolean
        | null
        | Record<string, unknown>
        | unknown[],
    };
  }

  // Try generic output attribute
  const output = spanAttributes.output ?? spanAttributes["langwatch.output"];
  if (output !== void 0) {
    if (typeof output === "string") {
      return { type: "text", value: output };
    }
    return {
      type: "json",
      value: toJsonSerializable(output) as
        | string
        | number
        | boolean
        | null
        | Record<string, unknown>
        | unknown[],
    };
  }

  return null;
}

/**
 * Extracts metrics from span attributes.
 */
function extractMetrics(
  spanAttributes: NormalizedAttributes
): SpanMetrics | null {
  const promptTokens =
    spanAttributes["gen_ai.usage.prompt_tokens"] ??
    spanAttributes["llm.token_count.prompt"] ??
    spanAttributes["llm.usage.prompt_tokens"];

  const completionTokens =
    spanAttributes["gen_ai.usage.completion_tokens"] ??
    spanAttributes["llm.token_count.completion"] ??
    spanAttributes["llm.usage.completion_tokens"];

  const cost =
    spanAttributes["gen_ai.usage.cost"] ?? spanAttributes["llm.usage.cost"];
  const tokensEstimated = spanAttributes["langwatch.tokens_estimated"];

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    cost === undefined
  ) {
    return null;
  }

  return {
    prompt_tokens: typeof promptTokens === "number" ? promptTokens : null,
    completion_tokens:
      typeof completionTokens === "number" ? completionTokens : null,
    cost: typeof cost === "number" ? cost : null,
    tokens_estimated:
      typeof tokensEstimated === "boolean" ? tokensEstimated : null,
  };
}

/**
 * Extracts model name from span attributes.
 */
function extractModel(spanAttributes: NormalizedAttributes): string | null {
  const model =
    spanAttributes["gen_ai.response.model"] ??
    spanAttributes["gen_ai.request.model"] ??
    spanAttributes["llm.model"] ??
    spanAttributes["llm.request.model"];

  return typeof model === "string" ? model : null;
}

/**
 * Extracts vendor from span attributes.
 */
function extractVendor(spanAttributes: NormalizedAttributes): string | null {
  const vendor =
    spanAttributes["gen_ai.system"] ??
    spanAttributes["llm.vendor"] ??
    spanAttributes["llm.provider"];

  return typeof vendor === "string" ? vendor : null;
}

/**
 * Extracts RAG contexts from span attributes.
 */
function extractContexts(
  spanAttributes: NormalizedAttributes
): RAGChunk[] | undefined {
  const contexts =
    spanAttributes["retrieval.documents"] ?? spanAttributes["rag.contexts"];

  if (!contexts || !Array.isArray(contexts)) {
    return undefined;
  }

  return contexts.map((ctx: unknown) => {
    if (typeof ctx === "string") {
      return { content: ctx };
    }
    if (typeof ctx === "object" && ctx !== null) {
      const obj = ctx as Record<string, unknown>;
      return {
        document_id:
          typeof obj.document_id === "string" ? obj.document_id : null,
        chunk_id: typeof obj.chunk_id === "string" ? obj.chunk_id : null,
        content: obj.content ?? obj,
      };
    }
    return { content: String(ctx) };
  });
}

/**
 * Extracts error information from span status.
 */
function extractError(
  statusCode: NormalizedStatusCode | null,
  statusMessage: string | null,
  spanAttributes: NormalizedAttributes
): ErrorCapture | null {
  if (statusCode !== NormalizedStatusCode.ERROR) {
    return null;
  }

  const errorMessage =
    statusMessage ??
    (typeof spanAttributes["exception.message"] === "string"
      ? spanAttributes["exception.message"]
      : "Unknown error");

  const stacktrace = spanAttributes["exception.stacktrace"];
  const stacktraceArray =
    typeof stacktrace === "string" ? stacktrace.split("\n") : [];

  return {
    has_error: true,
    message: errorMessage,
    stacktrace: stacktraceArray,
  };
}

/**
 * Extracts params from span attributes.
 * Filters out known semantic convention keys to get custom params.
 */
function _extractParams(
  spanAttributes: NormalizedAttributes
): Record<string, unknown> | null {
  const knownKeys = new Set([
    "gen_ai.prompt",
    "gen_ai.completion",
    "gen_ai.request.messages",
    "gen_ai.response.messages",
    "gen_ai.request.model",
    "gen_ai.response.model",
    "gen_ai.system",
    "gen_ai.usage.prompt_tokens",
    "gen_ai.usage.completion_tokens",
    "gen_ai.usage.cost",
    "llm.input_messages",
    "llm.output_messages",
    "llm.prompts",
    "llm.completions",
    "llm.model",
    "llm.request.model",
    "llm.vendor",
    "llm.provider",
    "llm.token_count.prompt",
    "llm.token_count.completion",
    "llm.usage.prompt_tokens",
    "llm.usage.completion_tokens",
    "llm.usage.cost",
    "input",
    "output",
    "langwatch.input",
    "langwatch.output",
    "langwatch.tokens_estimated",
    "retrieval.documents",
    "rag.contexts",
    "exception.message",
    "exception.stacktrace",
    "exception.type",
    "tool.name",
    "agent.name",
  ]);

  // Extract LLM params
  const params: Record<string, unknown> = {};

  // Common LLM parameters
  const temperature =
    spanAttributes["gen_ai.request.temperature"] ??
    spanAttributes["llm.temperature"];
  if (temperature !== undefined) params.temperature = temperature;

  const maxTokens =
    spanAttributes["gen_ai.request.max_tokens"] ??
    spanAttributes["llm.max_tokens"];
  if (maxTokens !== undefined) params.max_tokens = maxTokens;

  const topP =
    spanAttributes["gen_ai.request.top_p"] ?? spanAttributes["llm.top_p"];
  if (topP !== undefined) params.top_p = topP;

  // Add any other non-known attributes as custom params
  for (const [key, value] of Object.entries(spanAttributes)) {
    if (
      !knownKeys.has(key) &&
      !key.startsWith("gen_ai.") &&
      !key.startsWith("llm.")
    ) {
      params[key] = value;
    }
  }

  return Object.keys(params).length > 0 ? params : null;
}

/**
 * Maps a NormalizedSpan (from ClickHouse stored_spans) to the legacy Span type
 * used by the Elasticsearch-based trace system.
 */
export function mapNormalizedSpanToSpan(normalizedSpan: NormalizedSpan): Span {
  const timestamps: SpanTimestamps = {
    started_at: normalizedSpan.startTimeUnixMs,
    finished_at: normalizedSpan.endTimeUnixMs,
    first_token_at: null, // Could be extracted from events if available
  };

  // Check for first token event
  const firstTokenEvent = normalizedSpan.events.find(
    (e) => e.name === "first_token" || e.name === "gen_ai.content.first_token"
  );
  if (firstTokenEvent) {
    timestamps.first_token_at = firstTokenEvent.timeUnixMs;
  }

  const spanType = normalizedSpan.spanAttributes[
    "langwatch.span.type"
  ] as SpanTypes;

  const baseSpan: BaseSpan = {
    span_id: normalizedSpan.spanId,
    parent_id: normalizedSpan.parentSpanId,
    trace_id: normalizedSpan.traceId,
    type: typeof spanType === "string" ? spanType : ("span" as const),
    name: normalizedSpan.name,
    input: extractInput(normalizedSpan.spanAttributes),
    output: extractOutput(normalizedSpan.spanAttributes),
    error: extractError(
      normalizedSpan.statusCode,
      normalizedSpan.statusMessage,
      normalizedSpan.spanAttributes
    ),
    timestamps,
    metrics: extractMetrics(normalizedSpan.spanAttributes),
    params: normalizedSpan.spanAttributes,
  };

  // Add LLM-specific fields
  if (baseSpan.type === "llm") {
    return {
      ...baseSpan,
      type: "llm" as const,
      model: extractModel(normalizedSpan.spanAttributes),
      vendor: extractVendor(normalizedSpan.spanAttributes),
    };
  }

  // Add RAG-specific fields
  if (baseSpan.type === "rag") {
    return {
      ...baseSpan,
      type: "rag" as const,
      contexts: extractContexts(normalizedSpan.spanAttributes) ?? [],
    };
  }

  return baseSpan;
}

/**
 * Maps multiple NormalizedSpans to legacy Span format.
 */
export function mapNormalizedSpansToSpans(
  normalizedSpans: NormalizedSpan[]
): Span[] {
  return normalizedSpans.map(mapNormalizedSpanToSpan);
}
