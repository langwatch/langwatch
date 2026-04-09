import type {
  NormalizedAttributes,
  NormalizedSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { NormalizedStatusCode } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { coerceToNumber } from "~/utils/coerceToNumber";
import { safeUnflatten } from "~/utils/safeUnflatten";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import type {
  BaseSpan,
  ChatMessage,
  ErrorCapture,
  RAGChunk,
  Span,
  SpanInputOutput,
  SpanMetrics,
  SpanTimestamps,
  SpanTypes,
} from "~/server/tracer/types";

type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];


/**
 * Converts attribute values to JSON-serializable format.
 * Handles bigint conversion to number.
 */
function toJsonSerializable(value: unknown): JsonSerializable {
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

  return value as JsonSerializable;
}

const KNOWN_WRAPPER_TYPES = new Set([
  "text",
  "chat_messages",
  "json",
  "raw",
  "list",
  "evaluation_result",
  "guardrail_result",
]);

/**
 * Detects the legacy {type, value} wrapper format from the REST collector
 * or preserved by canonicalization for chat_messages.
 * After ClickHouse deserialization, these appear as objects with `type` and `value`.
 */
function isLegacyWrapper(
  v: unknown,
): v is { type: string; value: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "type" in v &&
    "value" in v &&
    typeof (v as Record<string, unknown>).type === "string" &&
    KNOWN_WRAPPER_TYPES.has((v as Record<string, unknown>).type as string)
  );
}

/**
 * Unwraps a {type, value} wrapper into a proper SpanInputOutput.
 */
function unwrapLegacyWrapper(
  wrapper: { type: string; value: unknown },
  spanAttributes: NormalizedAttributes,
  attrKey: string,
): SpanInputOutput {
  const { type, value } = wrapper;
  if (type === "chat_messages" && Array.isArray(value)) {
    return { type: "chat_messages", value: toJsonSerializable(value) as ChatMessage[] };
  }
  if (type === "text") {
    return { type: "text", value: typeof value === "string" ? value : JSON.stringify(value) };
  }
  if (type === "evaluation_result" || type === "guardrail_result") {
    return { type, value: toJsonSerializable(value) } as unknown as SpanInputOutput;
  }
  return { type: "json", value: toJsonSerializable(value) };
}

/**
 * Reads the annotated value type for a canonical key from
 * langwatch.reserved.value_types (e.g. ["langwatch.input=chat_messages"]).
 */
function getAnnotatedType(
  spanAttributes: NormalizedAttributes,
  attrKey: string,
): string | null {
  let raw = spanAttributes["langwatch.reserved.value_types"];

  // ClickHouse Map(String, String) stores arrays as JSON strings
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(raw)) return null;

  const prefix = `${attrKey}=`;
  for (const entry of raw) {
    if (typeof entry === "string" && entry.startsWith(prefix)) {
      return entry.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Extracts input from canonical span attributes only.
 * After canonicalization, input is at:
 * 1. gen_ai.input.messages (chat messages)
 * 2. langwatch.input (text/json/structured)
 */
function extractInput(
  spanAttributes: NormalizedAttributes,
): SpanInputOutput | null {
  // Priority 1: gen_ai.input.messages → always chat_messages
  const genAiInputMessages = spanAttributes["gen_ai.input.messages"];
  if (genAiInputMessages !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiInputMessages) as ChatMessage[],
    };
  }

  // Priority 2: langwatch.input → use annotated type or infer
  let lwInput = spanAttributes["langwatch.input"];
  if (lwInput !== undefined) {
    // ClickHouse Map(String, String) stores objects as JSON strings
    if (typeof lwInput === "string") {
      try {
        const parsed = JSON.parse(lwInput);
        if (typeof parsed === "object" && parsed !== null) {
          lwInput = parsed;
        }
      } catch {
        // Not JSON — keep as string
      }
    }
    // Unwrap {type, value} wrapper preserved by canonicalization (e.g. chat_messages)
    if (isLegacyWrapper(lwInput)) {
      return unwrapLegacyWrapper(lwInput, spanAttributes, "langwatch.input");
    }
    const annotatedType = getAnnotatedType(spanAttributes, "langwatch.input");
    if (annotatedType === "chat_messages" && Array.isArray(lwInput)) {
      return {
        type: "chat_messages",
        value: toJsonSerializable(lwInput) as ChatMessage[],
      };
    }
    if (annotatedType === "text" || typeof lwInput === "string") {
      // ClickHouse deserializeAttributes() may parse JSON-like strings back to
      // objects/arrays (e.g. "[{\"role\":...}]" → Array). Re-stringify to avoid
      // String([object Object]).
      const textValue =
        typeof lwInput === "string" ? lwInput : JSON.stringify(lwInput);
      return { type: "text", value: textValue };
    }
    return {
      type: "json",
      value: toJsonSerializable(lwInput),
    };
  }

  return null;
}

/**
 * Extracts output from canonical span attributes only.
 * After canonicalization, output is at:
 * 1. gen_ai.output.messages (chat messages)
 * 2. langwatch.output (text/json/structured)
 */
