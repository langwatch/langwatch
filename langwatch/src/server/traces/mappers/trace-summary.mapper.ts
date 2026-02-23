import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type {
  ErrorCapture,
  Span,
  Trace,
  TraceInput,
  TraceMetadata,
  TraceOutput,
} from "~/server/tracer/types";

/**
 * Known attribute keys that map to reserved TraceMetadata fields.
 */
const RESERVED_ATTRIBUTE_MAPPINGS: Record<string, keyof TraceMetadata> = {
  "thread.id": "thread_id",
  "langwatch.thread_id": "thread_id",
  "langgraph.thread_id": "thread_id",
  "gen_ai.conversation.id": "thread_id",
  "user.id": "user_id",
  "langwatch.user_id": "user_id",
  "customer.id": "customer_id",
  "langwatch.customer_id": "customer_id",
  "sdk.name": "sdk_name",
  "sdk.version": "sdk_version",
  "sdk.language": "sdk_language",
  "telemetry.sdk.name": "telemetry_sdk_name",
  "telemetry.sdk.version": "telemetry_sdk_version",
  "telemetry.sdk.language": "telemetry_sdk_language",
};

/**
 * Maps TraceSummaryData.attributes to the legacy TraceMetadata format.
 *
 * The Attributes map in ClickHouse stores various metadata using semantic
 * convention keys. These need to be mapped to the flat TraceMetadata structure.
 */
