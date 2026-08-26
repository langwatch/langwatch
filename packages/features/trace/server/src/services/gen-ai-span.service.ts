import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import {
  coerceStringNumberAttrs,
  extractInputMessages,
  extractModelToBoth,
  extractOutputMessages,
  extractUsageTokens,
  recordValueType,
  spanTypeToGenAiOperationName,
} from "./canonical-extraction.service";
import {
  asBoolean,
  asNumber,
  coerceToStringArray,
  isRecord,
} from "./canonical-guard.service";
import {
  extractSystemInstructionFromMessages,
  stripSystemMessages,
} from "./canonical-message.service";

const GEN_AI_RULE_PREFIX = "genai";

export function canonicaliseGenAISpan(ctx: ExtractorContext): void {
  canonicaliseIdentity(ctx);
  canonicaliseMessages(ctx);
  canonicaliseUsage(ctx);
  canonicaliseRequest(ctx);
}

function canonicaliseIdentity(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  if (!attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME)) {
    const spanType = attrs.get(ATTR_KEYS.SPAN_TYPE) ?? attrs.get(ATTR_KEYS.TYPE);
    const operationName = spanTypeToGenAiOperationName(spanType);
    if (operationName) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OPERATION_NAME, operationName);
      ctx.recordRule(`${GEN_AI_RULE_PREFIX}:operation.name`);
    }
  }

  const system = attrs.take(ATTR_KEYS.GEN_AI_SYSTEM);
  if (system !== void 0 && typeof system === "string" && system.length > 0) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_PROVIDER_NAME, system);
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:provider.name`);
  }

  const agentName =
    attrs.take(ATTR_KEYS.GEN_AI_AGENT_NAME) ??
    attrs.take(ATTR_KEYS.GEN_AI_AGENT) ??
    attrs.take(ATTR_KEYS.AGENT_NAME);
  if (agentName !== void 0 && typeof agentName === "string" && agentName.length > 0) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_AGENT_NAME, agentName);
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:agent.name`);
  }

  extractModelToBoth(
    ctx,
    ATTR_KEYS.LLM_MODEL_NAME,
    (raw) => (typeof raw === "string" ? raw : null),
    `${GEN_AI_RULE_PREFIX}:model(llm.model_name)`,
  );
}

function canonicaliseMessages(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const inputExtracted = extractInputMessages(
    ctx,
    [
      {
        type: "attr",
        keys: [ATTR_KEYS.GEN_AI_PROMPT, ATTR_KEYS.LLM_INPUT_MESSAGES],
      },
    ],
    `${GEN_AI_RULE_PREFIX}:input.messages`,
  );

  if (inputExtracted) {
    recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
  }

  const rawSystemInstructions = attrs.take(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS);
  if (rawSystemInstructions !== void 0) {
    if (typeof rawSystemInstructions === "string") {
      ctx.setAttr(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, rawSystemInstructions);
      ctx.recordRule(`${GEN_AI_RULE_PREFIX}:system_instructions(string)`);
    } else if (Array.isArray(rawSystemInstructions)) {
      const textParts: string[] = [];
      for (const block of rawSystemInstructions) {
        if (typeof block === "string") {
          textParts.push(block);
        } else if (isRecord(block)) {
          const text = block.content ?? block.text;
          if (typeof text === "string") {
            textParts.push(text);
          }
        }
      }
      if (textParts.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, textParts.join("\n"));
        ctx.recordRule(`${GEN_AI_RULE_PREFIX}:system_instructions(array)`);
      }
    }
  }

  if (!inputExtracted && ctx.out[ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS] === void 0) {
    const existing = attrs.get(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
    if (Array.isArray(existing)) {
      const sysInstruction = extractSystemInstructionFromMessages(existing);
      if (sysInstruction !== null) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
        const stripped = stripSystemMessages(existing);
        attrs.take(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
        if (stripped.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, stripped);
        }
        ctx.recordRule(`${GEN_AI_RULE_PREFIX}:system_instruction(existing)`);
      }
      if (
        ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !== void 0 ||
        attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)
      ) {
        recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
      }
    }
  }

  const outputExtracted = extractOutputMessages(
    ctx,
    [
      {
        type: "attr",
        keys: [ATTR_KEYS.GEN_AI_COMPLETION, ATTR_KEYS.LLM_OUTPUT_MESSAGES],
      },
    ],
    `${GEN_AI_RULE_PREFIX}:output.messages`,
  );

  if (outputExtracted) {
    recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
  }
}

function canonicaliseUsage(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  extractUsageTokens(
    ctx,
    {
      input: [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS],
      output: [
        ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS,
      ],
    },
    `${GEN_AI_RULE_PREFIX}:usage`,
  );

  coerceStringNumberAttrs(ctx, GEN_AI_RULE_PREFIX, [
    ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
    ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
    ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
  ]);

  const cachedInputTokens = asNumber(
    attrs.get(ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS),
  );
  if (cachedInputTokens !== null) {
    attrs.delete(ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS);
    ctx.setAttrIfAbsent(
      ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      cachedInputTokens,
    );
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:cached_input_tokens->cache_read.input_tokens`);
  }

  const reasoningOutputTokens = asNumber(
    attrs.get(ATTR_KEYS.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS),
  );
  if (reasoningOutputTokens !== null) {
    attrs.delete(ATTR_KEYS.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS);
    ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, reasoningOutputTokens);
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:usage.reasoning.output_tokens`);
  }

  const timeToFirstChunkSeconds = asNumber(
    attrs.get(ATTR_KEYS.GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK),
  );
  if (
    timeToFirstChunkSeconds !== null &&
    timeToFirstChunkSeconds >= 0 &&
    ctx.out[ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN] === void 0 &&
    !attrs.has(ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN)
  ) {
    attrs.delete(ATTR_KEYS.GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK);
    ctx.setAttr(
      ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN,
      timeToFirstChunkSeconds * 1000,
    );
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:response.time_to_first_chunk`);
  }
}

function canonicaliseRequest(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const stream = asBoolean(attrs.get(ATTR_KEYS.GEN_AI_REQUEST_STREAM));
  if (stream !== null) {
    attrs.delete(ATTR_KEYS.GEN_AI_REQUEST_STREAM);
    ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_STREAM, stream);
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:request.stream`);
  }

  coerceStringNumberAttrs(ctx, GEN_AI_RULE_PREFIX, [
    ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE,
    ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS,
    ATTR_KEYS.GEN_AI_REQUEST_TOP_P,
    ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY,
    ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY,
    ATTR_KEYS.GEN_AI_REQUEST_SEED,
  ]);

  const invocationParams = ctx.bag.attrs.get(ATTR_KEYS.LLM_INVOCATION_PARAMETERS);
  if (isRecord(invocationParams)) {
    const temperature = asNumber(invocationParams.temperature);
    const maxTokens = asNumber(invocationParams.max_tokens);
    const topP = asNumber(invocationParams.top_p);
    const frequencyPenalty = asNumber(invocationParams.frequency_penalty);
    const presencePenalty = asNumber(invocationParams.presence_penalty);
    const seed = asNumber(invocationParams.seed);
    const choiceCount = asNumber(invocationParams.n);
    const errorType = invocationParams.error_type;

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
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequencyPenalty);
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

    const stopSequences = coerceToStringArray(invocationParams.stop);
    if (stopSequences) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
    }

    if (choiceCount !== null && choiceCount !== 1) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_CHOICE_COUNT, choiceCount);
    }

    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:params`);
    ctx.bag.attrs.delete(ATTR_KEYS.LLM_INVOCATION_PARAMETERS);
  }
}
