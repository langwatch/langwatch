import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger/server";
import { ValidationError } from "../../../library/services/errorHandling";
import { ATTR_KEYS } from "../canonicalisation/extractors/_constants";
import type { NormalizedSpan } from "../schemas/spans";
import { NormalizedStatusCode as StatusCode } from "../schemas/spans";
import { traceIOExtractionService } from "./traceIOExtractionService";

// ============================================================================
// Constants
// ============================================================================

const COMPUTED_IO_SCHEMA_VERSION = "2025-12-18" as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Result of trace aggregation containing all computed metrics.
 * Maps to the ClickHouse trace_summaries schema.
 */
export interface TraceAggregationResult {
  traceId: string;
  spanCount: number;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;

  // I/O
  computedIOSchemaVersion: string;
  computedInput: string | null;
  computedOutput: string | null;

  // Timing
  timeToFirstTokenMs: number | null;
  timeToLastTokenMs: number | null;
  tokensPerSecond: number | null;

  // Status
  containsErrorStatus: boolean;
  containsOKStatus: boolean;
  errorMessage: string | null;
  models: string[];

  // Cost
  totalCost: number | null;
  tokensEstimated: boolean;
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;

  // Metadata (stored in Attributes map)
  attributes: Record<string, string>;
}

interface TokenMetrics {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  tokensEstimated: boolean;
}

interface StatusInfo {
  containsError: boolean;
  containsOK: boolean;
  errorMessage: string | null;
}

interface TokenTiming {
  timeToFirstTokenMs: number | null;
  timeToLastTokenMs: number | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

const isValidTimestamp = (ts: number | undefined | null): ts is number =>
  typeof ts === "number" && ts > 0 && Number.isFinite(ts);

/**
 * Extracts unique model names from spans.
 */
const extractModels = (spans: NormalizedSpan[]): string[] => {
  const models = new Set<string>();

  for (const span of spans) {
    const attrs = span.spanAttributes;
    const candidates = [
      attrs[ATTR_KEYS.GEN_AI_RESPONSE_MODEL],
      attrs[ATTR_KEYS.GEN_AI_REQUEST_MODEL],
      attrs[ATTR_KEYS.LLM_MODEL_NAME],
      attrs[ATTR_KEYS.AI_MODEL],
    ];

    for (const model of candidates) {
      if (typeof model === "string" && model) {
        models.add(model);
      }
    }
  }

  return Array.from(models).sort();
};

/**
 * Extracts token counts and cost from spans.
 */
const extractTokenMetrics = (spans: NormalizedSpan[]): TokenMetrics => {
  const metrics: TokenMetrics = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    tokensEstimated: false,
  };

  for (const span of spans) {
    const attrs = span.spanAttributes;

    // Input/Prompt tokens (GenAI)
    const inputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS];
    const promptTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS];
    if (typeof inputTokens === "number" && inputTokens > 0) {
      metrics.totalPromptTokens += inputTokens;
    } else if (typeof promptTokens === "number" && promptTokens > 0) {
      metrics.totalPromptTokens += promptTokens;
    }

    // Output/Completion tokens (GenAI)
    const outputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS];
    const completionTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS];
    if (typeof outputTokens === "number" && outputTokens > 0) {
      metrics.totalCompletionTokens += outputTokens;
    } else if (typeof completionTokens === "number" && completionTokens > 0) {
      metrics.totalCompletionTokens += completionTokens;
    }

    // Cost (LangWatch attribute)
    const cost = attrs["langwatch.span.cost"];
    if (typeof cost === "number" && cost > 0) {
      metrics.totalCost += cost;
    }

    // Estimated flag
    if (attrs["langwatch.tokens.estimated"] === true) {
      metrics.tokensEstimated = true;
    }
  }

  return metrics;
};

/**
 * Extracts status info from spans.
 */
