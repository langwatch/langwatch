import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port.ts";
import { recordValueType } from "./canonical-extraction.rules.ts";
import { isNonEmptyString, isRecord } from "./canonical-guard.rules.ts";
import { extractSystemInstructionFromMessages } from "./canonical-message.rules.ts";

const VERCEL_RULE_PREFIX = "vercel";

export function canonicaliseVercelIO(ctx: ExtractorContext): void {
  canonicaliseInput(ctx);
  canonicaliseOutput(ctx);
}

function canonicaliseInput(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  if (!attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
    const prompt = attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES) ?? attrs.take(ATTR_KEYS.AI_PROMPT);

    if (typeof prompt === "string") {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [{ role: "user", content: prompt }]);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.prompt(string)->gen_ai.input.messages`);
    } else if (isRecord(prompt)) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, prompt);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.prompt.messages{}->gen_ai.input.messages`);
    } else if (Array.isArray(prompt)) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, prompt);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.prompt.messages[]->gen_ai.input.messages`);
    } else if (prompt !== void 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [{ role: "user", content: prompt }]);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.prompt(unknown)->gen_ai.input.messages`);
    }

    if (ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !== void 0) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");

      const inputMsgs = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES];
      if (Array.isArray(inputMsgs)) {
        const sysInstruction = extractSystemInstructionFromMessages(inputMsgs);
        if (sysInstruction !== null) {
          ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
        }
      }
    }
  } else {
    attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES);
    attrs.take(ATTR_KEYS.AI_PROMPT);
  }
}

function canonicaliseOutput(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  if (!attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES)) {
    const responseAttr = attrs.take(ATTR_KEYS.AI_RESPONSE);
    const hasUsableResponse = isNonEmptyString(responseAttr) || isRecord(responseAttr);
    const responseTextAttr = !hasUsableResponse ? attrs.take(ATTR_KEYS.AI_RESPONSE_TEXT) : void 0;
    const response = hasUsableResponse ? responseAttr : responseTextAttr;
    const parsedResponseText =
      responseTextAttr !== void 0 &&
      (isRecord(responseTextAttr) || Array.isArray(responseTextAttr));

    if (parsedResponseText) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
        {
          role: "assistant",
          content: JSON.stringify(responseTextAttr),
        },
      ]);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.response.text(parsed)->gen_ai.output.messages`);
    } else if (isRecord(response)) {
      const messages: unknown[] = [];

      if (typeof response.text === "string" && response.text.length > 0) {
        messages.push({ role: "assistant", content: response.text });
      }

      if (messages.length === 0) {
        const obj = response.object;
        const isSerialisable = isRecord(obj) || Array.isArray(obj);
        if (isNonEmptyString(obj)) {
          messages.push({ role: "assistant", content: obj });
        } else if (isSerialisable) {
          messages.push({ role: "assistant", content: JSON.stringify(obj) });
        }
      }

      if (Array.isArray(response.toolCalls)) {
        messages.push({ tool_calls: response.toolCalls });
      }

      if (messages.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
        ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.response->gen_ai.output.messages`);
      }
    } else if (isNonEmptyString(response)) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [{ role: "assistant", content: response }]);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.response(string)->gen_ai.output.messages`);
    }

    if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === void 0) {
      const obj = attrs.take(ATTR_KEYS.AI_RESPONSE_OBJECT);
      const isSerialisableObject = isRecord(obj) || Array.isArray(obj);
      const serialised = isSerialisableObject ? JSON.stringify(obj) : void 0;
      const content = isNonEmptyString(obj) ? obj : serialised;
      if (content !== void 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [{ role: "assistant", content }]);
        ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.response.object->gen_ai.output.messages`);
      }
    }

    if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] !== void 0) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }
  } else {
    attrs.take(ATTR_KEYS.AI_RESPONSE);
  }
}
