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
 * - gen_ai.request.system_instruction
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

import { ATTR_KEYS } from "./_constants";
import {
  extractInputMessages,
  extractModelToBoth,
  extractOutputMessages,
  extractUsageTokens,
  recordValueType,
  spanTypeToGenAiOperationName,
} from "./_extraction";
import { asNumber, coerceToStringArray, isRecord } from "./_guards";
import { extractSystemInstructionFromMessages } from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class GenAIExtractor implements CanonicalAttributesExtractor {
  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Operation Name (derived from span type)
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME)) {
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
    const system = attrs.take(ATTR_KEYS.GEN_AI_SYSTEM);
    if (
      system !== undefined &&
      typeof system === "string" &&
      system.length > 0
    ) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_PROVIDER_NAME, system);
      ctx.recordRule(`${this.id}:provider.name`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Agent Name (consolidated from multiple legacy sources)
    // Priority: gen_ai.agent.name > gen_ai.agent > agent.name
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // Model (from legacy llm.model_name if gen_ai.*.model not present)
    // ─────────────────────────────────────────────────────────────────────────
    extractModelToBoth(
      ctx,
      ATTR_KEYS.LLM_MODEL_NAME,
      (raw) => (typeof raw === "string" ? raw : null),
      `${this.id}:model(llm.model_name)`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages
    // Sources (in priority order):
    // - gen_ai.prompt (legacy)
    // - llm.input_messages (legacy OTel)
    // Note: langwatch.input is handled by the LangWatch extractor which
    // directly produces gen_ai.input.messages when structured format is detected
    // ─────────────────────────────────────────────────────────────────────────
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

    // If gen_ai.input.messages was already present (e.g. from OpenClaw/OTEL
    // GenAI spec), extractInputMessages skips it. Still extract system
    // instruction from the existing messages if not already set.
    if (
      !inputExtracted &&
      !attrs.has(ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION)
    ) {
      const existing = attrs.get(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
      if (Array.isArray(existing)) {
        const sysInstruction = extractSystemInstructionFromMessages(existing);
        if (sysInstruction !== null) {
          ctx.setAttr(
            ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
            sysInstruction,
          );
          // Strip system messages and re-set
          const stripped = existing.filter(
            (m) =>
              !(
                m &&
                typeof m === "object" &&
                (m as Record<string, unknown>).role === "system"
              ),
          );
          if (stripped.length > 0) {
            attrs.take(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
            ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, stripped);
          }
          ctx.recordRule(`${this.id}:system_instruction(existing)`);
        }
        // Annotate existing messages as chat_messages type
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
    const extendedTokenKeys = [
      ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
      ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
    ] as const;

    for (const key of extendedTokenKeys) {
      const raw = attrs.get(key);
      if (typeof raw === "string") {
        const n = asNumber(raw);
        if (n !== null) {
          attrs.take(key);
          ctx.setAttr(key, n);
          ctx.recordRule(`${this.id}:coerce(${key})`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Request Parameter Coercion
    // Coerce string→number for request parameters that arrive as strings
    // (e.g. Mastra sends temperature as "1" instead of 1)
    // ─────────────────────────────────────────────────────────────────────────
    const requestParamKeys = [
      ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE,
      ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS,
      ATTR_KEYS.GEN_AI_REQUEST_TOP_P,
      ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY,
      ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY,
      ATTR_KEYS.GEN_AI_REQUEST_SEED,
    ] as const;

    for (const key of requestParamKeys) {
      const raw = attrs.get(key);
      if (typeof raw === "string") {
        const n = asNumber(raw);
        if (n !== null) {
          attrs.take(key);
          ctx.setAttr(key, n);
          ctx.recordRule(`${this.id}:coerce(${key})`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Request Parameters (from legacy llm.invocation_parameters)
    // Extracts model parameters like temperature, max_tokens, etc.
    // ─────────────────────────────────────────────────────────────────────────
    const invocationParams = ctx.bag.attrs.get(
      ATTR_KEYS.LLM_INVOCATION_PARAMETERS,
    );
    if (isRecord(invocationParams)) {
      const params = invocationParams as Record<string, unknown>;

      const temperature = asNumber(params.temperature);
      const maxTokens = asNumber(params.max_tokens);
      const topP = asNumber(params.top_p);
      const frequencyPenalty = asNumber(params.frequency_penalty);
      const presencePenalty = asNumber(params.presence_penalty);
      const seed = asNumber(params.seed);
      const choiceCount = asNumber(params.n);
      const errorType = params.error_type;

      if (temperature !== null) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE, temperature);
      }
      if (maxTokens !== null) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
      }
      if (topP !== null) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_TOP_P, topP);
      }
      if (frequencyPenalty !== null) {
        ctx.setAttr(
          ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY,
          frequencyPenalty,
        );
      }
      if (presencePenalty !== null) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY, presencePenalty);
      }
      if (seed !== null) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_SEED, seed);
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
  }
}
