import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import type { TraceTokenCounterPort } from "../ports/trace-token-counter.port";
import { SpanModelNameService } from "./span-model-name.service";

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
  input: ["gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens"],
  output: ["gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens"],
} as const;

const GLOBAL_KILL_SWITCH_KEY = "token-estimation-killswitch";
const PROJECT_KILL_SWITCH_KEY = "token-estimation-project-killswitch";

/**
 * Dependencies for OtlpSpanTokenEstimationService that can be injected for testing.
 */
export interface OtlpSpanTokenEstimationServiceDependencies {
  tokenizer: TraceTokenCounterPort;
  featureFlags: FeatureFlagService;
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
 *
 * Kill switches:
 * - `token-estimation-killswitch`: disables globally when enabled
 * - `token-estimation-project-killswitch`: disables per-project when enabled
 */
export class OtlpSpanTokenEstimationService {
  /**
   * The application constructs this with `new`; `service-classes` requires a
   * strict feature package to expose construction through a static factory and
   * `service-quality` requires the constructor to be private once it has one.
   * Both graphs still build the same object from the same two dependencies.
   */
  static create(deps: OtlpSpanTokenEstimationServiceDependencies): OtlpSpanTokenEstimationService {
    return new OtlpSpanTokenEstimationService(deps, SpanModelNameService.create());
  }

  private readonly deps: OtlpSpanTokenEstimationServiceDependencies;

  private constructor(
    deps: OtlpSpanTokenEstimationServiceDependencies,
    private readonly modelNames: SpanModelNameService,
  ) {
    this.deps = deps;
  }

  /**
   * Estimates token counts for the span if it's an LLM span with input/output
   * but missing token counts. Mutates the span in place (pushes new attributes).
   *
   * @param tenantId - Project ID used for per-project kill switch evaluation
   */
  async estimateSpanTokens({
    span,
    tenantId,
  }: {
    span: OtlpSpan;
    tenantId?: string;
  }): Promise<void> {
    if (await this.isDisabledByKillSwitch({ tenantId })) {
      return;
    }

    if (!this.isLlmSpan(span)) {
      return;
    }

    const model = this.modelNames.tryExtractModelName(span, MODEL_ATTRIBUTE_KEYS);
    if (!model) {
      return;
    }

    const hasInputTokens = this.hasTokenCountAttribute({
      span,
      direction: "input",
    });
    const hasOutputTokens = this.hasTokenCountAttribute({
      span,
      direction: "output",
    });

    // If both token counts are already present, nothing to estimate
    if (hasInputTokens && hasOutputTokens) {
      return;
    }

    const pendingAttributes: OtlpSpan["attributes"] = [];
    let estimated = false;

    if (!hasInputTokens) {
      const inputText = this.extractInputText(span);
      if (inputText) {
        const inputTokens = await this.deps.tokenizer.tryCountTokens(model, inputText);
        if (inputTokens !== undefined) {
          pendingAttributes.push({
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
        const outputTokens = await this.deps.tokenizer.tryCountTokens(model, outputText);
        if (outputTokens !== undefined) {
          pendingAttributes.push({
            key: "gen_ai.usage.output_tokens",
            value: { intValue: outputTokens },
          });
          estimated = true;
        }
      }
    }

    if (estimated) {
      pendingAttributes.push({
        key: "langwatch.tokens.estimated",
        value: { boolValue: true },
      });
    }

    // Atomic: push all attributes at once so the span is never partially mutated
    if (pendingAttributes.length > 0) {
      span.attributes.push(...pendingAttributes);
    }
  }

  private async isDisabledByKillSwitch({ tenantId }: { tenantId?: string }): Promise<boolean> {
    // Global kill switch — disables for all projects.
    const globalDisabled = await this.deps.featureFlags.isEnabled(GLOBAL_KILL_SWITCH_KEY, {
      kind: "system",
    });
    if (globalDisabled) {
      return true;
    }

    // Per-project kill switch
    if (tenantId) {
      const projectDisabled = await this.deps.featureFlags.isEnabled(PROJECT_KILL_SWITCH_KEY, {
        kind: "project",
        projectId: tenantId,
      });
      if (projectDisabled) {
        return true;
      }
    }

    return false;
  }

  private isLlmSpan(span: OtlpSpan): boolean {
    for (const attr of span.attributes) {
      if (attr.key === "langwatch.span.type") {
        return attr.value.stringValue === "llm";
      }
    }

    return false;
  }

  private hasTokenCountAttribute({
    span,
    direction,
  }: {
    span: OtlpSpan;
    direction: "input" | "output";
  }): boolean {
    const keys = TOKEN_COUNT_KEYS[direction];
    for (const attr of span.attributes) {
      if ((keys as readonly string[]).includes(attr.key)) {
        const val = attr.value.intValue ?? attr.value.doubleValue;
        if (val !== undefined && val !== null) {
          return true;
        }
      }
    }

    return false;
  }

  private extractInputText(span: OtlpSpan): string | null {
    const langwatchInput = this.getStringAttribute({
      span,
      key: "langwatch.input",
    });
    if (langwatchInput) {
      const text = this.textFromStructuredValue(langwatchInput);
      if (text) {
        return text;
      }
    }

    const genAiInput = this.getStringAttribute({
      span,
      key: "gen_ai.input.messages",
    });
    if (genAiInput) {
      const text = this.textFromMessages(genAiInput);
      if (text) {
        return text;
      }
    }

    return null;
  }

  private extractOutputText(span: OtlpSpan): string | null {
    const langwatchOutput = this.getStringAttribute({
      span,
      key: "langwatch.output",
    });
    if (langwatchOutput) {
      const text = this.textFromStructuredValue(langwatchOutput);
      if (text) {
        return text;
      }
    }

    const genAiOutput = this.getStringAttribute({
      span,
      key: "gen_ai.output.messages",
    });
    if (genAiOutput) {
      const text = this.textFromMessages(genAiOutput);
      if (text) {
        return text;
      }
    }

    return null;
  }

  private getStringAttribute({ span, key }: { span: OtlpSpan; key: string }): string | null {
    for (const attr of span.attributes) {
      if (attr.key === key && typeof attr.value.stringValue === "string") {
        return attr.value.stringValue;
      }
    }

    return null;
  }

  private textFromStructuredValue(jsonStr: string): string | null {
    try {
      const parsed = JSON.parse(jsonStr);

      if (parsed && typeof parsed === "object" && "type" in parsed && "value" in parsed) {
        if (parsed.type === "chat_messages" && Array.isArray(parsed.value)) {
          return this.messagesArrayToText(parsed.value);
        }

        if (typeof parsed.value === "string") {
          return parsed.value;
        }

        return JSON.stringify(parsed.value);
      }

      if (Array.isArray(parsed)) {
        return this.messagesArrayToText(parsed);
      }

      if (typeof parsed === "string") {
        return parsed;
      }

      return JSON.stringify(parsed);
    } catch {
      return jsonStr;
    }
  }

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

    return parts.length > 0 ? parts.join("\n") : null;
  }
}