const extractStatusInfo = (spans: NormalizedSpan[]): StatusInfo => {
  const info: StatusInfo = {
    containsError: false,
    containsOK: false,
    errorMessage: null,
  };

  for (const span of spans) {
    // Check status code
    if (span.statusCode === StatusCode.OK) {
      info.containsOK = true;
    } else if (span.statusCode === StatusCode.ERROR) {
      info.containsError = true;
      if (span.statusMessage && !info.errorMessage) {
        info.errorMessage = span.statusMessage;
      }
    }

    const attrs = span.spanAttributes;

    // Check for error attributes if no error message from status
    if (!info.errorMessage) {
      const errorMsg =
        attrs[ATTR_KEYS.ERROR_MESSAGE] ?? attrs[ATTR_KEYS.EXCEPTION_MESSAGE];
      if (typeof errorMsg === "string") {
        info.errorMessage = errorMsg;
        info.containsError = true;
      }
    }

    // Check for error.has_error and span.error.has_error attributes
    if (!info.containsError) {
      const hasError =
        attrs[ATTR_KEYS.ERROR_HAS_ERROR] ??
        attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
      if (hasError === true || hasError === "true") {
        info.containsError = true;
      }
    }

    // Check span events for exception events (OTEL recordException)
    if (!info.containsError && span.events?.length) {
      for (const event of span.events) {
        if (event.name === "exception") {
          info.containsError = true;
          if (!info.errorMessage) {
            const exceptionMessage = event.attributes?.["exception.message"];
            if (typeof exceptionMessage === "string") {
              info.errorMessage = exceptionMessage;
            }
          }
          break;
        }
      }
    }
  }

  return info;
};

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

/**
 * Extracts token timing from span events.
 */
const extractTokenTiming = (spans: NormalizedSpan[]): TokenTiming => {
  const timing: TokenTiming = {
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
  };

  for (const span of spans) {
    if (!span.events?.length) continue;

    for (const event of span.events) {
      const timeDelta = event.timeUnixMs - span.startTimeUnixMs;

      if (FIRST_TOKEN_EVENTS.has(event.name)) {
        if (
          timing.timeToFirstTokenMs === null ||
          timeDelta < timing.timeToFirstTokenMs
        ) {
          timing.timeToFirstTokenMs = timeDelta;
        }
      }

      if (LAST_TOKEN_EVENTS.has(event.name)) {
        if (
          timing.timeToLastTokenMs === null ||
          timeDelta > timing.timeToLastTokenMs
        ) {
          timing.timeToLastTokenMs = timeDelta;
        }
      }
    }
  }

  return timing;
};

/**
 * Computes tokens per second.
 */
const computeTokensPerSecond = (
  completionTokens: number | null,
  durationMs: number,
): number | null => {
  if (completionTokens === null || completionTokens <= 0 || durationMs <= 0) {
    return null;
  }
  return Math.round((completionTokens / durationMs) * 1000);
};

/**
 * Converts token metrics to nullable format for output.
 */
const formatTokenMetrics = (metrics: TokenMetrics) => ({
  totalPromptTokenCount:
    metrics.totalPromptTokens > 0 ? metrics.totalPromptTokens : null,
  totalCompletionTokenCount:
    metrics.totalCompletionTokens > 0 ? metrics.totalCompletionTokens : null,
  totalCost:
    metrics.totalCost > 0 ? Number(metrics.totalCost.toFixed(6)) : null,
  tokensEstimated: metrics.tokensEstimated,
});

/**
 * Extracts metadata attributes to be stored in the Attributes map.
 * This includes SDK info, thread/user context, and other trace-level metadata.
 */
