import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import {
  extractSystemInstructionFromMessages,
  normalizeToMessages,
  stripSystemMessages,
} from "./canonical-message.service";
import {
  isLangWatchStructuredValue,
  safeStringify,
  stripTrailingAssistantMessages,
} from "./langwatch-structured-value.service";

const LANGWATCH_RULE_PREFIX = "langwatch";

export function canonicaliseLangWatchValues(ctx: ExtractorContext): void {
  const reservedTypes: string[] = [];
  canonicaliseInput(ctx, reservedTypes);
  canonicaliseOutput(ctx, reservedTypes);

  if (reservedTypes.length > 0) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES, reservedTypes);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:reserved.value_types`);
  }
}

function canonicaliseInput(ctx: ExtractorContext, reservedTypes: string[]): void {
  const { attrs } = ctx.bag;
  const rawInput = attrs.take(ATTR_KEYS.LANGWATCH_INPUT);
  if (rawInput !== void 0) {
    if (isLangWatchStructuredValue(rawInput)) {
      reservedTypes.push(`${ATTR_KEYS.LANGWATCH_INPUT}=${rawInput.type}`);

      if (rawInput.type === "chat_messages" && Array.isArray(rawInput.value)) {
        const cleanedValue = stripTrailingAssistantMessages(rawInput.value);
        const messages = normalizeToMessages(cleanedValue, "user");

        if (messages) {
          const systemInstruction = extractSystemInstructionFromMessages(messages);
          if (systemInstruction !== null) {
            ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstruction);
          }

          const chatMsgs = systemInstruction ? stripSystemMessages(messages) : messages;
          if (chatMsgs.length > 0) {
            ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMsgs);
          }
          ctx.recordRule(
            `${LANGWATCH_RULE_PREFIX}:input.chat_messages->gen_ai.input.messages`,
          );
        }

        ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, {
          ...rawInput,
          value: cleanedValue,
        });
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:input`);
      } else {
        ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, rawInput.value);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:input`);
      }
    } else {
      const normalizedInput =
        Array.isArray(rawInput) && rawInput.length === 1 ? rawInput[0] : rawInput;
      ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, normalizedInput);
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:input`);
    }
  }
}

function canonicaliseOutput(ctx: ExtractorContext, reservedTypes: string[]): void {
  const { attrs } = ctx.bag;
  const rawOutput = attrs.take(ATTR_KEYS.LANGWATCH_OUTPUT);
  if (rawOutput !== void 0) {
    if (isLangWatchStructuredValue(rawOutput)) {
      reservedTypes.push(`${ATTR_KEYS.LANGWATCH_OUTPUT}=${rawOutput.type}`);

      if (rawOutput.type === "chat_messages" && Array.isArray(rawOutput.value)) {
        const messages = normalizeToMessages(rawOutput.value, "assistant");

        if (messages && messages.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
          ctx.recordRule(
            `${LANGWATCH_RULE_PREFIX}:output.chat_messages->gen_ai.output.messages`,
          );
        }

        ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
      } else if (rawOutput.type === "json" && Array.isArray(rawOutput.value)) {
        const content = rawOutput.value
          .map((item) => (typeof item === "string" ? item : safeStringify(item)))
          .join("\n");

        const messages = normalizeToMessages(content, "assistant");
        if (messages && messages.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
          ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output.json->gen_ai.output.messages`);
        }

        ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
      } else {
        ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
      }
    } else {
      const normalizedOutput =
        Array.isArray(rawOutput) && rawOutput.length === 1 ? rawOutput[0] : rawOutput;
      ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, normalizedOutput);
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
    }
  }
}
