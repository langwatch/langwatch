/**
 * GenAI Semantic Conventions Extractor
 *
 * Handles: OpenTelemetry GenAI semantic conventions (gen_ai.* namespace)
 * Reference: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * This extractor canonicalises both modern and legacy gen_ai.* attributes to
 * the current OTel semantic conventions. Legacy attributes are handled here
 * (rather than legacyOtel.ts) to keep all gen_ai namespace handling together.
 *
 * Detection: Presence of gen_ai.* or llm.* attributes
 *
 * Canonical attributes produced:
 * - gen_ai.operation.name (derived from span type)
 * - gen_ai.provider.name (from gen_ai.system)
 * - gen_ai.agent.name (consolidated from multiple sources)
 * - gen_ai.request.model / gen_ai.response.model
 * - gen_ai.input.messages / gen_ai.output.messages
 * - gen_ai.system_instructions
 * - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens
 * - gen_ai.request.* params (temperature, max_tokens, etc.)
 *
 * Legacy attributes consumed:
 * - gen_ai.prompt → gen_ai.input.messages
 * - gen_ai.completion → gen_ai.output.messages
 * - gen_ai.system → gen_ai.provider.name
 * - gen_ai.agent → gen_ai.agent.name
 * - llm.model_name → gen_ai.request.model
 * - llm.input_messages → gen_ai.input.messages
 * - llm.output_messages → gen_ai.output.messages
 * - llm.invocation_parameters → gen_ai.request.* params
 * - gen_ai.usage.prompt_tokens → gen_ai.usage.input_tokens
 * - gen_ai.usage.completion_tokens → gen_ai.usage.output_tokens
 */

import type { AttributeBag } from "../attributeBag";
import { ATTR_KEYS } from "./_constants";
import {
  coerceStringNumberAttrs,
  extractInputMessages,
  extractModelToBoth,
  extractOutputMessages,
  extractUsageTokens,
  recordValueType,
  spanTypeToGenAiOperationName,
} from "./_extraction";
import { asNumber, coerceToStringArray, isRecord } from "./_guards";
import {
  extractSystemInstructionFromMessages,
  stripSystemMessages,
} from "./_messages";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const asNumberFromAttr = (attrs: AttributeBag, key: string): number | null => {
  const raw = attrs.get(key);
  if (raw === undefined || raw === null || raw === "") return null;
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

const asStringFromAttr = (attrs: AttributeBag, key: string): string | null => {
  const raw = attrs.get(key);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

const asJsonStringFromAttr = (
  attrs: AttributeBag,
  key: string,
): string | null => {
  const raw = attrs.get(key);
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return null;
    }
  }
  return null;
};

// Array of content blocks: [{ type: "text", content: "..." }]
const textPartsFromSystemInstructionBlocks = (blocks: unknown[]): string[] => {
  const textParts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      textParts.push(block);
    } else if (isRecord(block)) {
      const obj = block as Record<string, unknown>;
      const text = obj.content ?? obj.text;
      if (typeof text === "string") {
        textParts.push(text);
      }
    }
  }
  return textParts;
};

export class GenAIExtractor implements CanonicalAttributesExtractor {
  readonly id = "genai";