const extractTraceAttributes = (
  spans: NormalizedSpan[],
): Record<string, string> => {
  const attributes: Record<string, string> = {};
  let foundUserId = false;

  for (const span of spans) {
    const spanAttrs = span.spanAttributes;
    const resourceAttrs = span.resourceAttributes;

    // SDK info from resource attributes
    const sdkName = resourceAttrs["telemetry.sdk.name"];
    const sdkVersion = resourceAttrs["telemetry.sdk.version"];
    const sdkLanguage = resourceAttrs["telemetry.sdk.language"];
    const serviceName = resourceAttrs["service.name"];

    if (typeof sdkName === "string" && !attributes["sdk.name"]) {
      attributes["sdk.name"] = sdkName;
    }
    if (typeof sdkVersion === "string" && !attributes["sdk.version"]) {
      attributes["sdk.version"] = sdkVersion;
    }
    if (typeof sdkLanguage === "string" && !attributes["sdk.language"]) {
      attributes["sdk.language"] = sdkLanguage;
    }
    if (typeof serviceName === "string" && !attributes["service.name"]) {
      attributes["service.name"] = serviceName;
    }

    // Thread/User context from span attributes
    // After canonicalization, thread IDs are stored as gen_ai.conversation.id
    // Check multiple key formats to handle legacy SDKs and different attribute formats
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

    if (typeof threadId === "string" && !attributes["gen_ai.conversation.id"]) {
      attributes["gen_ai.conversation.id"] = threadId;
    }
    if (typeof userId === "string" && !attributes["langwatch.user_id"]) {
      attributes["langwatch.user_id"] = userId;
      foundUserId = true;
    }
    if (typeof customerId === "string" && !attributes["langwatch.customer_id"]) {
      attributes["langwatch.customer_id"] = customerId;
    }

    // Diagnostic logging: if this span has user-related keys but we haven't found userId yet
    if (
      !foundUserId &&
      Object.keys(spanAttrs).some((k) => k.toLowerCase().includes("user"))
    ) {
      logger.debug(
        {
          traceId: span.traceId,
          spanName: span.name,
          userRelatedKeys: Object.keys(spanAttrs).filter((k) =>
            k.toLowerCase().includes("user"),
          ),
          langwatchUserId: spanAttrs[ATTR_KEYS.LANGWATCH_USER_ID],
          langwatchUserIdLegacy: spanAttrs[ATTR_KEYS.LANGWATCH_USER_ID_LEGACY],
          langwatchUserIdLegacyRoot:
            spanAttrs[ATTR_KEYS.LANGWATCH_USER_ID_LEGACY_ROOT],
        },
        "Span has user-related keys but no userId extracted yet",
      );
    }

    // LangGraph metadata
    const langgraphThreadId =
      spanAttrs[ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID];
    if (
      typeof langgraphThreadId === "string" &&
      !attributes["langgraph.thread_id"]
    ) {
      attributes["langgraph.thread_id"] = langgraphThreadId;
    }

    // Labels from span attributes - check langwatch.labels first
    const labels = spanAttrs[ATTR_KEYS.LANGWATCH_LABELS];
    if (typeof labels === "string" && !attributes["langwatch.labels"]) {
      attributes["langwatch.labels"] = labels;
    }

    // Also check metadata.labels attribute
    const metadataLabels = spanAttrs["metadata.labels"];
    if (typeof metadataLabels === "string" && !attributes["langwatch.labels"]) {
      attributes["langwatch.labels"] = metadataLabels;
    }

    // Also check metadata JSON attribute (Python SDK sends labels this way)
    // Parse JSON and expand subkeys to dot notation
    // This hoists metadata from ANY span to trace summary attributes
    const metadataJson = spanAttrs["metadata"];
    if (typeof metadataJson === "string") {
      try {
        const parsed = JSON.parse(metadataJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const parsedObj = parsed as Record<string, unknown>;
          // Extract labels specifically for langwatch.labels
          if (
            Array.isArray(parsedObj.labels) &&
            !attributes["langwatch.labels"]
          ) {
            attributes["langwatch.labels"] = JSON.stringify(parsedObj.labels);
          }
          // Expand ALL subkeys to dot notation (e.g., metadata.thread_id, metadata.custom_field)
          // This hoists metadata from span level to trace summary level
          for (const [key, value] of Object.entries(parsedObj)) {
            if (key !== "labels" && value !== null && value !== undefined) {
              const dotKey = `metadata.${key}`;
              if (!attributes[dotKey]) {
                attributes[dotKey] =
                  typeof value === "string" ? value : JSON.stringify(value);
              }
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Diagnostic: log if no user_id found after checking all spans
  if (!foundUserId && spans.length > 0) {
    logger.debug(
      {
        traceId: spans[0]?.traceId,
        spanCount: spans.length,
        extractedAttributeKeys: Object.keys(attributes),
      },
      "No user_id found in any span for trace",
    );
  }

  return attributes;
};

// ============================================================================
// Service
// ============================================================================

const logger = createLogger("langwatch:trace-processing:aggregation-service");

/**
 * Service that handles aggregating spans into trace metadata.
 *
 * @example
 * ```typescript
 * const result = traceAggregationService.aggregateTrace(spans);
 * console.log(result.spanCount, result.durationMs);
 * ```
 */
export class TraceAggregationService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.aggregation",
  );

  /**
   * Aggregates spans into trace metadata.
   *
   * @param spans - Array of normalized spans to aggregate
   * @returns Aggregated trace metrics
   * @throws ValidationError if no valid spans provided
   */
  aggregateTrace(spans: NormalizedSpan[]): TraceAggregationResult {
    return this.tracer.withActiveSpan(
      "TraceAggregationService.aggregateTrace",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "span.count": spans.length,
          "trace.id": spans[0]?.traceId ?? "unknown",
        },
      },
      (otelSpan) => {
        // Validate input
        this.validateSpans(spans, otelSpan);

        // Filter to valid timestamps
        const validSpans = this.filterValidTimestamps(spans, otelSpan);

        // Basic metrics
        const traceId = spans[0].traceId;
        const { startTimeUnixMs, endTimeUnixMs, durationMs } =
          this.computeTiming(validSpans);

        // Extract all metrics
        const models = extractModels(spans);
        const tokenMetrics = extractTokenMetrics(spans);
        const statusInfo = extractStatusInfo(spans);
        const tokenTiming = extractTokenTiming(spans);

        // IO extraction (using the service) - store rich JSON as string
        const inputResult = traceIOExtractionService.extractFirstInput(spans);
        const outputResult = traceIOExtractionService.extractLastOutput(spans);

        // Serialize the raw JSON to string for storage
        const computedInput = inputResult
          ? typeof inputResult.raw === "string"
            ? inputResult.raw
            : JSON.stringify(inputResult.raw)
          : null;
        const computedOutput = outputResult
          ? typeof outputResult.raw === "string"
            ? outputResult.raw
            : JSON.stringify(outputResult.raw)
          : null;

        // Trace attributes extraction
        const attributes = extractTraceAttributes(spans);

        // Format outputs
        const formatted = formatTokenMetrics(tokenMetrics);
        const tokensPerSecond = computeTokensPerSecond(
          formatted.totalCompletionTokenCount,
          durationMs,
        );

        otelSpan.setAttributes({
          "trace.duration_ms": durationMs,
          "trace.total_tokens":
            (formatted.totalPromptTokenCount ?? 0) +
            (formatted.totalCompletionTokenCount ?? 0),
          "trace.total_cost": formatted.totalCost ?? 0,
          "trace.models": models.join(","),
          "trace.has_error": statusInfo.containsError,
          "trace.input_length": computedInput?.length ?? 0,
          "trace.output_length": computedOutput?.length ?? 0,
        });

        logger.debug(
          {
            traceId,
            spanCount: spans.length,
            durationMs,
            hasInput: computedInput !== null,
            hasOutput: computedOutput !== null,
          },
          "Computed trace aggregation",
        );

        return {
          traceId,
          spanCount: spans.length,
          startTimeUnixMs,
          endTimeUnixMs,
          durationMs,

          computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
          computedInput,
          computedOutput,

          timeToFirstTokenMs: tokenTiming.timeToFirstTokenMs,
          timeToLastTokenMs: tokenTiming.timeToLastTokenMs,
          tokensPerSecond,

          containsErrorStatus: statusInfo.containsError,
          containsOKStatus: statusInfo.containsOK,
          errorMessage: statusInfo.errorMessage,
          models,

          ...formatted,

          attributes,
        };
      },
    );
  }

  private validateSpans(
    spans: NormalizedSpan[],
    otelSpan: { addEvent: (name: string) => void },
  ): asserts spans is [NormalizedSpan, ...NormalizedSpan[]] {
    if (spans.length === 0 || !spans[0]) {
      throw new ValidationError(
        "Cannot aggregate trace with no spans",
        "spans",
        spans,
      );
    }

    const expectedTraceId = spans[0].traceId;
    for (const span of spans) {
      if (span.traceId !== expectedTraceId) {
        throw new ValidationError(
          "Cannot aggregate trace: spans have different traceId values",
          "spans",
          spans,
        );
      }
    }

    otelSpan.addEvent("validation.complete");
  }

  private filterValidTimestamps(
    spans: NormalizedSpan[],
    otelSpan: { setAttributes: (attrs: Record<string, number>) => void },
  ): NormalizedSpan[] {
    const valid = spans.filter((span) => {
      const validStart = isValidTimestamp(span.startTimeUnixMs);
      const validEnd = isValidTimestamp(span.endTimeUnixMs);

      if (!validStart || !validEnd) {
        logger.warn(
          { traceId: span.traceId, spanId: span.spanId },
          "Span has invalid timestamps, excluding from timing calculation",
        );
        return false;
      }
      return true;
    });

    otelSpan.setAttributes({
      "span.invalid_count": spans.length - valid.length,
    });

    if (valid.length === 0) {
      throw new ValidationError(
        "Cannot aggregate trace: all spans have invalid timestamps",
        "spans",
        spans,
      );
    }

    return valid;
  }

  private computeTiming(spans: NormalizedSpan[]): {
    startTimeUnixMs: number;
    endTimeUnixMs: number;
    durationMs: number;
  } {
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const span of spans) {
      if (span.startTimeUnixMs < minStart) minStart = span.startTimeUnixMs;
      if (span.endTimeUnixMs > maxEnd) maxEnd = span.endTimeUnixMs;
    }

    return {
      startTimeUnixMs: minStart,
      endTimeUnixMs: maxEnd,
      durationMs: maxEnd - minStart,
    };
  }
}

export const traceAggregationService = new TraceAggregationService();