function extractOutput(
  spanAttributes: NormalizedAttributes,
): SpanInputOutput | null {
  // Priority 1: gen_ai.output.messages → always chat_messages
  const genAiOutputMessages = spanAttributes["gen_ai.output.messages"];
  if (genAiOutputMessages !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiOutputMessages) as ChatMessage[],
    };
  }

  // Priority 2: langwatch.output → use annotated type or infer
  let lwOutput = spanAttributes["langwatch.output"];
  if (lwOutput !== undefined) {
    // ClickHouse Map(String, String) stores objects as JSON strings
    if (typeof lwOutput === "string") {
      try {
        const parsed = JSON.parse(lwOutput);
        if (typeof parsed === "object" && parsed !== null) {
          lwOutput = parsed;
        }
      } catch {
        // Not JSON — keep as string
      }
    }
    // Unwrap {type, value} wrapper preserved by canonicalization (e.g. chat_messages)
    if (isLegacyWrapper(lwOutput)) {
      return unwrapLegacyWrapper(lwOutput, spanAttributes, "langwatch.output");
    }
    const annotatedType = getAnnotatedType(spanAttributes, "langwatch.output");
    if (annotatedType === "chat_messages" && Array.isArray(lwOutput)) {
      return {
        type: "chat_messages",
        value: toJsonSerializable(lwOutput) as ChatMessage[],
      };
    }
    if (
      annotatedType === "evaluation_result" ||
      annotatedType === "guardrail_result"
    ) {
      return {
        type: annotatedType,
        value: toJsonSerializable(lwOutput),
      } as unknown as SpanInputOutput;
    }
    if (annotatedType === "text" || typeof lwOutput === "string") {
      const textValue =
        typeof lwOutput === "string" ? lwOutput : JSON.stringify(lwOutput);
      return { type: "text", value: textValue };
    }
    return {
      type: "json",
      value: toJsonSerializable(lwOutput),
    };
  }

  return null;
}


/**
 * Extracts metrics from canonical span attributes only.
 * After canonicalization, tokens are at gen_ai.usage.input_tokens/output_tokens.
 * Falls back to gen_ai.usage.prompt_tokens/completion_tokens for compat.
 */
function extractMetrics(
  spanAttributes: NormalizedAttributes,
): SpanMetrics | null {
  const promptTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.input_tokens"] ??
      spanAttributes["gen_ai.usage.prompt_tokens"],
  );

  const completionTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.output_tokens"] ??
      spanAttributes["gen_ai.usage.completion_tokens"],
  );

  const reasoningTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.reasoning_tokens"],
  );
  const tokensEstimated = spanAttributes["langwatch.tokens.estimated"];

  // Canonical name with Mastra non-standard fallback
  const cacheReadInputTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.cache_read.input_tokens"] ??
      spanAttributes["gen_ai.usage.cached_input_tokens"],
  );
  const cacheCreationInputTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.cache_creation.input_tokens"],
  );

  const rawCost = computeSpanCost({ attrs: spanAttributes, promptTokens, completionTokens });
  const cost = rawCost > 0 ? rawCost : null;

  if (
    promptTokens === null &&
    completionTokens === null &&
    reasoningTokens === null &&
    cost === null &&
    cacheReadInputTokens === null &&
    cacheCreationInputTokens === null &&
    typeof tokensEstimated !== "boolean"
  ) {
    return null;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
    cost: cost,
    tokens_estimated:
      typeof tokensEstimated === "boolean" ? tokensEstimated : null,
  };
}

/**
 * Extracts model name from canonical span attributes only.
 * After canonicalization, model is at gen_ai.response.model / gen_ai.request.model.
 */
function extractModel(spanAttributes: NormalizedAttributes): string | null {
  const model =
    spanAttributes["gen_ai.response.model"] ??
    spanAttributes["gen_ai.request.model"];

  return typeof model === "string" ? model : null;
}

/**
 * Extracts vendor from canonical span attributes only.
 * After canonicalization, vendor is at gen_ai.system / gen_ai.provider.name.
 */
function extractVendor(spanAttributes: NormalizedAttributes): string | null {
  const vendor =
    spanAttributes["gen_ai.provider.name"] ??
    spanAttributes["gen_ai.system"];

  return typeof vendor === "string" ? vendor : null;
}

/**
 * Extracts RAG contexts from canonical span attributes only.
 * After canonicalization, RAG contexts are at langwatch.rag.contexts.
 */
function extractContexts(
  spanAttributes: NormalizedAttributes,
): RAGChunk[] | undefined {
  const contexts = spanAttributes["langwatch.rag.contexts"];

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
  spanAttributes: NormalizedAttributes,
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
 * Converts flat dot-notation keys into nested objects.
 * e.g. {"gen_ai.usage.input_tokens": 100} → {"gen_ai": {"usage": {"input_tokens": 100}}}
 * Keys without dots stay at top level. Leaf values (arrays, objects, scalars) stay as-is.
 *
 * Delegates to shared safeUnflatten utility which uses Object.create(null)
 * and DANGEROUS_KEYS blocklist for prototype pollution protection.
 *
 * @internal Exported for unit testing
 */
export function unflattenDotNotation(
  flat: NormalizedAttributes,
): Record<string, unknown> {
  return safeUnflatten(flat as Record<string, unknown>);
}

/**
 * Maps a NormalizedSpan (from ClickHouse stored_spans) to the legacy Span type
 * used by the Elasticsearch-based trace system.
 */
export function mapNormalizedSpanToSpan(normalizedSpan: NormalizedSpan): Span {
  const timestamps: SpanTimestamps = {
    started_at: normalizedSpan.startTimeUnixMs,
    finished_at: normalizedSpan.endTimeUnixMs,
    first_token_at: null,
  };

  // Check for first token event
  const firstTokenEvent = normalizedSpan.events.find(
    (e) => e.name === "first_token" || e.name === "gen_ai.content.first_token",
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
      normalizedSpan.spanAttributes,
    ),
    timestamps,
    metrics: extractMetrics(normalizedSpan.spanAttributes),
    params: unflattenDotNotation(normalizedSpan.spanAttributes),
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
  normalizedSpans: NormalizedSpan[],
): Span[] {
  return normalizedSpans.map(mapNormalizedSpanToSpan);
}
