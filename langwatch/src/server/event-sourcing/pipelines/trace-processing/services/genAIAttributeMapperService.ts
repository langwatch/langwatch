import type { Attributes } from "@opentelemetry/api";
import { pipe } from "fp-ts/function";
import { fromNullable, fold } from "fp-ts/Option";
import { match } from "ts-pattern";
import type { LLMSpan, Span } from "../../../../tracer/types";
import type { OpenTelemetryGenAIMessage } from "../schemas/messageSchemas";
import { MessageNormalizationService } from "./messageNormalizationService";
import { MessageTextExtractionUtils } from "../utils/messageTextExtraction.utils";
import { OtelConversionUtils } from "../utils/otelConversion.utils";

/**
 * Service for mapping LangWatch span attributes to OpenTelemetry GenAI semantic convention attributes.
 *
 * Handles conversion of:
 * - Operation names (gen_ai.operation.name)
 * - Model information (gen_ai.request.model, gen_ai.response.model)
 * - Input/output messages (gen_ai.input.messages, gen_ai.output.messages)
 * - Token usage (gen_ai.usage.input_tokens, gen_ai.usage.output_tokens)
 * - Request parameters (gen_ai.request.*)
 * - Error information (error.type)
 *
 * @example
 * ```typescript
 * const mapper = new GenAIAttributeMapperService();
 * const attributes = mapper.mapGenAiAttributes(llmSpan);
 * ```
 *
 * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
 */
export class GenAIAttributeMapperService {
  private readonly messageNormalizationService: MessageNormalizationService;

  constructor(
    messageNormalizationService: MessageNormalizationService = new MessageNormalizationService(),
  ) {
    this.messageNormalizationService = messageNormalizationService;
  }

  /**
   * Maps LangWatch span attributes to GenAI semantic convention attributes.
   * Uses functional composition for better maintainability.
   *
   * @param langWatchSpan - The LangWatch span to map attributes from
   * @returns OpenTelemetry GenAI semantic convention attributes
   */
  mapGenAiAttributes(langWatchSpan: Span): Attributes {
    return {
      ...this.mapOperationName(langWatchSpan),
      ...this.mapModelAttributes(langWatchSpan),
      ...this.mapInputAttributes(langWatchSpan),
      ...this.mapOutputAttributes(langWatchSpan),
      ...this.mapMetricsAttributes(langWatchSpan),
      ...this.mapParamsAttributes(langWatchSpan),
      ...this.mapErrorAttributes(langWatchSpan),
    };
  }

  /**
   * Maps span type to GenAI operation name.
   */
  private mapOperationName(span: Span): Attributes {
    return pipe(
      fromNullable(
        OtelConversionUtils.convertSpanTypeToGenAiOperationName(span.type),
      ),
      fold(
        () => ({}),
        (name: string) => ({ "gen_ai.operation.name": name }),
      ),
    );
  }

  /**
   * Maps model information from LLM spans.
   */
  private mapModelAttributes(span: Span): Attributes {
    return match(span)
      .when(
        (s) => s.type === "llm" && "model" in s && Boolean(s.model),
        (s: LLMSpan) => ({
          "gen_ai.request.model": s.model,
          "gen_ai.response.model": s.model,
        }),
      )
      .otherwise(() => ({}));
  }

  /**
   * Extracts system instruction content from a message's content field.
   */
  private extractSystemContent(
    content: OpenTelemetryGenAIMessage["content"],
  ): string | null {
    if (content === null || content === void 0) {
      return null;
    }

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const extractedText =
        MessageTextExtractionUtils.extractTextFromRichContent(content);

      // Only set systemContent if we found text parts, otherwise leave as null
      // Empty string means we found a system message but no text content
      if (extractedText.length > 0) {
        return extractedText;
      } else {
        // No text content found - return empty string (not null) to indicate system message exists
        return "";
      }
    }

