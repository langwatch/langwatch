import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { TokenizerClient } from "../clients/tokenizer/tokenizer.client";
import { TiktokenClient } from "../clients/tokenizer/tiktoken.client";

/**
 * Attribute keys checked for model name (priority order).
 */
const MODEL_ATTRIBUTE_KEYS = [
  "gen_ai.response.model",
  "gen_ai.request.model",
  "llm.model_name",
  "ai.model",
] as const;

/**
 * Attribute keys that indicate token counts are already present.
 */
const TOKEN_COUNT_KEYS = {
  input: [
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.prompt_tokens",
  ],
  output: [
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.completion_tokens",
  ],
} as const;

/**
 * Dependencies for OtlpSpanTokenEstimationService that can be injected for testing.
 */
export interface OtlpSpanTokenEstimationServiceDependencies {
  tokenizer: Pick<TokenizerClient, "countTokens">;
}

/**
 * Service that estimates token counts for LLM spans that have input/output
 * content but no usage token counts.
 *
 * When token counts are missing, this service tokenizes the input/output text
 * using tiktoken and pushes `gen_ai.usage.input_tokens`,
 * `gen_ai.usage.output_tokens`, and `langwatch.tokens.estimated` attributes
 * onto the span.
 *
 * This service should be applied BEFORE creating immutable events
 * in the event sourcing pipeline (alongside PII redaction and cost enrichment).
 */
export class OtlpSpanTokenEstimationService {
  private readonly deps: OtlpSpanTokenEstimationServiceDependencies;

  constructor(deps: OtlpSpanTokenEstimationServiceDependencies) {
    this.deps = deps;
  }

  static create(): OtlpSpanTokenEstimationService {
    return new OtlpSpanTokenEstimationService({
      tokenizer: new TiktokenClient(),
    });
  }

  /**
   * Estimates token counts for the span if it's an LLM span with input/output
   * but missing token counts. Mutates the span in place (pushes new attributes).
   */
  async estimateSpanTokens(span: OtlpSpan): Promise<void> {
    if (!this.isLlmSpan(span)) return;

    const model = this.extractModelName(span);
    if (!model) return;

    const hasInputTokens = this.hasTokenCountAttribute(span, "input");
    const hasOutputTokens = this.hasTokenCountAttribute(span, "output");

    // If both token counts are already present, nothing to estimate
    if (hasInputTokens && hasOutputTokens) return;

    let estimated = false;

    if (!hasInputTokens) {
      const inputText = this.extractInputText(span);
      if (inputText) {
        const inputTokens = await this.deps.tokenizer.countTokens(
          model,
          inputText,
        );
        if (inputTokens !== undefined) {
          span.attributes.push({
            key: "gen_ai.usage.input_tokens",
            value: { intValue: inputTokens },
          });
          estimated = true;
        }
      }
    }

    if (!hasOutputTokens) {
      const outputText = this.extractOutputText(span);
      if (outputText) {
        const outputTokens = await this.deps.tokenizer.countTokens(
          model,
          outputText,
        );
        if (outputTokens !== undefined) {
          span.attributes.push({
            key: "gen_ai.usage.output_tokens",
            value: { intValue: outputTokens },
          });
          estimated = true;
        }
      }
    }

    if (estimated) {
      span.attributes.push({
        key: "langwatch.tokens.estimated",
        value: { boolValue: true },
      });
    }
  }

  private isLlmSpan(span: OtlpSpan): boolean {
    for (const attr of span.attributes) {
      if (attr.key === "langwatch.span.type") {
        return attr.value.stringValue === "llm";
      }
    }
    return false;
  }

  private extractModelName(span: OtlpSpan): string | null {
    for (const key of MODEL_ATTRIBUTE_KEYS) {
      for (const attr of span.attributes) {
        if (
          attr.key === key &&
          typeof attr.value.stringValue === "string" &&
          attr.value.stringValue.length > 0
        ) {
          return attr.value.stringValue;
        }
      }
    }
    return null;
  }