export function mapAttributesToMetadata(
  attributes: Record<string, string>,
  topicId: string | null,
  subTopicId: string | null,
): TraceMetadata {
  const metadata: TraceMetadata = {};

  // Map known attributes to reserved fields
  for (const [attrKey, metadataKey] of Object.entries(
    RESERVED_ATTRIBUTE_MAPPINGS,
  )) {
    const value = attributes[attrKey];
    if (value !== void 0) {
      metadata[metadataKey] = value;
    }
  }

  // Add topic IDs
  if (topicId) {
    metadata.topic_id = topicId;
  }
  if (subTopicId) {
    metadata.subtopic_id = subTopicId;
  }

  // Extract labels if present
  const labelsStr = attributes["langwatch.labels"] ?? attributes.labels;
  if (labelsStr) {
    try {
      const labels = JSON.parse(labelsStr);
      if (Array.isArray(labels)) {
        metadata.labels = labels;
      }
    } catch {
      // If not valid JSON, treat as single label
      metadata.labels = [labelsStr];
    }
  }

  // Extract prompt IDs if present
  const promptIdsStr = attributes["langwatch.prompt_ids"];
  if (promptIdsStr) {
    try {
      const promptIds = JSON.parse(promptIdsStr);
      if (Array.isArray(promptIds)) {
        metadata.prompt_ids = promptIds;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Add remaining attributes as custom metadata
  const knownKeys = new Set([
    ...Object.keys(RESERVED_ATTRIBUTE_MAPPINGS),
    "langwatch.labels",
    "labels",
    "langwatch.prompt_ids",
    "langwatch.prompt_version_ids",
  ]);

  for (const [key, value] of Object.entries(attributes)) {
    if (!knownKeys.has(key)) {
      // Store as custom metadata
      metadata[key] = value;
    }
  }

  return metadata;
}

/**
 * Common field names used for input text in state objects (e.g., LangGraph).
 */
const INPUT_FIELD_NAMES = [
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
const OUTPUT_FIELD_NAMES = [
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
 * Extracts text from a state object by looking for common field names.
 *
 * @param obj - The state object to extract from
 * @param fieldNames - Array of field names to try (in priority order)
 * @returns The extracted text, or null if not found
 */
function extractTextFromStateObject(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
): string | null {
  for (const field of fieldNames) {
    const value = obj[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Extracts text content from a single message object.
 * Handles various message formats: OpenAI, Anthropic, generic.
 *
 * @param msg - The message object to extract content from
 * @returns The extracted text content, or null if not found
 */
function extractMessageContent(msg: unknown): string | null {
  if (typeof msg !== "object" || msg === null) return null;
  const obj = msg as Record<string, unknown>;

  // Check for content field (OpenAI format)
  if (typeof obj.content === "string") return obj.content;

  // Check for text field
  if (typeof obj.text === "string") return obj.text;

  // Handle content array (multimodal messages)
  if (Array.isArray(obj.content)) {
    const texts = obj.content
      .filter(
        (p: unknown): p is Record<string, unknown> =>
          typeof p === "object" && p !== null,
      )
      .map((p) => {
        if (typeof p.text === "string") return p.text;
        if (typeof p.content === "string") return p.content;
        return null;
      })
      .filter((t): t is string => typeof t === "string");
    return texts.length > 0 ? texts.join("\n") : null;
  }

  return null;
}

/**
 * Type guard for LangWatch structured value format.
 * Used by DSPy, LangGraph, and other frameworks.
 */
function isStructuredValue(
  data: unknown,
): data is { type: string; value: unknown } {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    "value" in data &&
    typeof (data as Record<string, unknown>).type === "string"
  );
}

/**
 * Extracts human-readable text from various message formats.
 * Handles: chat messages arrays, structured values, state objects.
 *
 * @param data - The data to extract text from
 * @param mode - Whether extracting input or output (affects field priority)
 * @returns The extracted text, or null if extraction failed
 */
function extractTextFromMessages(
  data: unknown,
  mode: "input" | "output" = "input",
): string | null {
  // Handle LangWatch structured value wrapper: {type: "json"|"chat_messages", value: ...}
  if (isStructuredValue(data)) {
    const { type, value } = data;

    if (type === "chat_messages" && Array.isArray(value)) {
      // Extract text from chat messages array
      const texts = value
        .map((msg) => extractMessageContent(msg))
        .filter((t): t is string => t !== null);
      return texts.length > 0 ? texts.join("\n") : null;
    }

    if (type === "json" && typeof value === "object" && value !== null) {
      // Extract text from state object using common field names
      const fieldNames =
        mode === "input" ? INPUT_FIELD_NAMES : OUTPUT_FIELD_NAMES;
      return extractTextFromStateObject(
        value as Record<string, unknown>,
        fieldNames,
      );
    }

    // For other types, try to extract from the value
    if (typeof value === "string") {
      return value;
    }
  }

  // Handle array of messages directly
  if (Array.isArray(data)) {
    const texts = data
      .map((msg) => extractMessageContent(msg))
      .filter((t): t is string => t !== null);
    return texts.length > 0 ? texts.join("\n") : null;
  }

  // Handle single message object
  if (typeof data === "object" && data !== null) {
    return extractMessageContent(data);
  }

  return null;
}

/**
 * Parses the computed input string to TraceInput format.
 * Attempts to extract text from chat message formats.
 *
 * @param computedInput - The computed input string from ClickHouse
 * @returns TraceInput with extracted text value
 */
function parseComputedInput(
  computedInput: string | null,
): TraceInput | undefined {
  if (!computedInput) {
    return void 0;
  }

  // Try to parse as JSON and extract text from chat messages
  try {
    const parsed = JSON.parse(computedInput);
    const text = extractTextFromMessages(parsed, "input");
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

/**
 * Parses the computed output string to TraceOutput format.
 * Attempts to extract text from chat message formats.
 *
 * @param computedOutput - The computed output string from ClickHouse
 * @returns TraceOutput with extracted text value
 */
function parseComputedOutput(
  computedOutput: string | null,
): TraceOutput | undefined {
  if (!computedOutput) {
    return void 0;
  }

  // Try to parse as JSON and extract text from chat messages
  try {
    const parsed = JSON.parse(computedOutput);
    const text = extractTextFromMessages(parsed, "output");
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
function createError(
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

/**
 * Maps a TraceSummaryData (from ClickHouse trace_summaries) and its associated spans
 * to the legacy Trace type used by the Elasticsearch-based system.
 */
export function mapTraceSummaryToTrace(
  summary: TraceSummaryData,
  spans: Span[],
  projectId: string,
): Trace {
  const metadata = mapAttributesToMetadata(
    summary.attributes,
    summary.topicId,
    summary.subTopicId,
  );

  const trace: Trace = {
    trace_id: summary.traceId,
    project_id: projectId,
    metadata,
    timestamps: {
      started_at: summary.createdAt,
      inserted_at: summary.createdAt,
      updated_at: summary.lastUpdatedAt,
    },
    input: parseComputedInput(summary.computedInput),
    output: parseComputedOutput(summary.computedOutput),
    metrics: {
      first_token_ms: summary.timeToFirstTokenMs,
      total_time_ms: summary.totalDurationMs,
      prompt_tokens: summary.totalPromptTokenCount,
      completion_tokens: summary.totalCompletionTokenCount,
      total_cost: summary.totalCost,
      tokens_estimated: summary.tokensEstimated,
    },
    error: createError(summary.containsErrorStatus, summary.errorMessage),
    spans,
  };

  return trace;
}
