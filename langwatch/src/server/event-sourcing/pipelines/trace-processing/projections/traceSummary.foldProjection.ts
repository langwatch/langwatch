import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  estimateCost,
  matchingLLMModelCost,
} from "~/server/background/workers/collector/cost";
import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "~/server/event-sourcing/projections";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import {
  TRACE_PROCESSING_EVENT_TYPES,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  isSpanReceivedEvent,
  isSatisfactionScoreAssignedEvent,
  isTopicAssignedEvent,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { NormalizedStatusCode as StatusCode } from "../schemas/spans";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { traceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";

export type { TraceSummaryData };

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

  // Token counts
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
  } else if (
    typeof genAiCompletionTokens === "number" &&
    genAiCompletionTokens > 0
  ) {
    completionTokens = genAiCompletionTokens;
  }

  // Cost: compute from model pricing instead of reading SDK cost directly
  const models = extractModelsFromSpan(span);
  const model = models[0];
  if (model && (promptTokens > 0 || completionTokens > 0)) {
    // Check span for custom cost rates (set by enrichment service)
    const rawInputRate = attrs[ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN];
    const rawOutputRate =
      attrs[ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN];
    const hasCustomRates =
      typeof rawInputRate === "number" || typeof rawOutputRate === "number";

    if (hasCustomRates) {
      const inputRate = typeof rawInputRate === "number" ? rawInputRate : 0;
      const outputRate = typeof rawOutputRate === "number" ? rawOutputRate : 0;
      cost = promptTokens * inputRate + completionTokens * outputRate;
    } else {
      // Fallback: static registry lookup (sync, cached at module level)
      const staticCosts = getStaticModelCosts();
      const matched = matchingLLMModelCost(model, staticCosts);
      if (matched) {
        const computed = estimateCost({
          llmModelCost: matched,
          inputTokens: promptTokens,
          outputTokens: completionTokens,
        });
        if (computed !== undefined) cost = computed;
      }
    }
  } else {
    // No model or no tokens — fall back to SDK cost if available
    const spanCost = attrs[ATTR_KEYS.LANGWATCH_SPAN_COST];
    if (typeof spanCost === "number" && spanCost > 0) {
      cost = spanCost;
    }
  }

  // Guardrail cost: extract from langwatch.output JSON when span is a guardrail
  if (cost === 0) {
    const spanType = attrs[ATTR_KEYS.SPAN_TYPE];
    if (spanType === "guardrail") {
      const rawOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
      if (typeof rawOutput === "string") {
        try {
          const parsed = JSON.parse(rawOutput) as Record<string, unknown>;
          const costObj = parsed.cost as
            | { amount?: number; currency?: string }
            | undefined;
          if (
            costObj &&
            typeof costObj.amount === "number" &&
            costObj.currency === "USD"
          ) {
            cost = costObj.amount;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  if (attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === true) {
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
      attrs[ATTR_KEYS.ERROR_HAS_ERROR] ?? attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
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

function extractAttributesFromSpan(
  span: NormalizedSpan,
): Record<string, string> {
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

  if (typeof threadId === "string")
    attributes["gen_ai.conversation.id"] = threadId;
  if (typeof userId === "string") attributes["langwatch.user_id"] = userId;
  if (typeof customerId === "string")
    attributes["langwatch.customer_id"] = customerId;

  // LangGraph metadata
  const langgraphThreadId = spanAttrs[ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID];
  if (typeof langgraphThreadId === "string")
    attributes["langgraph.thread_id"] = langgraphThreadId;

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
        if (
          Array.isArray(parsedObj.labels) &&
          !attributes["langwatch.labels"]
        ) {
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

/** @internal Exported for unit testing */
export function applySpanToSummary(
  state: TraceSummaryData,
  span: NormalizedSpan,
): TraceSummaryData {
  const hasValidTimestamps =
    isValidTimestamp(span.startTimeUnixMs) &&
    isValidTimestamp(span.endTimeUnixMs);

  // Timing
  let occurredAt = state.occurredAt;
  let totalDurationMs = state.totalDurationMs;
  if (hasValidTimestamps) {
    const newStart =
      occurredAt > 0
        ? Math.min(occurredAt, span.startTimeUnixMs)
        : span.startTimeUnixMs;
    const currentEnd = occurredAt > 0 ? occurredAt + totalDurationMs : 0;
    const newEnd = Math.max(currentEnd, span.endTimeUnixMs);
    occurredAt = newStart;
    totalDurationMs = newEnd - newStart;
  }

  // Models
  const newModels = extractModelsFromSpan(span);
  let models = state.models;
  if (newModels.length > 0) {
    const modelSet = new Set(models);
    for (const m of newModels) modelSet.add(m);
    models = Array.from(modelSet).sort();
  }

  // Token metrics
  const tokenMetrics = extractTokenMetricsFromSpan(span);
  const totalPromptTokenCount =
    (state.totalPromptTokenCount ?? 0) + tokenMetrics.promptTokens;
  const totalCompletionTokenCount =
    (state.totalCompletionTokenCount ?? 0) + tokenMetrics.completionTokens;
  const totalCost = (state.totalCost ?? 0) + tokenMetrics.cost;
  const tokensEstimated = state.tokensEstimated || tokenMetrics.estimated;

  // Status
  const statusInfo = extractStatusFromSpan(span);
  const containsErrorStatus = state.containsErrorStatus || statusInfo.hasError;
  const containsOKStatus = state.containsOKStatus || statusInfo.hasOK;
  const errorMessage = state.errorMessage ?? statusInfo.errorMessage;

  // Token timing
  const tokenTiming = extractTokenTimingFromSpan(span);
  let timeToFirstTokenMs = state.timeToFirstTokenMs;
  if (tokenTiming.timeToFirstToken !== null) {
    timeToFirstTokenMs =
      timeToFirstTokenMs === null
        ? tokenTiming.timeToFirstToken
        : Math.min(timeToFirstTokenMs, tokenTiming.timeToFirstToken);
  }
  let timeToLastTokenMs = state.timeToLastTokenMs;
  if (tokenTiming.timeToLastToken !== null) {
    timeToLastTokenMs =
      timeToLastTokenMs === null
        ? tokenTiming.timeToLastToken
        : Math.max(timeToLastTokenMs, tokenTiming.timeToLastToken);
  }

  // Tokens per second
  const finalCompletionCount =
    totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null;
  const tokensPerSecond =
    finalCompletionCount !== null &&
    finalCompletionCount > 0 &&
    totalDurationMs > 0
      ? Math.round((finalCompletionCount / totalDurationMs) * 1000)
      : null;

  // I/O extraction (per-span heuristic)
  // Exclude evaluation and guardrail spans from I/O extraction (matches batch logic)
  const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
  const isExcludedType = spanType === "evaluation" || spanType === "guardrail";

  // Detect guardrail blocking
  let blockedByGuardrail = state.blockedByGuardrail;
  if (spanType === "guardrail") {
    const rawOutput = span.spanAttributes[ATTR_KEYS.LANGWATCH_OUTPUT];
    if (typeof rawOutput === "string") {
      try {
        const parsed = JSON.parse(rawOutput) as Record<string, unknown>;
        if (parsed.passed === false) {
          blockedByGuardrail = true;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  let computedInput = state.computedInput;
  let computedOutput = state.computedOutput;
  let outputFromRoot = state.outputFromRootSpan;
  let outputSpanEndTimeMs = state.outputSpanEndTimeMs;

  if (!isExcludedType) {
    const inputResult = traceIOExtractionService.extractRichIOFromSpan(
      span,
      "input",
    );
    if (inputResult) {
      const isRootSpan = !span.parentSpanId;
      // Root span input always overrides; otherwise set once from first span with input
      if (isRootSpan || computedInput === null) {
        const raw = inputResult.raw;
        computedInput = typeof raw === "string" ? raw : JSON.stringify(raw);
      }
    }

    const outputResult = traceIOExtractionService.extractRichIOFromSpan(
      span,
      "output",
    );
    if (outputResult) {
      const isRootSpan = !span.parentSpanId;
      // Root always wins; among non-root, last-finishing wins (matches batch logic)
      const shouldOverride =
        isRootSpan ||
        (!outputFromRoot && span.endTimeUnixMs >= outputSpanEndTimeMs);

      if (shouldOverride) {
        const raw = outputResult.raw;
        computedOutput = typeof raw === "string" ? raw : JSON.stringify(raw);
        outputFromRoot = isRootSpan;
        outputSpanEndTimeMs = span.endTimeUnixMs;
      }
    }
  }

  // Attributes (first-wins per key)
  const spanAttributes = extractAttributesFromSpan(span);
  const mergedAttributes = { ...spanAttributes, ...state.attributes };

  // PII redaction status tracking — accumulate span IDs by severity
  const piiStatus = span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS];
  if (piiStatus === "partial") {
    const key = ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS;
    const existing = mergedAttributes[key];
    const ids: string[] = existing ? (JSON.parse(existing) as string[]) : [];
    ids.push(span.spanId);
    mergedAttributes[key] = JSON.stringify(ids);
  } else if (piiStatus === "none") {
    const key = ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS;
    const existing = mergedAttributes[key];
    const ids: string[] = existing ? (JSON.parse(existing) as string[]) : [];
    ids.push(span.spanId);
    mergedAttributes[key] = JSON.stringify(ids);
  }

  return {
    ...state,
    traceId: state.traceId || span.traceId,
    spanCount: state.spanCount + 1,
    occurredAt: occurredAt,
    totalDurationMs: totalDurationMs,
    computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
    computedInput: computedInput,
    computedOutput: computedOutput,
    outputFromRootSpan: outputFromRoot,
    outputSpanEndTimeMs: outputSpanEndTimeMs,
    models: models,
    totalPromptTokenCount:
      totalPromptTokenCount > 0 ? totalPromptTokenCount : null,
    totalCompletionTokenCount:
      totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null,
    totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    tokensEstimated: tokensEstimated,
    containsErrorStatus: containsErrorStatus,
    containsOKStatus: containsOKStatus,
    errorMessage: errorMessage,
    timeToFirstTokenMs: timeToFirstTokenMs,
    timeToLastTokenMs: timeToLastTokenMs,
    tokensPerSecond: tokensPerSecond,
    blockedByGuardrail: blockedByGuardrail,
    attributes: mergedAttributes,
  };
}

const spanNormalizationPipelineService = new SpanNormalizationPipelineService();

/**
 * Creates a FoldProjection definition for trace summaries.
 *
 * Fold state = stored data. Each SpanReceivedEvent is normalized and then
 * incrementally applied to the summary. No batch aggregation — `apply()`
 * does all computation per-span.
 */
export function createTraceSummaryFoldProjection({
  store,
}: {
  store: FoldProjectionStore<TraceSummaryData>;
}): FoldProjectionDefinition<TraceSummaryData, TraceProcessingEvent> {
  return {
    name: "traceSummary",
    version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
    eventTypes: TRACE_PROCESSING_EVENT_TYPES,

    init(): TraceSummaryData {
      return {
        traceId: "",
        spanCount: 0,
        totalDurationMs: 0,
        computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
        computedInput: null,
        computedOutput: null,
        timeToFirstTokenMs: null,
        timeToLastTokenMs: null,
        tokensPerSecond: null,
        containsErrorStatus: false,
        containsOKStatus: false,
        errorMessage: null,
        models: [],
        totalCost: null,
        tokensEstimated: false,
        totalPromptTokenCount: null,
        totalCompletionTokenCount: null,
        outputFromRootSpan: false,
        outputSpanEndTimeMs: 0,
        blockedByGuardrail: false,
        satisfactionScore: null,
        topicId: null,
        subTopicId: null,
        hasAnnotation: null,
        attributes: {},
        occurredAt: 0,
        createdAt: 0,
        lastUpdatedAt: 0,
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
          createdAt: state.createdAt || event.timestamp,
          lastUpdatedAt: event.timestamp,
        };
      }

      if (isTopicAssignedEvent(event)) {
        return {
          ...state,
          topicId: event.data.topicId ?? state.topicId,
          subTopicId: event.data.subtopicId ?? state.subTopicId,
          lastUpdatedAt: event.timestamp,
        };
      }

      if (isSatisfactionScoreAssignedEvent(event)) {
        return {
          ...state,
          satisfactionScore: event.data.satisfactionScore,
          lastUpdatedAt: event.timestamp,
        };
      }

      return state;
    },

    store,
  };
}
