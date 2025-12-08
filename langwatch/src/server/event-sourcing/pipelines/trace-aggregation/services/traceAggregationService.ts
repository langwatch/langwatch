import { createLogger } from "../../../../../utils/logger";
import { ValidationError } from "../../../library/services/errorHandling";
import type { SpanData } from "../../span-ingestion/schemas/commands";
import type { TraceAggregationCompletedEventData } from "../schemas/events";

/**
 * Service that handles the business logic of aggregating spans into trace metadata.
 */
export class TraceAggregationService {
  logger = createLogger("langwatch:trace-aggregation-service");

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
   * Computes total spans, duration, service names, root span ID, start/end times,
   * and all computed metrics matching the trace_summaries ClickHouse schema.
   *
   * Extracts data from spans using OpenTelemetry GenAI semantic conventions:
   * - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens for token counts
   * - gen_ai.request.model / gen_ai.response.model for model names
   * - gen_ai.input.messages / gen_ai.output.messages for input/output content
   * - gen_ai.conversation.id for conversation/thread tracking
   *
   * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
   */
  aggregateTrace(spans: SpanData[]): TraceAggregationCompletedEventData {
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

    // Use the traceId from the first span (all spans should have the same traceId)
    const traceId = spans[0].traceId;

    // Extract IOSchemaVersion, ComputedInput, ComputedOutput from span attributes
    const IOSchemaVersion = "2025-11-23";
    let ComputedInput: string | null = null;
    let ComputedOutput: string | null = null;
    const computedMetadata: Record<string, string> = {};

    // Extract Models array from span attributes
    const modelsSet = new Set<string>();

    // Extract TopicId and SubTopicId
    const TopicId = null;
    const SubTopicId = null;

    // Sum token counts across spans
    let TotalPromptTokenCount: number | null = null;
    let TotalCompletionTokenCount: number | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // Check for annotations
    let HasAnnotation: boolean | null = null;

    // Check status flags
    let ContainsErrorStatus = false;
    let ContainsOKStatus = false;

    // Calculate TimeToFirstTokenMs and TimeToLastTokenMs from span events
    let TimeToFirstTokenMs: number | null = null;
    let TimeToLastTokenMs: number | null = null;

    // Process all spans to extract metrics
    for (const span of spans) {
      // Extract ComputedInput and ComputedOutput
      // Use latest GenAI semantic convention attributes: gen_ai.input.messages and gen_ai.output.messages
      const genAiInputMessages = span.attributes?.["gen_ai.input.messages"];
      if (
        typeof genAiInputMessages === "string" &&
        genAiInputMessages &&
        !ComputedInput
      ) {
        // Parse JSON string to extract content
        try {
          const parsed = JSON.parse(genAiInputMessages);
          // If it's an array of messages, extract the content
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstMessage = parsed[0];
            if (typeof firstMessage === "object" && firstMessage !== null) {
              // Extract content from message parts or direct content field
              const content =
                firstMessage.content ||
                (firstMessage.parts &&
                  Array.isArray(firstMessage.parts) &&
                  firstMessage.parts
                    .map((p: any) => p.content || p.text || "")
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
          // If parsing fails, use the raw string
          ComputedInput = genAiInputMessages;
        }
      }

      const genAiOutputMessages = span.attributes?.["gen_ai.output.messages"];
      if (
        typeof genAiOutputMessages === "string" &&
        genAiOutputMessages &&
        !ComputedOutput
      ) {
        // Parse JSON string to extract content
        try {
          const parsed = JSON.parse(genAiOutputMessages);
          // If it's an array of messages, extract the content
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstMessage = parsed[0];
            if (typeof firstMessage === "object" && firstMessage !== null) {
              // Extract content from message parts or direct content field
              const content =
                firstMessage.content ||
                (firstMessage.parts &&
                  Array.isArray(firstMessage.parts) &&
                  firstMessage.parts
                    .map((p: any) => p.content || p.text || "")
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
          // If parsing fails, use the raw string
          ComputedOutput = genAiOutputMessages;
        }
      }

      // Fallback to legacy attribute names for backwards compatibility
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

      // Fallback to computed.* attributes for backwards compatibility
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

      // Extract model names from GenAI semantic conventions
      // Prefer gen_ai.response.model (actual model used) over gen_ai.request.model
      const responseModel = span.attributes?.["gen_ai.response.model"];
      if (typeof responseModel === "string" && responseModel) {
        modelsSet.add(responseModel);
      }
      const requestModel = span.attributes?.["gen_ai.request.model"];
      if (typeof requestModel === "string" && requestModel) {
        modelsSet.add(requestModel);
      }
      // Fallback to legacy attribute names for backwards compatibility
      const legacyModel = span.attributes?.model;
      if (typeof legacyModel === "string" && legacyModel) {
        modelsSet.add(legacyModel);
      }

      // Extract token counts from GenAI semantic conventions
      // Use gen_ai.usage.input_tokens and gen_ai.usage.output_tokens per OTEL spec
      const inputTokens = span.attributes?.["gen_ai.usage.input_tokens"];
      if (typeof inputTokens === "number" && inputTokens > 0) {
        totalPromptTokens += inputTokens;
      }
      const outputTokens = span.attributes?.["gen_ai.usage.output_tokens"];
      if (typeof outputTokens === "number" && outputTokens > 0) {
        totalCompletionTokens += outputTokens;
      }
      // Fallback to legacy attribute names for backwards compatibility
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

      // Check status codes (OpenTelemetry status code: 1=OK, 2=ERROR)
      if (span.status.code === 1) {
        ContainsOKStatus = true;
      } else if (span.status.code === 2) {
        ContainsErrorStatus = true;
      }

      // Extract conversation ID from GenAI semantic conventions
      const conversationId = span.attributes?.["gen_ai.conversation.id"];
      if (typeof conversationId === "string" && conversationId) {
        computedMetadata["gen_ai.conversation.id"] = conversationId;
      }
      // Fallback to langwatch.thread.id for backwards compatibility
      const langwatchThreadId = span.attributes?.["langwatch.thread.id"];
      if (
        typeof langwatchThreadId === "string" &&
        langwatchThreadId &&
        !computedMetadata["gen_ai.conversation.id"]
      ) {
        computedMetadata["gen_ai.conversation.id"] = langwatchThreadId;
      }

      // Extract relevant metadata attributes
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

      // Calculate TimeToFirstTokenMs and TimeToLastTokenMs from span events
      // According to OTEL GenAI conventions, token events may be recorded as span events
      // We look for common event names that indicate token generation milestones
      if (span.events && span.events.length > 0) {
        for (const event of span.events) {
          // Look for first token events - common names include:
          // - "gen_ai.content.chunk" (first chunk event)
          // - "first_token", "llm.first_token" (legacy names)
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

          // Look for last token events - common names include:
          // - "gen_ai.content.chunk" (last chunk event - we track the latest)
          // - "last_token", "llm.last_token" (legacy names)
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

    // Set token counts if we found any
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
