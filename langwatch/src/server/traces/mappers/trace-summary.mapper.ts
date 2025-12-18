import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummaryProjection";
import type { Span, Trace, TraceMetadata, ErrorCapture, TraceInput, TraceOutput } from "~/server/tracer/types";

/**
 * Known attribute keys that map to reserved TraceMetadata fields.
 */
const RESERVED_ATTRIBUTE_MAPPINGS: Record<string, keyof TraceMetadata> = {
  "thread.id": "thread_id",
  "langwatch.thread_id": "thread_id",
  "langgraph.thread_id": "thread_id",
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
 * Maps TraceSummaryData.Attributes to the legacy TraceMetadata format.
 *
 * The Attributes map in ClickHouse stores various metadata using semantic
 * convention keys. These need to be mapped to the flat TraceMetadata structure.
 */
export function mapAttributesToMetadata(
  attributes: Record<string, string>,
  topicId: string | null,
  subTopicId: string | null
): TraceMetadata {
  const metadata: TraceMetadata = {};

  // Map known attributes to reserved fields
  for (const [attrKey, metadataKey] of Object.entries(RESERVED_ATTRIBUTE_MAPPINGS)) {
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
  const labelsStr = attributes["langwatch.labels"] ?? attributes["labels"];
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
    "langwatch.labels", "labels",
    "langwatch.prompt_ids", "langwatch.prompt_version_ids",
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
 * Parses the computed input string to TraceInput format.
 */
function parseComputedInput(computedInput: string | null): TraceInput | undefined {
  if (!computedInput) {
    return void 0;
  }

  return {
    value: computedInput,
  };
}

/**
 * Parses the computed output string to TraceOutput format.
 */
function parseComputedOutput(computedOutput: string | null): TraceOutput | undefined {
  if (!computedOutput) {
    return void 0;
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
  errorMessage: string | null
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
  projectId: string
): Trace {
  const metadata = mapAttributesToMetadata(
    summary.Attributes,
    summary.TopicId,
    summary.SubTopicId
  );

  const trace: Trace = {
    trace_id: summary.TraceId,
    project_id: projectId,
    metadata,
    timestamps: {
      started_at: summary.CreatedAt,
      inserted_at: summary.CreatedAt,
      updated_at: summary.LastUpdatedAt,
    },
    input: parseComputedInput(summary.ComputedInput),
    output: parseComputedOutput(summary.ComputedOutput),
    metrics: {
      first_token_ms: summary.TimeToFirstTokenMs,
      total_time_ms: summary.TotalDurationMs,
      prompt_tokens: summary.TotalPromptTokenCount,
      completion_tokens: summary.TotalCompletionTokenCount,
      total_cost: summary.TotalCost,
      tokens_estimated: summary.TokensEstimated,
    },
    error: createError(summary.ContainsErrorStatus, summary.ErrorMessage),
    spans,
  };

  return trace;
}
