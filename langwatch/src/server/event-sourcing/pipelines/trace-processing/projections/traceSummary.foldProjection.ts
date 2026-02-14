import type { Projection } from "../../../library";
import type { FoldProjectionDefinition } from "../../../library/projections/foldProjection.types";
import { ATTR_KEYS } from "../canonicalisation/extractors/_constants";
import { TRACE_PROCESSING_EVENT_TYPES } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent, isTopicAssignedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { NormalizedStatusCode as StatusCode } from "../schemas/spans";
import { SpanNormalizationPipelineService } from "../services";
import { traceIOExtractionService } from "../services/traceIOExtractionService";
import { traceSummaryFoldStore } from "../repositories/traceSummaryFoldStore";

// ============================================================================
// Constants
// ============================================================================

const COMPUTED_IO_SCHEMA_VERSION = "2025-12-18" as const;

const FIRST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "first_token",
  "llm.first_token",
]);

const LAST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "last_token",
  "llm.last_token",
]);

const STANDARD_RESOURCE_PREFIXES = [
  "host.",
  "process.",
  "telemetry.",
  "service.",
  "os.",
  "container.",
  "k8s.",
  "cloud.",
  "deployment.",
  "device.",
  "faas.",
  "webengine.",
] as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Summary data for trace metrics.
 * Matches the trace_summaries ClickHouse table schema exactly.
 *
 * This is both the fold state and the stored data — one type, not two.
 * `apply()` does all computation per-span. Store is a dumb read/write layer.
 */
export interface TraceSummaryData {
  TraceId: string;
  SpanCount: number;
  TotalDurationMs: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: boolean | null;
  Attributes: Record<string, string>;
  OccurredAt: number;
  CreatedAt: number;
  LastUpdatedAt: number;
}

/**
 * Summary projection for trace metrics.
 */
export interface TraceSummary extends Projection<TraceSummaryData> {
  data: TraceSummaryData;
}

// ============================================================================
// Per-span helper functions
// ============================================================================

const isValidTimestamp = (ts: number | undefined | null): ts is number =>
  typeof ts === "number" && ts > 0 && Number.isFinite(ts);

function extractModelsFromSpan(span: NormalizedSpan): string[] {
  const models: string[] = [];
  const attrs = span.spanAttributes;
  const candidates = [
    attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL],
    attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL],
    attrs[ATTR_KEYS.LLM_MODEL_NAME],
    attrs[ATTR_KEYS.AI_MODEL],
  ];

  for (const model of candidates) {
    if (typeof model === "string" && model) {
      models.push(model);
    }
  }

  return models;
}

interface SpanTokenMetrics {
  promptTokens: number;
  completionTokens: number;
  cost: number;
  estimated: boolean;
}

function extractTokenMetricsFromSpan(span: NormalizedSpan): SpanTokenMetrics {
  const attrs = span.spanAttributes;
  let promptTokens = 0;
  let completionTokens = 0;
  let cost = 0;
  let estimated = false;

  const inputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS];
  const genAiPromptTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS];
  if (typeof inputTokens === "number" && inputTokens > 0) {
    promptTokens = inputTokens;
  } else if (typeof genAiPromptTokens === "number" && genAiPromptTokens > 0) {
    promptTokens = genAiPromptTokens;
  }

  const outputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS];
  const genAiCompletionTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS];
  if (typeof outputTokens === "number" && outputTokens > 0) {
    completionTokens = outputTokens;
  } else if (typeof genAiCompletionTokens === "number" && genAiCompletionTokens > 0) {
    completionTokens = genAiCompletionTokens;
  }

  const spanCost = attrs["langwatch.span.cost"];
  if (typeof spanCost === "number" && spanCost > 0) {
    cost = spanCost;
  }

  if (attrs["langwatch.tokens.estimated"] === true) {
    estimated = true;
  }

  return { promptTokens, completionTokens, cost, estimated };
}

interface SpanStatusInfo {
  hasError: boolean;
  hasOK: boolean;
  errorMessage: string | null;
}

