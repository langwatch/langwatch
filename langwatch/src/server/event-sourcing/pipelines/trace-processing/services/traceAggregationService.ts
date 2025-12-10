import { createLogger } from "../../../../../utils/logger";
import { ValidationError } from "../../../library/services/errorHandling";
import type { SpanData } from "../schemas/commands";

/**
 * Result of trace aggregation containing all computed metrics.
 */
export interface TraceAggregationResult {
  traceId: string;
  spanIds: string[];
  totalSpans: number;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  serviceNames: string[];
  rootSpanId: string | null;
  IOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ComputedMetadata: Record<string, string>;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  Models: string[];
  TopicId: string | null;
  SubTopicId: string | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  HasAnnotation: boolean | null;
}

/**
 * Service that handles the business logic of aggregating spans into trace metadata.
 *
 * @example
 * ```typescript
 * const result = traceAggregationService.aggregateTrace(spans);
 * console.log(result.totalSpans, result.durationMs);
 * ```
 */
export class TraceAggregationService {
  logger = createLogger("langwatch:trace-processing:aggregation-service");

  /**
   * Validates that a timestamp is valid (not 0, null, undefined, or negative).
   */
  private isValidTimestamp(timestamp: number | undefined | null): boolean {
    return (
      typeof timestamp === "number" &&
      timestamp > 0 &&
      isFinite(timestamp) &&
      !isNaN(timestamp)
    );
  }

  /**
   * Aggregates spans into trace metadata.
   *
   * Computes total spans, duration, service names, root span ID, start/end times,
   * and all computed metrics matching the trace_summaries ClickHouse schema.
   *
   * Extracts data from spans using OpenTelemetry GenAI semantic conventions:
   * - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens for token counts
   * - gen_ai.request.model / gen_ai.response.model for model names
   * - gen_ai.input.messages / gen_ai.output.messages for input/output content
   * - gen_ai.conversation.id for conversation/thread tracking
   *
   * @param spans - Array of spans to aggregate
   * @returns Aggregated trace metrics
   * @throws ValidationError if no valid spans provided
   *
   * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
   */
  aggregateTrace(spans: SpanData[]): TraceAggregationResult {
    if (spans.length === 0 || !spans[0]) {
      throw new ValidationError(
        "Cannot aggregate trace with no spans",
        "spans",
        spans,
      );
    }

    // Filter out spans with invalid timestamps and log warnings
    const spansWithValidTimestamps = spans.filter((span) => {
      const hasValidStart = this.isValidTimestamp(span.startTimeUnixMs);
      const hasValidEnd = this.isValidTimestamp(span.endTimeUnixMs);

      if (!hasValidStart || !hasValidEnd) {
        this.logger.warn(
          {
            traceId: span.traceId,
            spanId: span.spanId,
            startTimeUnixMs: span.startTimeUnixMs,
            endTimeUnixMs: span.endTimeUnixMs,
          },
          "Span has invalid timestamps, excluding from aggregation",
        );
        return false;
      }

      return true;
    });

    if (spansWithValidTimestamps.length === 0) {
      throw new ValidationError(
        "Cannot aggregate trace: all spans have invalid timestamps",
        "spans",
        spans,
      );
    }

    const spanIds = spans.map((span) => span.spanId);
    const totalSpans = spans.length;

    // Find start and end times using only spans with valid timestamps
    const validStartTimes = spansWithValidTimestamps.map(
      (span) => span.startTimeUnixMs,
    );
    const validEndTimes = spansWithValidTimestamps.map(
      (span) => span.endTimeUnixMs,
    );

    const startTimeUnixMs = Math.min(...validStartTimes);
    const endTimeUnixMs = Math.max(...validEndTimes);
    const durationMs = endTimeUnixMs - startTimeUnixMs;

    // Extract unique service names from resource attributes
    const serviceNamesSet = new Set<string>();
    for (const span of spans) {
      const serviceName = span.resourceAttributes?.["service.name"];
      if (typeof serviceName === "string" && serviceName) {
        serviceNamesSet.add(serviceName);
      }
    }
    const serviceNames = Array.from(serviceNamesSet).sort();

    // Find root span (span with no parent or parent not in this trace)
    const spanIdsSet = new Set(spanIds);
    let rootSpanId: string | null = null;
    for (const span of spans) {
      if (!span.parentSpanId || !spanIdsSet.has(span.parentSpanId)) {
        rootSpanId = span.spanId;
        break;
      }
    }
    // If no root found, use the first span
    if (!rootSpanId && spans.length > 0) {
      rootSpanId = spans[0].spanId;
    }

    // Use the traceId from the first span
    const traceId = spans[0].traceId;

    // Extract computed fields
    const IOSchemaVersion = "2025-11-23";
    let ComputedInput: string | null = null;
    let ComputedOutput: string | null = null;
    const computedMetadata: Record<string, string> = {};

    const modelsSet = new Set<string>();
    const TopicId = null;
    const SubTopicId = null;

    let TotalPromptTokenCount: number | null = null;
    let TotalCompletionTokenCount: number | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    let HasAnnotation: boolean | null = null;
    let ContainsErrorStatus = false;
    let ContainsOKStatus = false;

    let TimeToFirstTokenMs: number | null = null;
    let TimeToLastTokenMs: number | null = null;

    // Process all spans to extract metrics
    for (const span of spans) {
      // Extract ComputedInput and ComputedOutput
      const genAiInputMessages = span.attributes?.["gen_ai.input.messages"];
      if (
        typeof genAiInputMessages === "string" &&
        genAiInputMessages &&
        !ComputedInput
      ) {
        try {
          const parsed = JSON.parse(genAiInputMessages);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstMessage = parsed[0];
            if (typeof firstMessage === "object" && firstMessage !== null) {
              const content =
                firstMessage.content ||
                (firstMessage.parts &&
                  Array.isArray(firstMessage.parts) &&
                  firstMessage.parts
                    .map(
                      (p: { content?: string; text?: string }) =>
                        p.content || p.text || "",
                    )
                    .join(" ")) ||
                JSON.stringify(firstMessage);
              ComputedInput =
                typeof content === "string" ? content : JSON.stringify(content);
            } else {
              ComputedInput = JSON.stringify(parsed);
            }
          } else {
            ComputedInput = JSON.stringify(parsed);
          }
        } catch {
          ComputedInput = genAiInputMessages;
        }
      }

      const genAiOutputMessages = span.attributes?.["gen_ai.output.messages"];
      if (
        typeof genAiOutputMessages === "string" &&
        genAiOutputMessages &&
        !ComputedOutput
      ) {
        try {
          const parsed = JSON.parse(genAiOutputMessages);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstMessage = parsed[0];
            if (typeof firstMessage === "object" && firstMessage !== null) {
              const content =
                firstMessage.content ||
                (firstMessage.parts &&
                  Array.isArray(firstMessage.parts) &&
                  firstMessage.parts
                    .map(
                      (p: { content?: string; text?: string }) =>
                        p.content || p.text || "",
                    )
                    .join(" ")) ||
                JSON.stringify(firstMessage);
              ComputedOutput =
                typeof content === "string" ? content : JSON.stringify(content);
            } else {
              ComputedOutput = JSON.stringify(parsed);
            }
          } else {
            ComputedOutput = JSON.stringify(parsed);
          }
        } catch {
          ComputedOutput = genAiOutputMessages;
        }
      }

