import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../services/canonicalisers/canonical-attributes.service.ts";
import {
  extractSystemInstructionFromMessages,
  normalizeToMessages,
  stripSystemMessages,
} from "./canonical-message.rules.ts";
import {
  isLangWatchStructuredValue,
  type LangWatchStructuredValue,
  safeStringify,
  stripTrailingAssistantMessages,
} from "./langwatch-structured-value.rules.ts";

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

/** The gen_ai input messages and system instruction a chat_messages input carries. */
function publishInputChatMessages(
  ctx: ExtractorContext,
  cleanedValue: ReturnType<typeof stripTrailingAssistantMessages>,
): void {
  const messages = normalizeToMessages(cleanedValue, "user");
  if (!messages) return;

  const systemInstruction = extractSystemInstructionFromMessages(messages);
  if (systemInstruction !== null) {
    ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstruction);
  }

  const chatMsgs = systemInstruction ? stripSystemMessages(messages) : messages;
  if (chatMsgs.length > 0) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMsgs);
  }
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:input.chat_messages->gen_ai.input.messages`);
}

function canonicaliseInput(ctx: ExtractorContext, reservedTypes: string[]): void {
  const { attrs } = ctx.bag;
  const rawInput = attrs.take(ATTR_KEYS.LANGWATCH_INPUT);
  if (rawInput !== void 0) {
    if (isLangWatchStructuredValue(rawInput)) {
      reservedTypes.push(`${ATTR_KEYS.LANGWATCH_INPUT}=${rawInput.type}`);

      if (rawInput.type === "chat_messages" && Array.isArray(rawInput.value)) {
        const cleanedValue = stripTrailingAssistantMessages(rawInput.value);
        publishInputChatMessages(ctx, cleanedValue);

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

/** A chat-messages output: the canonical messages, and the raw value kept alongside. */
function setChatMessagesOutput(ctx: ExtractorContext, value: unknown[]): void {
  const messages = normalizeToMessages(value, "assistant");
  if (messages && messages.length > 0) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output.chat_messages->gen_ai.output.messages`);
  }

  ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, value);
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
}

/** A json-array output reads as one assistant turn: its items joined by newline. */
function setJsonArrayOutput(ctx: ExtractorContext, value: unknown[]): void {
  const content = value
    .map((item) => (typeof item === "string" ? item : safeStringify(item)))
    .join("\n");

  const messages = normalizeToMessages(content, "assistant");
  if (messages && messages.length > 0) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output.json->gen_ai.output.messages`);
  }

  ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, value);
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
}

function setStructuredOutput(ctx: ExtractorContext, rawOutput: LangWatchStructuredValue): void {
  if (rawOutput.type === "chat_messages" && Array.isArray(rawOutput.value)) {
    setChatMessagesOutput(ctx, rawOutput.value);
    return;
  }
  if (rawOutput.type === "json" && Array.isArray(rawOutput.value)) {
    setJsonArrayOutput(ctx, rawOutput.value);
    return;
  }

  ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
}

function canonicaliseOutput(ctx: ExtractorContext, reservedTypes: string[]): void {
  const rawOutput = ctx.bag.attrs.take(ATTR_KEYS.LANGWATCH_OUTPUT);
  if (rawOutput === void 0) return;

  if (isLangWatchStructuredValue(rawOutput)) {
    reservedTypes.push(`${ATTR_KEYS.LANGWATCH_OUTPUT}=${rawOutput.type}`);
    setStructuredOutput(ctx, rawOutput);
    return;
  }

  const normalizedOutput =
    Array.isArray(rawOutput) && rawOutput.length === 1 ? rawOutput[0] : rawOutput;
  ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, normalizedOutput);
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:output`);
}