function extractStatusFromSpan(span: NormalizedSpan): SpanStatusInfo {
  let hasError = false;
  let hasOK = false;
  let errorMessage: string | null = null;

  if (span.statusCode === StatusCode.OK) {
    hasOK = true;
  } else if (span.statusCode === StatusCode.ERROR) {
    hasError = true;
    if (span.statusMessage) {
      errorMessage = span.statusMessage;
    }
  }

  const attrs = span.spanAttributes;

  if (!errorMessage) {
    const errorMsg =
      attrs[ATTR_KEYS.ERROR_MESSAGE] ?? attrs[ATTR_KEYS.EXCEPTION_MESSAGE];
    if (typeof errorMsg === "string") {
      errorMessage = errorMsg;
      hasError = true;
    }
  }

  if (!hasError) {
    const hasErrorAttr =
      attrs[ATTR_KEYS.ERROR_HAS_ERROR] ??
      attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
    if (hasErrorAttr === true || hasErrorAttr === "true") {
      hasError = true;
    }
  }

  if (!errorMessage && span.events?.length) {
    for (const event of span.events) {
      if (event.name === "exception") {
        hasError = true;
        const exceptionMessage = event.attributes?.["exception.message"];
        if (typeof exceptionMessage === "string") {
          errorMessage = exceptionMessage;
        }
        break;
      }
    }
  }

  return { hasError, hasOK, errorMessage };
}

interface SpanTokenTiming {
  timeToFirstToken: number | null;
  timeToLastToken: number | null;
}

function extractTokenTimingFromSpan(span: NormalizedSpan): SpanTokenTiming {
  let timeToFirstToken: number | null = null;
  let timeToLastToken: number | null = null;

  if (!span.events?.length) return { timeToFirstToken, timeToLastToken };

  for (const event of span.events) {
    const timeDelta = event.timeUnixMs - span.startTimeUnixMs;

    if (FIRST_TOKEN_EVENTS.has(event.name)) {
      if (timeToFirstToken === null || timeDelta < timeToFirstToken) {
        timeToFirstToken = timeDelta;
      }
    }

    if (LAST_TOKEN_EVENTS.has(event.name)) {
      if (timeToLastToken === null || timeDelta > timeToLastToken) {
        timeToLastToken = timeDelta;
      }
    }
  }

  return { timeToFirstToken, timeToLastToken };
}

