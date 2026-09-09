/**
 * Reading a legacy trace's metadata, metrics and headline input and output out of the summary
 * row's attributes. Pure: the mapping tables and the text extraction live in one place, so the
 * mapper, the search response and their tests all agree on how each field was spelled.
 */

import type {
  ErrorCapture,
  Trace,
  TraceCanonicalisationService,
  TraceInput,
  TraceMetadata,
  TraceOutput,
} from "@langwatch/trace-contract";

/**
 * Known attribute keys that map to reserved TraceMetadata fields.
 */
export const RESERVED_ATTRIBUTE_MAPPINGS: Record<string, keyof TraceMetadata> = {
  // Canonical keys (set by canonicalization)
  "gen_ai.conversation.id": "thread_id",
  "langwatch.user_id": "user_id",
  "langwatch.customer_id": "customer_id",
  // SDK info (extracted from resource attributes)
  "sdk.name": "sdk_name",
  "sdk.version": "sdk_version",
  "sdk.language": "sdk_language",
  "telemetry.sdk.name": "telemetry_sdk_name",
  "telemetry.sdk.version": "telemetry_sdk_version",
  "telemetry.sdk.language": "telemetry_sdk_language",
};

/**
 * Lower-priority attribute mappings: only applied if the target metadata
 * field is not already set by a primary mapping above.
 */
export const FALLBACK_ATTRIBUTE_MAPPINGS: Record<string, keyof TraceMetadata> = {
  // LangGraph thread ID — gen_ai.conversation.id takes precedence
  "langgraph.thread_id": "thread_id",
};

/**
 * Clearly named sibling for the OTel log-record count: it counts log records correlated to the
 * trace, not model calls, while the raw reserved key keeps flowing for external consumers. A
 * caller-supplied metadata key with this name wins, set by the generic passthrough before this.
 */
export function addOtelLogRecordCountAlias(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): void {
  const logRecordCount = attributes["langwatch.reserved.log_record_count"];
  if (logRecordCount !== undefined && metadata.otel_log_record_count === undefined) {
    metadata.otel_log_record_count = logRecordCount;
  }
}

/**
 * Reserved token attributes stamped by the trace-summary fold, surfaced as typed metric fields on
 * the legacy trace shape. Additive next to the six legacy metric fields: an absent attribute adds
 * no key, and nothing is renamed, since the search and export response is a compatibility surface.
 */
export const RESERVED_TOKEN_METRIC_ATTRIBUTES = {
  cache_read_input_tokens: "langwatch.reserved.cache_read_tokens",
  cache_creation_input_tokens: "langwatch.reserved.cache_creation_tokens",
  cache_creation_5m_input_tokens: "langwatch.reserved.cache_creation_5m_tokens",
  cache_creation_1h_input_tokens: "langwatch.reserved.cache_creation_1h_tokens",
  reasoning_tokens: "langwatch.reserved.reasoning_tokens",
  context_size_tokens: "langwatch.reserved.context_size_tokens",
} as const satisfies Partial<Record<keyof NonNullable<Trace["metrics"]>, string>>;

export function tokenMetricsFromAttributes(
  attributes: Record<string, string>,
): Partial<Record<keyof typeof RESERVED_TOKEN_METRIC_ATTRIBUTES, number>> {
  const metrics: Partial<Record<keyof typeof RESERVED_TOKEN_METRIC_ATTRIBUTES, number>> = {};
  for (const [metricKey, attrKey] of Object.entries(RESERVED_TOKEN_METRIC_ATTRIBUTES) as Array<
    [keyof typeof RESERVED_TOKEN_METRIC_ATTRIBUTES, string]
  >) {
    const raw = attributes[attrKey];
    if (raw == null || raw === "") {
      continue;
    }

    const value = Number(raw);
    if (Number.isFinite(value)) {
      metrics[metricKey] = value;
    }
  }

  return metrics;
}

/**
 * Common field names used for input text in state objects (e.g., LangGraph).
 */
export const INPUT_FIELD_NAMES = [
  "question",
  "input",
  "query",
  "message",
  "content",
  "text",
  "prompt",
  "user_input",
] as const;

/**
 * Common field names used for output text in state objects (e.g., LangGraph).
 */
export const OUTPUT_FIELD_NAMES = [
  "final_answer",
  "output",
  "answer",
  "response",
  "result",
  "content",
  "message",
  "text",
  "assistant_response",
] as const;

/**
 * Maximum recursion depth for state-object text extraction. Real-world payloads
 * are shallow (~3-5 levels); 32 is generous while still protecting against
 * pathological / adversarial deeply-nested JSON.
 */
const MAX_STATE_OBJECT_RECURSION_DEPTH = 32;

/**
 * @param obj - State object; @param fieldNames - Field names to try, priority order
 * @param depth - Internal recursion counter; callers should leave at default
 * @returns The extracted text, or null if not found
 */