      // Fallback to legacy attribute names
      const legacyGenAiPrompt = span.attributes?.["gen_ai.prompt"];
      if (
        typeof legacyGenAiPrompt === "string" &&
        legacyGenAiPrompt &&
        !ComputedInput
      ) {
        ComputedInput = legacyGenAiPrompt;
      }
      const legacyGenAiCompletion = span.attributes?.["gen_ai.completion"];
      if (
        typeof legacyGenAiCompletion === "string" &&
        legacyGenAiCompletion &&
        !ComputedOutput
      ) {
        ComputedOutput = legacyGenAiCompletion;
      }

      // Fallback to computed.* attributes
      const computedInput = span.attributes?.["computed.input"];
      if (
        typeof computedInput === "string" &&
        computedInput &&
        !ComputedInput
      ) {
        ComputedInput = computedInput;
      }
      const computedOutput = span.attributes?.["computed.output"];
      if (
        typeof computedOutput === "string" &&
        computedOutput &&
        !ComputedOutput
      ) {
        ComputedOutput = computedOutput;
      }

      // Extract model names
      const responseModel = span.attributes?.["gen_ai.response.model"];
      if (typeof responseModel === "string" && responseModel) {
        modelsSet.add(responseModel);
      }
      const requestModel = span.attributes?.["gen_ai.request.model"];
      if (typeof requestModel === "string" && requestModel) {
        modelsSet.add(requestModel);
      }
      const legacyModel = span.attributes?.model;
      if (typeof legacyModel === "string" && legacyModel) {
        modelsSet.add(legacyModel);
      }