function extractAttributesFromSpan(span: NormalizedSpan): Record<string, string> {
  const attributes: Record<string, string> = {};
  const spanAttrs = span.spanAttributes;
  const resourceAttrs = span.resourceAttributes;

  // SDK info from resource attributes
  const sdkName = resourceAttrs["telemetry.sdk.name"];
  const sdkVersion = resourceAttrs["telemetry.sdk.version"];
  const sdkLanguage = resourceAttrs["telemetry.sdk.language"];
  const serviceName = resourceAttrs["service.name"];

  if (typeof sdkName === "string") attributes["sdk.name"] = sdkName;
  if (typeof sdkVersion === "string") attributes["sdk.version"] = sdkVersion;
  if (typeof sdkLanguage === "string") attributes["sdk.language"] = sdkLanguage;
  if (typeof serviceName === "string") attributes["service.name"] = serviceName;

  // Custom resource attributes
  for (const [key, value] of Object.entries(resourceAttrs)) {
    if (STANDARD_RESOURCE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      continue;
    if (typeof value === "string") {
      attributes[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      attributes[key] = String(value);
    }
  }

  // Thread/User context from span attributes
  const threadId =
    spanAttrs[ATTR_KEYS.GEN_AI_CONVERSATION_ID] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_THREAD_ID] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY_ROOT];

  const userId =
    spanAttrs[ATTR_KEYS.LANGWATCH_USER_ID] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_USER_ID_LEGACY] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_USER_ID_LEGACY_ROOT];

  const customerId =
    spanAttrs[ATTR_KEYS.LANGWATCH_CUSTOMER_ID] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY] ??
    spanAttrs[ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY_ROOT];

  if (typeof threadId === "string") attributes["gen_ai.conversation.id"] = threadId;
  if (typeof userId === "string") attributes["langwatch.user_id"] = userId;
  if (typeof customerId === "string") attributes["langwatch.customer_id"] = customerId;

  // LangGraph metadata
  const langgraphThreadId = spanAttrs[ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID];
  if (typeof langgraphThreadId === "string") attributes["langgraph.thread_id"] = langgraphThreadId;

  // Labels
  const labels = spanAttrs[ATTR_KEYS.LANGWATCH_LABELS];
  if (typeof labels === "string") attributes["langwatch.labels"] = labels;

  const metadataLabels = spanAttrs["metadata.labels"];
  if (typeof metadataLabels === "string" && !attributes["langwatch.labels"]) {
    attributes["langwatch.labels"] = metadataLabels;
  }

  // Parse metadata JSON
  const metadataJson = spanAttrs["metadata"];
  if (typeof metadataJson === "string") {
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const parsedObj = parsed as Record<string, unknown>;
        if (Array.isArray(parsedObj.labels) && !attributes["langwatch.labels"]) {
          attributes["langwatch.labels"] = JSON.stringify(parsedObj.labels);
        }
        for (const [key, value] of Object.entries(parsedObj)) {
          if (key !== "labels" && value !== null && value !== undefined) {
            const dotKey = `metadata.${key}`;
            attributes[dotKey] =
              typeof value === "string" ? value : JSON.stringify(value);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return attributes;
}

// ============================================================================
// Incremental apply
// ============================================================================

function applySpanToSummary(state: TraceSummaryData, span: NormalizedSpan): TraceSummaryData {
  const hasValidTimestamps = isValidTimestamp(span.startTimeUnixMs) && isValidTimestamp(span.endTimeUnixMs);

  // Timing
  let occurredAt = state.OccurredAt;
  let totalDurationMs = state.TotalDurationMs;
  if (hasValidTimestamps) {
    const newStart = occurredAt > 0 ? Math.min(occurredAt, span.startTimeUnixMs) : span.startTimeUnixMs;
    const currentEnd = occurredAt > 0 ? occurredAt + totalDurationMs : 0;
    const newEnd = Math.max(currentEnd, span.endTimeUnixMs);
    occurredAt = newStart;
    totalDurationMs = newEnd - newStart;
  }

  // Models
  const newModels = extractModelsFromSpan(span);
  let models = state.Models;
  if (newModels.length > 0) {
    const modelSet = new Set(models);
    for (const m of newModels) modelSet.add(m);
    models = Array.from(modelSet).sort();
  }

  // Token metrics
  const tokenMetrics = extractTokenMetricsFromSpan(span);
  const totalPromptTokenCount = (state.TotalPromptTokenCount ?? 0) + tokenMetrics.promptTokens;
  const totalCompletionTokenCount = (state.TotalCompletionTokenCount ?? 0) + tokenMetrics.completionTokens;
  const totalCost = (state.TotalCost ?? 0) + tokenMetrics.cost;
  const tokensEstimated = state.TokensEstimated || tokenMetrics.estimated;

  // Status
  const statusInfo = extractStatusFromSpan(span);
  const containsErrorStatus = state.ContainsErrorStatus || statusInfo.hasError;
  const containsOKStatus = state.ContainsOKStatus || statusInfo.hasOK;
  const errorMessage = state.ErrorMessage ?? statusInfo.errorMessage;

  // Token timing
  const tokenTiming = extractTokenTimingFromSpan(span);
  let timeToFirstTokenMs = state.TimeToFirstTokenMs;
  if (tokenTiming.timeToFirstToken !== null) {
    timeToFirstTokenMs = timeToFirstTokenMs === null
      ? tokenTiming.timeToFirstToken
      : Math.min(timeToFirstTokenMs, tokenTiming.timeToFirstToken);
  }
  let timeToLastTokenMs = state.TimeToLastTokenMs;
  if (tokenTiming.timeToLastToken !== null) {
    timeToLastTokenMs = timeToLastTokenMs === null
      ? tokenTiming.timeToLastToken
      : Math.max(timeToLastTokenMs, tokenTiming.timeToLastToken);
  }

  // Tokens per second
  const finalCompletionCount = totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null;
  const tokensPerSecond =
    finalCompletionCount !== null && finalCompletionCount > 0 && totalDurationMs > 0
      ? Math.round((finalCompletionCount / totalDurationMs) * 1000)
      : null;

  // I/O extraction (per-span heuristic)
  let computedInput = state.ComputedInput;
  const inputResult = traceIOExtractionService.extractRichIOFromSpan(span, "input");
  if (inputResult) {
    const isRootSpan = !span.parentSpanId;
    // Root span input always overrides; otherwise set once from first span with input
    if (isRootSpan || computedInput === null) {
      const raw = inputResult.raw;
      computedInput = typeof raw === "string" ? raw : JSON.stringify(raw);
    }
  }

  let computedOutput = state.ComputedOutput;
  const outputResult = traceIOExtractionService.extractRichIOFromSpan(span, "output");
  if (outputResult) {
    // Always overwrite — spans arrive incrementally, so each new span with output is "latest"
    const raw = outputResult.raw;
    computedOutput = typeof raw === "string" ? raw : JSON.stringify(raw);
  }

  // Attributes (first-wins per key)
  const spanAttributes = extractAttributesFromSpan(span);
  const mergedAttributes = { ...spanAttributes, ...state.Attributes };

  return {
    ...state,
    TraceId: state.TraceId || span.traceId,
    SpanCount: state.SpanCount + 1,
    OccurredAt: occurredAt,
    TotalDurationMs: totalDurationMs,
    ComputedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
    ComputedInput: computedInput,
    ComputedOutput: computedOutput,
    Models: models,
    TotalPromptTokenCount: totalPromptTokenCount > 0 ? totalPromptTokenCount : null,
    TotalCompletionTokenCount: totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null,
    TotalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    TokensEstimated: tokensEstimated,
    ContainsErrorStatus: containsErrorStatus,
    ContainsOKStatus: containsOKStatus,
    ErrorMessage: errorMessage,
    TimeToFirstTokenMs: timeToFirstTokenMs,
    TimeToLastTokenMs: timeToLastTokenMs,
    TokensPerSecond: tokensPerSecond,
    Attributes: mergedAttributes,
  };
}

// ============================================================================
// Fold Projection Definition
// ============================================================================

const spanNormalizationPipelineService = new SpanNormalizationPipelineService();

/**
 * FoldProjection definition for trace summaries.
 *
 * Fold state = stored data. Each SpanReceivedEvent is normalized and then
 * incrementally applied to the summary. No batch aggregation — `apply()`
 * does all computation per-span.
 */
export const traceSummaryFoldProjection: FoldProjectionDefinition<
  TraceSummaryData,
  TraceProcessingEvent
> = {
  name: "traceSummary",
  eventTypes: TRACE_PROCESSING_EVENT_TYPES,

  init(): TraceSummaryData {
    return {
      TraceId: "",
      SpanCount: 0,
      TotalDurationMs: 0,
      ComputedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
      ComputedInput: null,
      ComputedOutput: null,
      TimeToFirstTokenMs: null,
      TimeToLastTokenMs: null,
      TokensPerSecond: null,
      ContainsErrorStatus: false,
      ContainsOKStatus: false,
      ErrorMessage: null,
      Models: [],
      TotalCost: null,
      TokensEstimated: false,
      TotalPromptTokenCount: null,
      TotalCompletionTokenCount: null,
      TopicId: null,
      SubTopicId: null,
      HasAnnotation: null,
      Attributes: {},
      OccurredAt: 0,
      CreatedAt: 0,
      LastUpdatedAt: 0,
    };
  },

  apply(
    state: TraceSummaryData,
    event: TraceProcessingEvent,
  ): TraceSummaryData {
    if (isSpanReceivedEvent(event)) {
      const normalizedSpan =
        spanNormalizationPipelineService.normalizeSpanReceived(
          event.tenantId,
          event.data.span,
          event.data.resource,
          event.data.instrumentationScope,
        );

      const updatedState = applySpanToSummary(state, normalizedSpan);

      return {
        ...updatedState,
        CreatedAt: state.CreatedAt || event.timestamp,
        LastUpdatedAt: event.timestamp,
      };
    }

    if (isTopicAssignedEvent(event)) {
      return {
        ...state,
        TopicId: event.data.topicId ?? state.TopicId,
        SubTopicId: event.data.subtopicId ?? state.SubTopicId,
        LastUpdatedAt: event.timestamp,
      };
    }

    return state;
  },

  store: traceSummaryFoldStore,
};