  private hasTokenCountAttribute(
    span: OtlpSpan,
    direction: "input" | "output",
  ): boolean {
    const keys = TOKEN_COUNT_KEYS[direction];
    for (const attr of span.attributes) {
      if ((keys as readonly string[]).includes(attr.key)) {
        const val =
          attr.value.intValue ?? attr.value.doubleValue;
        if (val !== undefined && val !== null) return true;
      }
    }
    return false;
  }

  /**
   * Extracts text from input attributes for tokenization.
   *
   * Handles:
   * - langwatch.input as JSON string: { type: "chat_messages", value: [...] }
   * - gen_ai.input.messages as JSON string
   */
  private extractInputText(span: OtlpSpan): string | null {
    // Try langwatch.input first (structured format from SDK)
    const langwatchInput = this.getStringAttribute(span, "langwatch.input");
    if (langwatchInput) {
      const text = this.textFromStructuredValue(langwatchInput);
      if (text) return text;
    }

    // Try gen_ai.input.messages
    const genAiInput = this.getStringAttribute(span, "gen_ai.input.messages");
    if (genAiInput) {
      const text = this.textFromMessages(genAiInput);
      if (text) return text;
    }

    return null;
  }

  /**
   * Extracts text from output attributes for tokenization.
   *
   * Handles:
   * - langwatch.output as JSON string: { type: "chat_messages", value: [...] }
   * - gen_ai.output.messages as JSON string
   */
  private extractOutputText(span: OtlpSpan): string | null {
    // Try langwatch.output first
    const langwatchOutput = this.getStringAttribute(span, "langwatch.output");
    if (langwatchOutput) {
      const text = this.textFromStructuredValue(langwatchOutput);
      if (text) return text;
    }

    // Try gen_ai.output.messages
    const genAiOutput = this.getStringAttribute(span, "gen_ai.output.messages");
    if (genAiOutput) {
      const text = this.textFromMessages(genAiOutput);
      if (text) return text;
    }

    return null;
  }

  private getStringAttribute(span: OtlpSpan, key: string): string | null {
    for (const attr of span.attributes) {
      if (attr.key === key && typeof attr.value.stringValue === "string") {
        return attr.value.stringValue;
      }
    }
    return null;
  }

  /**
   * Extracts text from a LangWatch structured value:
   * { type: "chat_messages", value: [...messages] }
   * or a plain JSON array of messages.
   */
  private textFromStructuredValue(jsonStr: string): string | null {
    try {
      const parsed = JSON.parse(jsonStr);

      // Structured format: { type: "chat_messages", value: [...] }
      if (
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        "value" in parsed
      ) {
        if (parsed.type === "chat_messages" && Array.isArray(parsed.value)) {
          return this.messagesArrayToText(parsed.value);
        }
        // text, json, etc. — stringify the value
        if (typeof parsed.value === "string") return parsed.value;
        return JSON.stringify(parsed.value);
      }

      // Plain array of messages
      if (Array.isArray(parsed)) {
        return this.messagesArrayToText(parsed);
      }

      // Plain string or other primitive
      if (typeof parsed === "string") return parsed;
      return JSON.stringify(parsed);
    } catch {
      // Not valid JSON — use the raw string
      return jsonStr;
    }
  }

  /**
   * Extracts text from a JSON string containing an array of chat messages.
   */
  private textFromMessages(jsonStr: string): string | null {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return this.messagesArrayToText(parsed);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Converts an array of chat messages to a single text string for tokenization.
   */
  private messagesArrayToText(messages: unknown[]): string | null {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg && typeof msg === "object" && "content" in msg) {
        const content = (msg as Record<string, unknown>).content;
        if (typeof content === "string") {
          parts.push(content);
        } else if (content !== null && content !== undefined) {
          parts.push(JSON.stringify(content));
        }
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
}
