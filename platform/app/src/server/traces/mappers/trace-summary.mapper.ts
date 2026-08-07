import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "~/server/app-layer/traces/canonicalisation/extractors/_messages";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type {
  ErrorCapture,
  Event,
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
const FALLBACK_ATTRIBUTE_MAPPINGS: Record<string, keyof TraceMetadata> = {
  // LangGraph thread ID — gen_ai.conversation.id takes precedence
  "langgraph.thread_id": "thread_id",
};

/** Map known attributes to reserved fields (primary — last-wins within this set). */
function applyReservedAttributeMappings(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): void {
  for (const [attrKey, metadataKey] of Object.entries(
    RESERVED_ATTRIBUTE_MAPPINGS,
  )) {
    const value = attributes[attrKey];
    if (value !== void 0) {
      metadata[metadataKey] = value;
    }
  }
}

/** Map fallback attributes (only if target field not already set). */
function applyFallbackAttributeMappings(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): void {
  for (const [attrKey, metadataKey] of Object.entries(
    FALLBACK_ATTRIBUTE_MAPPINGS,
  )) {
    const value = attributes[attrKey];
    if (value !== void 0 && metadata[metadataKey] === undefined) {
      metadata[metadataKey] = value;
    }
  }
}

/** Add topic IDs. */
function applyTopicIds(
  metadata: TraceMetadata,
  topicId: string | null,
  subTopicId: string | null,
): void {
  if (topicId) {
    metadata.topic_id = topicId;
  }
  if (subTopicId) {
    metadata.subtopic_id = subTopicId;
  }
}

/** Extract labels if present. */
function applyLabelsMetadata(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): void {
  const labelsStr = attributes["langwatch.labels"] ?? attributes.labels;
  if (!labelsStr) return;
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

/** Extract prompt IDs if present. */
function applyPromptIdsMetadata(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): void {
  const promptIdsStr = attributes["langwatch.prompt_ids"];
  if (!promptIdsStr) return;
  try {
    const promptIds = JSON.parse(promptIdsStr);
    if (Array.isArray(promptIds)) {
      metadata.prompt_ids = promptIds;
    }
  } catch {
    // Ignore parse errors
  }
}

/**
 * The fold stamps `metadata.models` as a JSON array string (the set of
 * models the trace's spans used, most-recent-first); surface it as a real
 * array like labels/prompt_ids. `metadata.model` (the primary) flows
 * through the generic passthrough below as a plain string.
 * A value that is not a JSON array is not ours: it stays reachable through
 * the generic passthrough below with its original string value.
 *
 * @returns true when `metadata.models` was parsed as a JSON array — the
 *   caller then excludes the raw `metadata.models` attribute from the
 *   generic passthrough.
 */
function applyModelsMetadata(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): boolean {
  const modelsStr = attributes["metadata.models"];
  if (!modelsStr) return false;
  try {
    const models = JSON.parse(modelsStr);
    if (Array.isArray(models)) {
      metadata.models = models;
      return true;
    }
  } catch {
    // Ignore parse errors
  }
  return false;
}

/** Add remaining attributes as custom metadata. */
function applyCustomMetadata(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
  modelsParsedAsArray: boolean,
): void {
  const knownKeys = new Set([
    ...Object.keys(RESERVED_ATTRIBUTE_MAPPINGS),
    ...Object.keys(FALLBACK_ATTRIBUTE_MAPPINGS),
    "langwatch.labels",
    "labels",
    "langwatch.prompt_ids",
    "langwatch.prompt_version_ids",
    // Fold-internal bookkeeping for the metadata.model stamp; not user metadata.
    "langwatch.reserved.model_metadata_stamped",
  ]);
  if (modelsParsedAsArray) {
    knownKeys.add("metadata.models");
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (knownKeys.has(key)) continue;
    // Strip internal metadata. prefix so API returns bare keys (e.g., "user" not "metadata.user")
    const bareKey = key.startsWith("metadata.")
      ? key.slice("metadata.".length)
      : key;
    if (bareKey && metadata[bareKey] === undefined) metadata[bareKey] = value;
  }
}

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

  applyReservedAttributeMappings(metadata, attributes);
  applyFallbackAttributeMappings(metadata, attributes);
  applyTopicIds(metadata, topicId, subTopicId);
  applyLabelsMetadata(metadata, attributes);
  applyPromptIdsMetadata(metadata, attributes);
  const modelsParsedAsArray = applyModelsMetadata(metadata, attributes);
  applyCustomMetadata(metadata, attributes, modelsParsedAsArray);
  addOtelLogRecordCountAlias(metadata, attributes);

  return metadata;
}

/**
 * Clearly named sibling for the OTel log-record count: it counts log records
 * correlated to the trace, not model/API calls, and the raw
 * `langwatch.reserved.log_record_count` key keeps flowing unchanged because
 * external consumers already parse it. A caller-supplied metadata key with
 * this name wins (set by the generic passthrough before this runs).
 */
function addOtelLogRecordCountAlias(
  metadata: TraceMetadata,
  attributes: Record<string, string>,
): void {
  const logRecordCount = attributes["langwatch.reserved.log_record_count"];
  if (
    logRecordCount !== undefined &&
    metadata.otel_log_record_count === undefined
  ) {
    metadata.otel_log_record_count = logRecordCount;
  }
}

/**
 * Reserved token attributes stamped by the trace-summary fold, surfaced as
 * typed metric fields on the legacy trace shape (and selectable through the
 * projection DSL's `metrics.*` paths). Additive next to the six legacy metric
 * fields: an absent attribute adds no key, and nothing existing is renamed or
 * removed because the search/export response is a compatibility surface for
 * BI consumers.
 */
const RESERVED_TOKEN_METRIC_ATTRIBUTES = {
  cache_read_input_tokens: "langwatch.reserved.cache_read_tokens",
  cache_creation_input_tokens: "langwatch.reserved.cache_creation_tokens",
  cache_creation_5m_input_tokens: "langwatch.reserved.cache_creation_5m_tokens",
  cache_creation_1h_input_tokens: "langwatch.reserved.cache_creation_1h_tokens",
  reasoning_tokens: "langwatch.reserved.reasoning_tokens",
  context_size_tokens: "langwatch.reserved.context_size_tokens",
} as const satisfies Partial<
  Record<keyof NonNullable<Trace["metrics"]>, string>
>;

function tokenMetricsFromAttributes(
  attributes: Record<string, string>,
): Partial<Record<keyof typeof RESERVED_TOKEN_METRIC_ATTRIBUTES, number>> {
  const metrics: Partial<
    Record<keyof typeof RESERVED_TOKEN_METRIC_ATTRIBUTES, number>
  > = {};
  for (const [metricKey, attrKey] of Object.entries(
    RESERVED_TOKEN_METRIC_ATTRIBUTES,
  ) as Array<[keyof typeof RESERVED_TOKEN_METRIC_ATTRIBUTES, string]>) {
    const raw = attributes[attrKey];
    if (raw == null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) metrics[metricKey] = value;
  }
  return metrics;
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
 * Maximum recursion depth for state-object text extraction. Real-world payloads
 * are shallow (~3-5 levels); 32 is generous while still protecting against
 * pathological / adversarial deeply-nested JSON.
 */
const MAX_STATE_OBJECT_RECURSION_DEPTH = 32;

/**
 * Extracts text from a state object by looking for common field names.
 *
 * @param obj - The state object to extract from
 * @param fieldNames - Array of field names to try (in priority order)
 * @param depth - Internal recursion counter; callers should leave at default
 * @returns The extracted text, or null if not found
 */
function extractTextFromStateObject(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
  depth = 0,
): string | null {
  if (depth >= MAX_STATE_OBJECT_RECURSION_DEPTH) return null;

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
      return extractTextFromStateObject(
        only as Record<string, unknown>,
        fieldNames,
        depth + 1,
      );
    }
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
 * Extracts text from an array of chat messages: for input mode, prefers the
 * last user message; otherwise (and as a fallback) concatenates every
 * message's text with newlines.
 */
function extractTextFromMessageArray(
  messages: unknown[],
  mode: "input" | "output",
): string | null {
  if (mode === "input") {
    const lastUserText = extractLastUserMessageText(messages);
    if (lastUserText) return lastUserText;
  }
  const texts = messages
    .map((msg) => extractMessageContentText(msg))
    .filter((t): t is string => t !== null);
  return texts.length > 0 ? texts.join("\n") : null;
}

/** Result of {@link tryExtractFromStructuredValue}: `handled: false` tells the caller to fall through. */
type StructuredValueExtraction =
  | { handled: true; text: string | null }
  | { handled: false };

/**
 * Attempts extraction from a LangWatch structured value wrapper
 * (`{type: "json"|"chat_messages", value: ...}`). Returns `handled: false`
 * when the wrapper's `type`/`value` shape isn't one of the recognized cases,
 * so the caller falls through to treating `data` itself as a message.
 */
function tryExtractFromStructuredValue(
  structured: { type: string; value: unknown },
  mode: "input" | "output",
): StructuredValueExtraction {
  const { type, value } = structured;

  if (type === "chat_messages" && Array.isArray(value)) {
    return { handled: true, text: extractTextFromMessageArray(value, mode) };
  }

  if (type === "json" && typeof value === "object" && value !== null) {
    // Extract text from state object using common field names
    const fieldNames =
      mode === "input" ? INPUT_FIELD_NAMES : OUTPUT_FIELD_NAMES;
    return {
      handled: true,
      text: extractTextFromStateObject(
        value as Record<string, unknown>,
        fieldNames,
      ),
    };
  }

  // For other types, try to extract from the value
  if (typeof value === "string") {
    return { handled: true, text: value };
  }

  return { handled: false };
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
    const outcome = tryExtractFromStructuredValue(data, mode);
    if (outcome.handled) return outcome.text;
  }

  // Handle array of messages directly
  if (Array.isArray(data)) {
    return extractTextFromMessageArray(data, mode);
  }

  // Handle single message object
  if (typeof data === "object" && data !== null) {
    return extractMessageContentText(data);
  }

  return null;
}

/**
 * Reads annotated value types from the trace summary attributes.
 * Returns true if the given attribute key has the specified type.
 */
function hasAnnotatedType(
  attributes: Record<string, string>,
  attrKey: string,
  type: string,
): boolean {
  const raw = attributes["langwatch.reserved.value_types"];
  if (!raw) return false;
  try {
    const arr: string[] = JSON.parse(raw);
    return arr.includes(`${attrKey}=${type}`);
  } catch {
    return false;
  }
}

/**
 * Parses the computed input string to TraceInput format.
 * Uses value type annotations from attributes when available to avoid
 * heuristic guessing.
 *
 * @param computedInput - The computed input string from ClickHouse
 * @param attributes - Trace summary attributes (for value type hints)
 * @returns TraceInput with extracted text value
 */
function parseComputedInput(
  computedInput: string | null,
  attributes: Record<string, string>,
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
      const text = extractTextFromMessages(parsed, "input");
      if (text) return { value: text };
    }

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
 * Uses value type annotations from attributes when available to avoid
 * heuristic guessing.
 *
 * @param computedOutput - The computed output string from ClickHouse
 * @param attributes - Trace summary attributes (for value type hints)
 * @returns TraceOutput with extracted text value
 */
function parseComputedOutput(
  computedOutput: string | null,
  attributes: Record<string, string>,
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
      const text = extractTextFromMessages(parsed, "output");
      if (text) return { value: text };
    }

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

/** Extracts a `Record<string, number>` from `raw`; non-numeric entries are dropped. */
function extractNumericRecord(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      result[key] = num;
    }
  }
  return result;
}

