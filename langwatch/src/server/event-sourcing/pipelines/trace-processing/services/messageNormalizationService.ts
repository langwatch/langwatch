import { SpanKind, type Span as OtelSpan } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { match } from "ts-pattern";
import { createLogger } from "../../../../../utils/logger";
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicTextBlock,
  BedrockClaudeMessage,
  CohereMessage,
  GenAIRichContent,
  GeminiMessage,
  GeminiPart,
  OpenTelemetryGenAIMessage,
} from "../schemas/messageSchemas";
import {
  AnyProviderMessages,
  detectMessageFormat,
  MessageFormat,
  OpenTelemetryGenAIMessage as OpenTelemetryGenAIMessageSchema,
} from "../schemas/messageSchemas";

// ============================================================================
// Types
// ============================================================================

/**
 * Typed value wrapper used by LangWatch spans.
 */
interface TypedValueWrapper {
  type: string;
  value: unknown;
}

/**
 * Result of preparing input for normalization.
 */
type PreparedInput =
  | { kind: "empty" }
  | { kind: "string"; value: string }
  | { kind: "messages"; value: unknown[] }
  | { kind: "fallback"; value: unknown };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard for chat_messages typed value wrapper.
 */
const isChatMessagesTypedValue = (value: unknown): value is TypedValueWrapper =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  "value" in value &&
  (value as TypedValueWrapper).type === "chat_messages";

/**
 * Unwraps a typed value wrapper, returning the inner value.
 */
const unwrapTypedValue = (value: unknown): unknown =>
  isChatMessagesTypedValue(value) ? value.value : value;

/**
 * Checks if a value looks like a message object.
 */
const isMessageLike = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  ("role" in value || "content" in value || "parts" in value);

/**
 * Maps Gemini role to OpenTelemetry GenAI role.
 */
const mapGeminiRole = (role: string): "assistant" | "tool" | "user" =>
  match(role)
    .with("model", () => "assistant" as const)
    .with("function", () => "tool" as const)
    .otherwise(() => "user" as const);

/**
 * Maps Cohere role to OpenTelemetry GenAI role.
 */
const mapCohereRole = (
  role: string,
): "assistant" | "system" | "tool" | "user" =>
  match(role)
    .with("CHATBOT", () => "assistant" as const)
    .with("SYSTEM", () => "system" as const)
    .with("TOOL", () => "tool" as const)
    .otherwise(() => "user" as const);

/**
 * Converts base64 image data to data URI.
 */
const toDataUri = (mediaType: string, data: string): string =>
  `data:${mediaType};base64,${data}`;

// ============================================================================
// Service
// ============================================================================

/**
 * Service for normalizing messages from various LLM providers to OpenTelemetry GenAI format.
 *
 * Supports progressive fallback:
 * 1. Try to validate and use as-is (OpenTelemetry/LangWatch/OpenAI format)
 * 2. Try provider-specific transformations (Anthropic, Google, Cohere, Bedrock)
 * 3. Best effort: stringify and wrap in a message
 *
 * Never throws errors - always returns valid messages array.
 */