  // ─────────────────────────────────────────────────────────────────────────
  // Operation Name (derived from span type)
  // ─────────────────────────────────────────────────────────────────────────
  private setOperationName(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    if (attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME)) return;
    const spanType =
      attrs.get(ATTR_KEYS.SPAN_TYPE) ?? attrs.get(ATTR_KEYS.TYPE);
    const operationName = spanTypeToGenAiOperationName(spanType);
    if (operationName) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OPERATION_NAME, operationName);
      ctx.recordRule(`${this.id}:operation.name`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Name (from legacy gen_ai.system)
  // ─────────────────────────────────────────────────────────────────────────
  private setProviderName(ctx: ExtractorContext): void {
    const system = ctx.bag.attrs.take(ATTR_KEYS.GEN_AI_SYSTEM);
    if (
      system !== undefined &&
      typeof system === "string" &&
      system.length > 0
    ) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_PROVIDER_NAME, system);
      ctx.recordRule(`${this.id}:provider.name`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Agent Name (consolidated from multiple legacy sources)
  // Priority: gen_ai.agent.name > gen_ai.agent > agent.name
  // ─────────────────────────────────────────────────────────────────────────
  private setAgentName(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const agentName =
      attrs.take(ATTR_KEYS.GEN_AI_AGENT_NAME) ??
      attrs.take(ATTR_KEYS.GEN_AI_AGENT) ??
      attrs.take(ATTR_KEYS.AGENT_NAME);
    if (
      agentName !== undefined &&
      typeof agentName === "string" &&
      agentName.length > 0
    ) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_AGENT_NAME, agentName);
      ctx.recordRule(`${this.id}:agent.name`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Messages
  // Sources (in priority order):
  // - gen_ai.prompt (legacy)
  // - llm.input_messages (legacy OTel)
  // Note: langwatch.input is handled by the LangWatch extractor which
  // directly produces gen_ai.input.messages when structured format is detected
  // ─────────────────────────────────────────────────────────────────────────
  private extractInputMessagesStep(ctx: ExtractorContext): boolean {
    const inputExtracted = extractInputMessages(
      ctx,
      [
        {
          type: "attr",
          keys: [ATTR_KEYS.GEN_AI_PROMPT, ATTR_KEYS.LLM_INPUT_MESSAGES],
        },
      ],
      `${this.id}:input.messages`,
    );

    if (inputExtracted) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }
    return inputExtracted;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // System Instructions (from explicit gen_ai.system_instructions attribute)
  // OTel GenAI semconv v1.38.0: gen_ai.system_instructions
  // Supports both string and array-of-content-blocks formats:
  //   string: "You are a helpful assistant."
  //   array:  [{ type: "text", content: "You are a helpful assistant." }]
  // ─────────────────────────────────────────────────────────────────────────
  private setSystemInstructions(ctx: ExtractorContext): void {
    const rawSystemInstructions = ctx.bag.attrs.take(
      ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS,
    );
    if (rawSystemInstructions === undefined) return;

    if (typeof rawSystemInstructions === "string") {
      ctx.setAttr(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, rawSystemInstructions);
      ctx.recordRule(`${this.id}:system_instructions(string)`);
      return;
    }

    if (Array.isArray(rawSystemInstructions)) {
      const textParts = textPartsFromSystemInstructionBlocks(
        rawSystemInstructions,
      );
      if (textParts.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, textParts.join("\n"));
        ctx.recordRule(`${this.id}:system_instructions(array)`);
      }
    }
  }

  // If gen_ai.input.messages was already present (e.g. from OpenClaw/OTEL
  // GenAI spec), extractInputMessages skips it. Still extract system
  // instruction from the existing messages if not already set.
  private deriveSystemInstructionFromExisting(
    ctx: ExtractorContext,
    inputExtracted: boolean,
  ): void {
    if (
      inputExtracted ||
      ctx.out[ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS] !== undefined
    ) {
      return;
    }
    const { attrs } = ctx.bag;
    const existing = attrs.get(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
    if (!Array.isArray(existing)) return;

    const sysInstruction = extractSystemInstructionFromMessages(existing);
    if (sysInstruction !== null) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
      // Strip system messages and re-set
      const stripped = stripSystemMessages(existing);
      attrs.take(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
      if (stripped.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, stripped);
      }
      ctx.recordRule(`${this.id}:system_instruction(existing)`);
    }
    // Annotate existing messages as chat_messages type (only if messages remain)
    if (
      ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !== undefined ||
      attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)
    ) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Output Messages
  // Sources (in priority order):
  // - gen_ai.completion (legacy)
  // - llm.output_messages (legacy OTel)
  // Note: langwatch.output is handled by the LangWatch extractor which
  // directly produces gen_ai.output.messages when structured format is detected
  // ─────────────────────────────────────────────────────────────────────────
  private extractOutputMessagesStep(ctx: ExtractorContext): void {
    const outputExtracted = extractOutputMessages(
      ctx,
      [
        {
          type: "attr",
          keys: [ATTR_KEYS.GEN_AI_COMPLETION, ATTR_KEYS.LLM_OUTPUT_MESSAGES],
        },
      ],
      `${this.id}:output.messages`,
    );

    if (outputExtracted) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Request Parameters (from legacy llm.invocation_parameters)
  // Extracts model parameters like temperature, max_tokens, etc.
  // ─────────────────────────────────────────────────────────────────────────
  private applyInvocationParams(ctx: ExtractorContext): void {
    const invocationParams = ctx.bag.attrs.get(
      ATTR_KEYS.LLM_INVOCATION_PARAMETERS,
    );
    if (!isRecord(invocationParams)) return;
    const params = invocationParams as Record<string, unknown>;

    const temperature = asNumber(params.temperature);
    const maxTokens = asNumber(params.max_tokens);
    const topP = asNumber(params.top_p);
    const frequencyPenalty = asNumber(params.frequency_penalty);
    const presencePenalty = asNumber(params.presence_penalty);
    const seed = asNumber(params.seed);
    const choiceCount = asNumber(params.n);
    const errorType = params.error_type;

    const numericParams: Array<[number | null, string]> = [
      [temperature, ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE],
      [maxTokens, ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS],
      [topP, ATTR_KEYS.GEN_AI_REQUEST_TOP_P],
      [frequencyPenalty, ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY],
      [presencePenalty, ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY],
      [seed, ATTR_KEYS.GEN_AI_REQUEST_SEED],
    ];
    for (const [value, key] of numericParams) {
      if (value !== null) ctx.setAttr(key, value);
    }
    if (typeof errorType === "string") {
      ctx.setAttr(ATTR_KEYS.ERROR_TYPE, errorType);
    }

    const stopSequences = coerceToStringArray(params.stop);
    if (stopSequences) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
    }

    // Only set choice count if explicitly different from default (1)
    if (choiceCount !== null && choiceCount !== 1) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_CHOICE_COUNT, choiceCount);
    }

    ctx.recordRule(`${this.id}:params`);
    ctx.bag.attrs.delete(ATTR_KEYS.LLM_INVOCATION_PARAMETERS);
  }

  apply(ctx: ExtractorContext): void {
    this.setOperationName(ctx);
    this.setProviderName(ctx);
    this.setAgentName(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Model (from legacy llm.model_name if gen_ai.*.model not present)
    // ─────────────────────────────────────────────────────────────────────────
    extractModelToBoth({
      ctx,
      sourceKey: ATTR_KEYS.LLM_MODEL_NAME,
      transform: (raw) => (typeof raw === "string" ? raw : null),
      ruleId: `${this.id}:model(llm.model_name)`,
    });

    const inputExtracted = this.extractInputMessagesStep(ctx);
    this.setSystemInstructions(ctx);
    this.deriveSystemInstructionFromExisting(ctx, inputExtracted);
    this.extractOutputMessagesStep(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Usage Tokens
    // Supports both modern (input_tokens/output_tokens) and legacy
    // (prompt_tokens/completion_tokens) naming conventions
    // ─────────────────────────────────────────────────────────────────────────
    extractUsageTokens(
      ctx,
      {
        input: [
          ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
          ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS,
        ],
        output: [
          ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
          ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS,
        ],
      },
      `${this.id}:usage`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Extended Usage Tokens
    // Coerce string→number for reasoning tokens and cache tokens
    // (Mastra sends these as strings, e.g. "720")
    // ─────────────────────────────────────────────────────────────────────────
    coerceStringNumberAttrs(ctx, this.id, [
      ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
      ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // Request Parameter Coercion
    // Coerce string→number for request parameters that arrive as strings
    // (e.g. Mastra sends temperature as "1" instead of 1)
    // ─────────────────────────────────────────────────────────────────────────
    coerceStringNumberAttrs(ctx, this.id, [
      ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE,
      ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS,
      ATTR_KEYS.GEN_AI_REQUEST_TOP_P,
      ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY,
      ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY,
      ATTR_KEYS.GEN_AI_REQUEST_SEED,
    ]);

    this.applyInvocationParams(ctx);
  }

  /**
   * Defensive lift of gen_ai.* canonical attributes on log records
   * (gemini CLI 0.32+, any @opentelemetry/semantic-conventions-genai
   * emitter, custom in-house emitters). Gated on field PRESENCE
   * rather than scope/event.name so it benefits every caller that
   * emits OTel GenAI semconv on logs.
   *
   * Replaces the bespoke extractGenAiLogMetrics that lived in
   * trace-io-accumulation.service.ts. The lifted keys mirror that
   * function exactly — model + tokens + cache_read + thread.id +
   * input/output messages — so the fold projection swap is
   * behaviour-preserving.
   *
   * cacheReadTokens reads gen_ai.usage.cache_read_tokens (OTel
   * semconv) first, then falls back to cached_content_token_count
   * (vertex-style emitter). Both are first-class on the wire.
   */
  applyLog(ctx: LogExtractorContext): void {
    const { attrs } = ctx.bag;

    const model = asStringFromAttr(attrs, ATTR_KEYS.GEN_AI_REQUEST_MODEL);
    const inputTokens = asNumberFromAttr(
      attrs,
      ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
    );
    const outputTokens = asNumberFromAttr(
      attrs,
      ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
    );
    const cacheReadTokens =
      asNumberFromAttr(attrs, "gen_ai.usage.cache_read_tokens") ??
      asNumberFromAttr(attrs, "cached_content_token_count");
    const threadId = asStringFromAttr(attrs, ATTR_KEYS.GEN_AI_CONVERSATION_ID);
    const inputMessages = asJsonStringFromAttr(
      attrs,
      ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
    );
    const outputMessages = asJsonStringFromAttr(
      attrs,
      ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
    );

    let fired = false;
    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }
    if (inputTokens !== null) {
      ctx.setAttr("langwatch.input_tokens", String(inputTokens));
      fired = true;
    }
    if (outputTokens !== null) {
      ctx.setAttr("langwatch.output_tokens", String(outputTokens));
      fired = true;
    }
    if (cacheReadTokens !== null) {
      ctx.setAttr("langwatch.cache_read_tokens", String(cacheReadTokens));
      fired = true;
    }
    if (threadId !== null) {
      ctx.setAttr("langwatch.thread.id", threadId);
      fired = true;
    }
    if (inputMessages !== null) {
      ctx.setAttr("langwatch.input", inputMessages);
      fired = true;
    }
    if (outputMessages !== null) {
      ctx.setAttr("langwatch.output", outputMessages);
      fired = true;
    }
    if (fired) ctx.recordRule(`${this.id}:log`);
  }
}