    return null;
  }

  /**
   * Extracts system messages from normalized messages array.
   * Returns the system instruction content and remaining messages.
   *
   * @param messages - Normalized OpenTelemetry GenAI messages
   * @returns Object with systemInstruction (if found) and remaining messages
   */
  private extractSystemInstruction(messages: OpenTelemetryGenAIMessage[]): {
    systemInstruction: string | null;
    remainingMessages: OpenTelemetryGenAIMessage[];
  } {
    if (messages.length === 0) {
      return { systemInstruction: null, remainingMessages: [] };
    }

    const firstMessage = messages[0];
    if (!firstMessage) {
      return { systemInstruction: null, remainingMessages: messages };
    }

    // Check if first message is a system message
    if (firstMessage.role !== "system") {
      return { systemInstruction: null, remainingMessages: messages };
    }

    const systemContent = this.extractSystemContent(firstMessage.content);
    if (systemContent !== null) {
      return {
        systemInstruction: systemContent,
        remainingMessages: messages.slice(1),
      };
    }

    // No system instruction extracted (null content) - keep system message in array
    return {
      systemInstruction: null,
      remainingMessages: messages,
    };
  }

  /**
   * Maps LangWatch span input/output to GenAI semantic convention attributes.
   * Uses gen_ai.input.messages or gen_ai.output.messages per the latest OTEL GenAI conventions.
   *
   * ONLY applies to LLM spans. Non-LLM spans keep langwatch.input/langwatch.output as-is.
   *
   * According to the spec, gen_ai.input.messages/gen_ai.output.messages should be used for all content.
   * Since structured attributes may not be supported on spans yet, we serialize to JSON string.
   * When structured attributes become available, this should be updated to use structured format.
   *
   * @param spanInput - The span input or output object
   * @param attributeKey - The attribute key to use ("gen_ai.input.messages" or "gen_ai.output.messages")
   * @param defaultRole - The default role for text inputs ("user" for input, "assistant" for output)
   * @param extractSystem - Whether to extract system messages (only for input)
   * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
   */
  private mapIoAttributes(
    spanInput: Span["input"] | Span["output"],
    attributeKey: "gen_ai.input.messages" | "gen_ai.output.messages",
    defaultRole: "user" | "assistant",
    { extractSystem = false }: { extractSystem?: boolean } = {},
  ): Attributes {
    if (!spanInput) return {};

    const normalizedMessages = match(spanInput.type)
      .with("chat_messages", () =>
        this.messageNormalizationService.normalizeMessages(spanInput),
      )
      .with(
        "text",
        () =>
          [
            { role: defaultRole, content: spanInput.value },
          ] as OpenTelemetryGenAIMessage[],
      )
      .otherwise(() =>
        this.messageNormalizationService.normalizeMessages(spanInput.value),
      );

    // Extract system instruction if requested (only for input)
    if (extractSystem && attributeKey === "gen_ai.input.messages") {
      const { systemInstruction, remainingMessages } =
        this.extractSystemInstruction(normalizedMessages);

      const attributes: Attributes = {
        [attributeKey]: JSON.stringify(remainingMessages),
      };

      // Set system instruction if it exists (even if empty string)
      // null means no system message or null content - don't set attribute
      // empty string means system message exists but has no text content - set it
      return systemInstruction !== null
        ? {
            ...attributes,
            "gen_ai.request.system_instruction": systemInstruction,
          }
        : attributes;
    }

    return {
      [attributeKey]: JSON.stringify(normalizedMessages),
    };
  }

  /**
   * Maps LangWatch span input to GenAI semantic convention attributes.
   * Uses gen_ai.input.messages per the latest OTEL GenAI conventions.
   * Extracts system messages to gen_ai.request.system_instruction if present.
   *
   * ONLY applies to LLM spans. Non-LLM spans keep langwatch.input as-is.
   *
   * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
   */
  private mapInputAttributes(span: Span): Attributes {
    // ONLY for LLM spans - normalize to gen_ai.input.messages
    if (span.type !== "llm" || !span.input) {
      // Non-LLM spans: return empty (keep langwatch.input as-is)
      return {};
    }

    // Extract system instruction from messages if present
    return this.mapIoAttributes(span.input, "gen_ai.input.messages", "user", {
      extractSystem: true,
    });
  }

  /**
   * Maps LangWatch span output to GenAI semantic convention attributes.
   * Uses gen_ai.output.messages per the latest OTEL GenAI conventions.
   *
   * ONLY applies to LLM spans. Non-LLM spans keep langwatch.output as-is.
   *
   * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
   */
  private mapOutputAttributes(span: Span): Attributes {
    // ONLY for LLM spans - normalize to gen_ai.output.messages
    if (span.type !== "llm" || !span.output) {
      // Non-LLM spans: return empty (keep langwatch.output as-is)
      return {};
    }

    return this.mapIoAttributes(
      span.output,
      "gen_ai.output.messages",
      "assistant",
    );
  }

  /**
   * Maps LangWatch span metrics to GenAI semantic convention attributes.
   * Uses gen_ai.usage.input_tokens and gen_ai.usage.output_tokens per OTEL GenAI spec.
   *
   * @see https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-spans.md
   */
  private mapMetricsAttributes(span: Span): Attributes {
    if (!span.metrics) return {};

    const attributes: Attributes = {};
    const { prompt_tokens, completion_tokens } = span.metrics;

    // Map to OTEL GenAI semantic conventions
    if (prompt_tokens != null) {
      attributes["gen_ai.usage.input_tokens"] = prompt_tokens;
    }
    if (completion_tokens != null) {
      attributes["gen_ai.usage.output_tokens"] = completion_tokens;
    }

    return attributes;
  }

  /**
   * Checks if a value is a primitive attribute value (string, number, or boolean).
   */
  private isPrimitiveAttributeValue(
    value: unknown,
  ): value is string | number | boolean {
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }

  /**
   * Maps LangWatch span params to GenAI semantic convention attributes.
   */
  private mapParamsAttributes(span: Span): Attributes {
    if (!span.params) return {};

    const attributes: Attributes = {};
    const params = span.params;

    const paramMappings: Record<string, keyof typeof params> = {
      "gen_ai.request.temperature": "temperature",
      "gen_ai.request.max_tokens": "max_tokens",
      "gen_ai.request.top_p": "top_p",
      "gen_ai.request.frequency_penalty": "frequency_penalty",
      "gen_ai.request.presence_penalty": "presence_penalty",
      "gen_ai.request.seed": "seed",
    };

    for (const [attrKey, paramKey] of Object.entries(paramMappings)) {
      const value = params[paramKey];
      if (value == null) continue;
      if (!this.isPrimitiveAttributeValue(value)) continue;
      attributes[attrKey] = value;
    }

    if (params.stop != null) {
      const rawStops = Array.isArray(params.stop) ? params.stop : [params.stop];
      const stopSequences = rawStops
        .map((v) =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
            ? String(v)
            : null,
        )
        .filter((v): v is string => v !== null);
      if (stopSequences.length > 0) {
        attributes["gen_ai.request.stop_sequences"] = stopSequences;
      }
    }

    if (typeof params.n === "number" && params.n !== 1) {
      attributes["gen_ai.request.choice.count"] = params.n;
    }

    return attributes;
  }

  /**
   * Maps error information to GenAI attributes.
   */
  private mapErrorAttributes(span: Span): Attributes {
    if (span.error?.has_error) {
      return { "error.type": span.error.message || "_OTHER" };
    }
    return {};
  }
}

export const genAIAttributeMapperService = new GenAIAttributeMapperService();