function extractTextFromStateObject(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
  depth = 0,
): string | null {
  if (depth >= MAX_STATE_OBJECT_RECURSION_DEPTH) {
    return null;
  }

  for (const field of fieldNames) {
    const value = obj[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  // Single-key wrapper fallback (e.g. `{ data: { content: "..." } }`,
  // `{ result: { answer: "..." } }`). Recurse into the inner object so the
  // fixed field-name loop above gets a chance against the unwrapped payload.
  const entries = Object.entries(obj);
  if (entries.length === 1) {
    const [, only] = entries[0]!;
    if (only && typeof only === "object" && !Array.isArray(only)) {
      return extractTextFromStateObject(only as Record<string, unknown>, fieldNames, depth + 1);
    }
  }

  return null;
}

/**
 * Type guard for LangWatch structured value format.
 * Used by DSPy, LangGraph, and other frameworks.
 */
function isStructuredValue(data: unknown): data is { type: string; value: unknown } {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    "value" in data &&
    typeof (data as Record<string, unknown>).type === "string"
  );
}

/**
 * @param data - Chat message arrays, structured values, or state objects to extract text from
 * @param mode - Whether extracting input or output (affects field priority)
 * @returns The extracted text, or null if extraction failed
 */
function extractTextFromMessages(
  data: unknown,
  mode: "input" | "output",
  traceCanonicalisation: TraceCanonicalisationService,
): string | null {
  // Handle LangWatch structured value wrapper: {type: "json"|"chat_messages", value: ...}
  if (isStructuredValue(data)) {
    const { type, value } = data;

    if (type === "chat_messages" && Array.isArray(value)) {
      return traceCanonicalisation.tryExtractMessageText({ value, mode });
    }

    if (type === "json" && typeof value === "object" && value !== null) {
      // Extract text from state object using common field names
      const fieldNames = mode === "input" ? INPUT_FIELD_NAMES : OUTPUT_FIELD_NAMES;

      return extractTextFromStateObject(value as Record<string, unknown>, fieldNames);
    }

    // For other types, try to extract from the value
    if (typeof value === "string") {
      return value;
    }
  }

  // Handle array of messages directly
  if (Array.isArray(data)) {
    return traceCanonicalisation.tryExtractMessageText({ value: data, mode });
  }

  // Handle single message object
  if (typeof data === "object" && data !== null) {
    return traceCanonicalisation.tryExtractMessageText({ value: data, mode });
  }

  return null;
}

/**
 * Reads annotated value types from the trace summary attributes.
 * Returns true if the given attribute key has the specified type.
 */
export function hasAnnotatedType(
  attributes: Record<string, string>,
  attrKey: string,
  type: string,
): boolean {
  const raw = attributes["langwatch.reserved.value_types"];
  if (!raw) {
    return false;
  }

  try {
    const arr: string[] = JSON.parse(raw);

    return arr.includes(`${attrKey}=${type}`);
  } catch {
    return false;
  }
}

/** Value type annotations from attributes are used when available to avoid heuristic guessing. */
export function parseComputedInput(
  computedInput: string | null,
  attributes: Record<string, string>,
  traceCanonicalisation: TraceCanonicalisationService,
): TraceInput | undefined {
  if (!computedInput) {
    return void 0;
  }

  // Check value type annotation for a hint
  const isChatMessages =
    hasAnnotatedType(attributes, "gen_ai.input.messages", "chat_messages") ||
    hasAnnotatedType(attributes, "langwatch.input", "chat_messages");

  // Try to parse as JSON and extract text from chat messages
  try {
    const parsed = JSON.parse(computedInput);

    // If annotated as chat_messages, treat as message array
    if (isChatMessages && Array.isArray(parsed)) {
      const text = extractTextFromMessages(parsed, "input", traceCanonicalisation);
      if (text) {
        return { value: text };
      }
    }

    const text = extractTextFromMessages(parsed, "input", traceCanonicalisation);
    if (text) {
      return { value: text };
    }
  } catch {
    // Not JSON, use as-is
  }

  return {
    value: computedInput,
  };
}

/** Value type annotations from attributes are used when available to avoid heuristic guessing. */
export function parseComputedOutput(
  computedOutput: string | null,
  attributes: Record<string, string>,
  traceCanonicalisation: TraceCanonicalisationService,
): TraceOutput | undefined {
  if (!computedOutput) {
    return void 0;
  }

  // Check value type annotation for a hint
  const isChatMessages =
    hasAnnotatedType(attributes, "gen_ai.output.messages", "chat_messages") ||
    hasAnnotatedType(attributes, "langwatch.output", "chat_messages");

  // Try to parse as JSON and extract text from chat messages
  try {
    const parsed = JSON.parse(computedOutput);

    // If annotated as chat_messages, treat as message array
    if (isChatMessages && Array.isArray(parsed)) {
      const text = extractTextFromMessages(parsed, "output", traceCanonicalisation);
      if (text) {
        return { value: text };
      }
    }

    const text = extractTextFromMessages(parsed, "output", traceCanonicalisation);
    if (text) {
      return { value: text };
    }
  } catch {
    // Not JSON, use as-is
  }

  return {
    value: computedOutput,
  };
}

/**
 * Creates an ErrorCapture from trace summary error information.
 */
export function createError(
  containsErrorStatus: boolean,
  errorMessage: string | null,
): ErrorCapture | null {
  if (!containsErrorStatus) {
    return null;
  }

  return {
    has_error: true,
    message: errorMessage ?? "Unknown error",
    stacktrace: [],
  };
}

/** A stamped JSON array, or null when the attribute is absent, unparseable, or not an array. */
export function tryParseJsonArray(value: string | undefined): string[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