export class MessageNormalizationService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.message-normalization",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:message-normalization",
  );

  /**
   * Normalizes messages from any supported provider format to OpenTelemetry GenAI format.
   *
   * @param input - Messages in any supported format (or unknown format)
   * @returns Array of OpenTelemetry GenAI formatted messages
   */
  normalizeMessages(input: unknown): OpenTelemetryGenAIMessage[] {
    return this.tracer.withActiveSpan(
      "MessageNormalizationService.normalizeMessages",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "input.type": typeof input,
          "input.is_array": Array.isArray(input),
        },
      },
      (span) => this.processInput(this.prepareInput(input), span),
    );
  }

  /**
   * Prepares input for normalization by unwrapping and categorizing.
   */
  private prepareInput(input: unknown): PreparedInput {
    // Handle null/undefined
    if (input === null || input === undefined) {
      return { kind: "empty" };
    }

    // Unwrap typed value wrapper
    const unwrapped = unwrapTypedValue(input);

    // Handle string
    if (typeof unwrapped === "string") {
      return { kind: "string", value: unwrapped };
    }

    // Handle single message object
    if (!Array.isArray(unwrapped)) {
      if (isMessageLike(unwrapped)) {
        return { kind: "messages", value: [unwrapped] };
      }
      return { kind: "fallback", value: unwrapped };
    }

    // Handle empty array
    if (unwrapped.length === 0) {
      return { kind: "empty" };
    }

    // Unwrap and flatten typed value wrappers in array elements
    const messages = unwrapped.flatMap((msg) => {
      const inner = unwrapTypedValue(msg);
      return Array.isArray(inner) ? inner : [inner];
    });

    return { kind: "messages", value: messages };
  }

  /**
   * Processes prepared input and returns normalized messages.
   */
  private processInput(
    prepared: PreparedInput,
    span: OtelSpan,
  ): OpenTelemetryGenAIMessage[] {
    return match(prepared)
      .with({ kind: "empty" }, () => {
        span.setAttributes({ "message.count": 0 });
        return [];
      })
      .with({ kind: "string" }, ({ value }) => {
        span.setAttributes({ "message.count": 1, "detected.format": "string" });
        return [{ role: "user" as const, content: value }];
      })
      .with({ kind: "fallback" }, ({ value }) => {
        this.logger.warn({ inputType: typeof value }, "Using fallback message");
        span.setAttributes({ "message.count": 1, "fallback.used": true });
        return [this.createFallbackMessage(value)];
      })
      .with({ kind: "messages" }, ({ value }) =>
        this.normalizeMessageArray(value, span),
      )
      .exhaustive();
  }

  /**
   * Normalizes an array of messages.
   */
  private normalizeMessageArray(
    messages: unknown[],
    span: OtelSpan,
  ): OpenTelemetryGenAIMessage[] {
    const detectedFormat = detectMessageFormat(messages);

    span.setAttributes({
      "detected.format": detectedFormat,
      "message.count": messages.length,
    });

    // Try format-specific coercion
    if (detectedFormat !== MessageFormat.Unknown) {
      try {
        const result = this.coerceToOpenTelemetryFormat(
          messages,
          detectedFormat,
        );
        span.setAttributes({
          "coercion.success": true,
          "fallback.used": false,
        });
        return result;
      } catch {
        this.logger.warn({ format: detectedFormat }, "Format coercion failed");
      }
    }

    // Try generic validation
    const validation = AnyProviderMessages.safeParse(messages);
    if (validation.success) {
      const result = this.coerceToOpenTelemetryFormat(
        validation.data,
        MessageFormat.OpenAI,
      );
      span.setAttributes({ "coercion.success": true, "fallback.used": false });
      return result;
    }

    // Fallback: create messages from each item
    this.logger.warn(
      { error: validation.error.message, sampleMessage: messages[0] },
      "Message validation failed, using fallback",
    );
    span.setAttributes({ "coercion.success": false, "fallback.used": true });
    return messages.map((item) => this.createFallbackMessage(item));
  }

  /**
   * Coerces messages from a specific provider format to OpenTelemetry GenAI format.
   */
  private coerceToOpenTelemetryFormat(
    messages: unknown[],
    format: MessageFormat,
  ): OpenTelemetryGenAIMessage[] {
    return match(format)
      .with(
        MessageFormat.OpenTelemetryGenAI,
        MessageFormat.LangWatch,
        MessageFormat.OpenAI,
        () => this.normalizeOpenAILike(messages),
      )
      .with(MessageFormat.Anthropic, () =>
        this.normalizeAnthropic(messages as AnthropicMessage[]),
      )
      .with(MessageFormat.Gemini, () =>
        this.normalizeGemini(messages as GeminiMessage[]),
      )
      .with(MessageFormat.Cohere, () =>
        this.normalizeCohere(messages as CohereMessage[]),
      )
      .with(MessageFormat.BedrockClaude, () =>
        this.normalizeAnthropic(messages as unknown as AnthropicMessage[]),
      )
      .otherwise(() => messages.map((msg) => this.createFallbackMessage(msg)));
  }

  // ==========================================================================
  // OpenAI-like Normalization
  // ==========================================================================

  private normalizeOpenAILike(
    messages: unknown[],
  ): OpenTelemetryGenAIMessage[] {
    return messages.map((msg) => {
      const msgObj = msg as Record<string, unknown>;
      const preprocessed = {
        ...msgObj,
        content: this.preprocessOpenAIContent(msgObj.content),
      };

      const result = OpenTelemetryGenAIMessageSchema.safeParse(preprocessed);
      if (result.success) {
        return result.data;
      }

      return this.coerceToMessage(preprocessed);
    });
  }

  /**
   * Handles OpenAI image_url shorthand: { image_url: "url" } → { image_url: { url: "url" } }
   */
  private preprocessOpenAIContent(content: unknown): unknown {
    if (!Array.isArray(content)) return content;

    return content.map((item: unknown) => {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        (item as { type: string }).type === "image_url" &&
        "image_url" in item &&
        typeof (item as { image_url: unknown }).image_url === "string"
      ) {
        return {
          type: "image_url",
          image_url: { url: (item as { image_url: string }).image_url },
        };
      }
      return item;
    });
  }

  private coerceToMessage(
    data: Record<string, unknown>,
  ): OpenTelemetryGenAIMessage {
    const message: OpenTelemetryGenAIMessage = {
      role: (data.role as OpenTelemetryGenAIMessage["role"]) || "unknown",
      content: (data.content as OpenTelemetryGenAIMessage["content"]) || null,
    };

    if (data.name) message.name = data.name as string;
    if (data.function_call)
      message.function_call =
        data.function_call as OpenTelemetryGenAIMessage["function_call"];
    if (data.tool_calls)
      message.tool_calls =
        data.tool_calls as OpenTelemetryGenAIMessage["tool_calls"];
    if (data.tool_call_id) message.tool_call_id = data.tool_call_id as string;

    return message;
  }

  // ==========================================================================
  // Anthropic Normalization
  // ==========================================================================

  private normalizeAnthropic(
    messages: AnthropicMessage[],
  ): OpenTelemetryGenAIMessage[] {
    return messages.map((msg) => {
      const role = msg.role === "assistant" ? "assistant" : "user";

      if (typeof msg.content === "string") {
        return { role, content: msg.content };
      }

      if (!Array.isArray(msg.content)) {
        return { role, content: null };
      }

      const richContent = msg.content
        .map((block) => this.convertAnthropicBlock(block))
        .filter((item): item is GenAIRichContent => item !== null);

      if (richContent.length > 0) {
        return { role, content: richContent };
      }

      // Fallback: extract text content as string
      const textContent = msg.content
        .filter((b): b is AnthropicTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      return { role, content: textContent || null };
    });
  }

  private convertAnthropicBlock(
    block: AnthropicContentBlock,
  ): GenAIRichContent | null {
    return match(block)
      .with({ type: "text" }, (b) => ({
        type: "text" as const,
        text: b.text,
      }))
      .with({ type: "image" }, (b) => ({
        type: "image_url" as const,
        image_url: { url: toDataUri(b.source.media_type, b.source.data) },
      }))
      .with({ type: "tool_use" }, (b) => ({
        type: "tool_call" as const,
        toolName: b.name,
        toolCallId: b.id,
        args: JSON.stringify(b.input),
      }))
      .with({ type: "tool_result" }, (b) => ({
        type: "tool_result" as const,
        toolCallId: b.tool_use_id,
        result: this.extractToolResultContent(b.content),
      }))
      .exhaustive();
  }

  private extractToolResultContent(
    content: string | AnthropicTextBlock[] | undefined,
  ): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((c) => c.text).join(" ");
    return "";
  }

  // ==========================================================================
  // Gemini Normalization
  // ==========================================================================

  private normalizeGemini(
    messages: GeminiMessage[],
  ): OpenTelemetryGenAIMessage[] {
    return messages.map((msg) => {
      const role = mapGeminiRole(msg.role);

      if (!msg.parts || msg.parts.length === 0) {
        return { role, content: null };
      }

      // Single text part → simple string
      if (msg.parts.length === 1) {
        const first = msg.parts[0];
        if (first && "text" in first) {
          return { role, content: first.text };
        }
      }

      // Multiple parts → rich content
      const richContent = msg.parts
        .map((part) => this.convertGeminiPart(part))
        .filter((item): item is GenAIRichContent => item !== null);

      // Single text result → simplify to string
      if (richContent.length === 1 && richContent[0]?.type === "text") {
        return { role, content: (richContent[0] as { text: string }).text };
      }

      return { role, content: richContent.length > 0 ? richContent : null };
    });
  }

  private convertGeminiPart(part: GeminiPart): GenAIRichContent | null {
    if ("text" in part) {
      return { type: "text", text: part.text };
    }
    if ("inline_data" in part) {
      return {
        type: "image_url",
        image_url: {
          url: toDataUri(part.inline_data.mime_type, part.inline_data.data),
        },
      };
    }
    if ("function_call" in part) {
      return {
        type: "tool_call",
        toolName: part.function_call.name,
        args: JSON.stringify(part.function_call.args ?? {}),
      };
    }
    if ("function_response" in part) {
      return {
        type: "tool_result",
        toolName: part.function_response.name,
        result: part.function_response.response,
      };
    }
    return null;
  }

  // ==========================================================================
  // Cohere Normalization
  // ==========================================================================

  private normalizeCohere(
    messages: CohereMessage[],
  ): OpenTelemetryGenAIMessage[] {
    return messages.map((msg) => {
      const normalized: OpenTelemetryGenAIMessage = {
        role: mapCohereRole(msg.role),
        content: msg.message || msg.text || null,
      };

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        normalized.tool_calls = msg.tool_calls.map((tc, idx) => ({
          id: `tool_${idx}`,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.parameters),
          },
        }));
      }

      if (msg.tool_results && msg.tool_results.length > 0) {
        normalized.content = msg.tool_results.map((result) => ({
          type: "tool_result" as const,
          toolName: result.call.name,
          result: result.outputs,
        }));
      }

      return normalized;
    });
  }

  // ==========================================================================
  // Fallback
  // ==========================================================================

  /**
   * Creates a fallback message when all parsing attempts fail.
   * Never loses data - stringifies the input and wraps it in a message.
   */
  createFallbackMessage(data: unknown): OpenTelemetryGenAIMessage {
    this.logger.warn(
      { dataType: typeof data },
      "Creating fallback message - data could not be parsed",
    );

    // String → use directly
    if (typeof data === "string") {
      return { role: "user", content: data };
    }

    // Null/undefined → empty content
    if (data === null || data === undefined) {
      return { role: "user", content: "" };
    }

    // Object with role/content → extract
    if (typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if ("role" in obj && "content" in obj) {
        return {
          role: (obj.role as OpenTelemetryGenAIMessage["role"]) || "unknown",
          content:
            typeof obj.content === "string"
              ? obj.content
              : JSON.stringify(obj.content),
        };
      }

      // Stringify object
      try {
        return { role: "user", content: JSON.stringify(data, null, 2) };
      } catch {
        return { role: "user", content: String(data) };
      }
    }

    // Primitive → convert to string
    return { role: "user", content: String(data) };
  }
}