/** Extracts a `Record<string, string>` from `raw`, keeping only string values. */
function extractStringRecord(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Builds an Event from a span carrying `event.type` in its attributes, or
 * null when the span has no (or malformed) event data.
 */
function buildEventFromSpan({
  span,
  projectId,
  traceId,
}: {
  span: Span;
  projectId: string;
  traceId: string;
}): Event | null {
  const eventObj = span.params?.event;
  if (typeof eventObj !== "object" || eventObj === null) return null;

  const eventRecord = eventObj as Record<string, unknown>;
  const eventType = eventRecord.type;
  if (typeof eventType !== "string" || !eventType) return null;

  return {
    event_id: span.span_id,
    event_type: eventType,
    project_id: projectId,
    metrics: extractNumericRecord(eventRecord.metrics),
    event_details: extractStringRecord(eventRecord.details),
    trace_id: traceId,
    timestamps: {
      started_at: span.timestamps.started_at,
      inserted_at: span.timestamps.started_at,
      updated_at: span.timestamps.finished_at,
    },
  };
}

/**
 * Extracts Event objects from spans that have event.type in their attributes.
 * Events are stored in ClickHouse as spans with event.* span attributes.
 * After unflattening, these appear as params.event.type, params.event.metrics.*, etc.
 */
export function extractEventsFromSpans({
  spans,
  projectId,
  traceId,
}: {
  spans: Span[];
  projectId: string;
  traceId: string;
}): Event[] {
  const events: Event[] = [];

  for (const span of spans) {
    const event = buildEventFromSpan({ span, projectId, traceId });
    if (event) events.push(event);
  }

  return events;
}

/**
 * Maps a TraceSummaryData (from ClickHouse trace_summaries) and its associated spans
 * to the legacy Trace type used by the pre-ClickHouse trace system.
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

  const events = extractEventsFromSpans({
    spans,
    projectId,
    traceId: summary.traceId,
  });

  const trace: Trace = {
    trace_id: summary.traceId,
    project_id: projectId,
    metadata,
    timestamps: {
      // The span timing baseline where the trace has one, otherwise the storage
      // anchor (ADR-087). A trace whose only signal is a log record has no span
      // start to report; before the anchor existed it reported the epoch, which
      // rendered as 1970 in the drawer and the list. The anchor is the time that
      // trace's first signal was accepted, which is the honest answer.
      started_at:
        summary.occurredAt > 0
          ? summary.occurredAt
          : (summary.storageAnchorMs ?? 0),
      inserted_at: summary.createdAt,
      updated_at: summary.updatedAt,
    },
    input: parseComputedInput(summary.computedInput, summary.attributes),
    output: parseComputedOutput(summary.computedOutput, summary.attributes),
    metrics: {
      first_token_ms: summary.timeToFirstTokenMs,
      total_time_ms: summary.totalDurationMs,
      prompt_tokens: summary.totalPromptTokenCount,
      completion_tokens: summary.totalCompletionTokenCount,
      total_cost: summary.totalCost,
      tokens_estimated: summary.tokensEstimated,
      ...tokenMetricsFromAttributes(summary.attributes),
    },
    error: createError(summary.containsErrorStatus, summary.errorMessage),
    events: events.length > 0 ? events : undefined,
    spans,
  };

  return trace;
}