      // Extract token counts
      const inputTokens = span.attributes?.["gen_ai.usage.input_tokens"];
      if (typeof inputTokens === "number" && inputTokens > 0) {
        totalPromptTokens += inputTokens;
      }
      const outputTokens = span.attributes?.["gen_ai.usage.output_tokens"];
      if (typeof outputTokens === "number" && outputTokens > 0) {
        totalCompletionTokens += outputTokens;
      }
      const legacyPromptTokens = span.attributes?.["llm.prompt_tokens"];
      if (typeof legacyPromptTokens === "number" && legacyPromptTokens > 0) {
        totalPromptTokens += legacyPromptTokens;
      }
      const legacyCompletionTokens = span.attributes?.["llm.completion_tokens"];
      if (
        typeof legacyCompletionTokens === "number" &&
        legacyCompletionTokens > 0
      ) {
        totalCompletionTokens += legacyCompletionTokens;
      }

      // Check for annotations
      const hasAnnotation = span.attributes?.["has.annotation"];
      if (typeof hasAnnotation === "boolean") {
        HasAnnotation = hasAnnotation || HasAnnotation === true;
      }

      // Check status codes
      if (span.status.code === 1) {
        ContainsOKStatus = true;
      } else if (span.status.code === 2) {
        ContainsErrorStatus = true;
      }

      // Extract conversation ID
      const conversationId = span.attributes?.["gen_ai.conversation.id"];
      if (typeof conversationId === "string" && conversationId) {
        computedMetadata["gen_ai.conversation.id"] = conversationId;
      }
      const langwatchThreadId = span.attributes?.["langwatch.thread.id"];
      if (
        typeof langwatchThreadId === "string" &&
        langwatchThreadId &&
        !computedMetadata["gen_ai.conversation.id"]
      ) {
        computedMetadata["gen_ai.conversation.id"] = langwatchThreadId;
      }

      // Extract metadata attributes
      for (const [key, value] of Object.entries(span.attributes || {})) {
        if (
          typeof value === "string" &&
          (key.startsWith("computed.") ||
            key.startsWith("metadata.") ||
            key.startsWith("trace."))
        ) {
          computedMetadata[key] = value;
        }
      }

      // Calculate TimeToFirstTokenMs and TimeToLastTokenMs
      if (span.events && span.events.length > 0) {
        for (const event of span.events) {
          const isFirstTokenEvent =
            event.name === "gen_ai.content.chunk" ||
            event.name === "first_token" ||
            event.name === "llm.first_token";

          if (isFirstTokenEvent) {
            const timeToFirstToken = event.timeUnixMs - span.startTimeUnixMs;
            if (
              TimeToFirstTokenMs === null ||
              timeToFirstToken < TimeToFirstTokenMs
            ) {
              TimeToFirstTokenMs = timeToFirstToken;
            }
          }

          const isLastTokenEvent =
            event.name === "gen_ai.content.chunk" ||
            event.name === "last_token" ||
            event.name === "llm.last_token";

          if (isLastTokenEvent) {
            const timeToLastToken = event.timeUnixMs - span.startTimeUnixMs;
            if (
              TimeToLastTokenMs === null ||
              timeToLastToken > TimeToLastTokenMs
            ) {
              TimeToLastTokenMs = timeToLastToken;
            }
          }
        }
      }
    }

    // Set token counts if found
    if (totalPromptTokens > 0) {
      TotalPromptTokenCount = totalPromptTokens;
    }
    if (totalCompletionTokens > 0) {
      TotalCompletionTokenCount = totalCompletionTokens;
    }

    // Compute TokensPerSecond
    let TokensPerSecond: number | null = null;
    if (
      TotalCompletionTokenCount !== null &&
      TotalCompletionTokenCount > 0 &&
      durationMs > 0
    ) {
      TokensPerSecond = Math.round(
        (TotalCompletionTokenCount / durationMs) * 1000,
      );
    }

    const Models = Array.from(modelsSet).sort();

    return {
      traceId,
      spanIds,
      totalSpans,
      startTimeUnixMs,
      endTimeUnixMs,
      durationMs,
      serviceNames,
      rootSpanId,
      IOSchemaVersion,
      ComputedInput,
      ComputedOutput,
      ComputedMetadata: computedMetadata,
      TimeToFirstTokenMs,
      TimeToLastTokenMs,
      TokensPerSecond,
      ContainsErrorStatus,
      ContainsOKStatus,
      Models,
      TopicId,
      SubTopicId,
      TotalPromptTokenCount,
      TotalCompletionTokenCount,
      HasAnnotation,
    };
  }
}

export const traceAggregationService = new TraceAggregationService();
