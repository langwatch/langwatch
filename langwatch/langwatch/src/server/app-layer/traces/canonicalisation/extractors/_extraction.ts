/**
 * Shared Extraction Workflows
 */
import type { NormalizedEvent } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS, SPAN_TYPE_TO_GEN_AI_OP } from "./_constants";
import { asNumber, isNonEmptyString, isRecord } from "./_guards";
import {
  decodeMessagesPayload,
  extractSystemInstructionFromMessages,
  normalizeToMessages,
} from "./_messages";
import type { ExtractorContext } from "./_types";

export type MessageSource =
  | { type: "attr"; keys: readonly string[] }
  | {
      type: "event";
      name: string;
      extractor: (ev: NormalizedEvent) => unknown;
    };

export const extractInputMessages = (
  ctx: ExtractorContext,
  sources: MessageSource[],
  ruleId: string,
): boolean => {
  if (
    ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) ||
    ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !== undefined
  ) {
    return false;
  }

  for (const source of sources) {
    if (source.type === "attr") {
      for (const key of source.keys) {
        if (!ctx.bag.attrs.has(key)) continue;
        const parsed = ctx.bag.attrs.getParsed(key);
        const decoded = decodeMessagesPayload(parsed);
        const msgs = normalizeToMessages(decoded, "user");
        if (msgs) {
          const systemInstruction = extractSystemInstructionFromMessages(msgs);
          ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, msgs);
          if (systemInstruction !== null) {
            ctx.setAttrIfAbsent(
              ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
              systemInstruction,
            );
          }
          ctx.recordRule(ruleId);
          ctx.bag.attrs.delete(key);
          return true;
        }
      }
    } else if (source.type === "event") {
      const events = ctx.bag.events.takeAll(source.name);
      if (events.length > 0) {
        const messages: unknown[] = [];
        for (const ev of events) {
          const extracted = source.extractor(ev);
          if (extracted !== undefined) {
            messages.push(extracted);
          }
        }
        if (messages.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, messages);
          ctx.recordRule(ruleId);
          return true;
        }
      }
    }
  }

  return false;
};

export const extractOutputMessages = (
  ctx: ExtractorContext,
  sources: MessageSource[],
  ruleId: string,
): boolean => {
  if (
    ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) ||
    ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] !== undefined
  ) {
    return false;
  }

  for (const source of sources) {
    if (source.type === "attr") {
      for (const key of source.keys) {
        if (!ctx.bag.attrs.has(key)) continue;
        const parsed = ctx.bag.attrs.getParsed(key);
        const decoded = decodeMessagesPayload(parsed);
        const msgs = normalizeToMessages(decoded, "assistant");
        if (msgs && msgs.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, msgs);
          ctx.recordRule(ruleId);
          ctx.bag.attrs.delete(key);
          return true;
        }
      }
    } else if (source.type === "event") {
      const events = ctx.bag.events.takeAll(source.name);
      if (events.length > 0) {
        const messages: unknown[] = [];
        for (const ev of events) {
          const extracted = source.extractor(ev);
          if (extracted !== undefined) {
            messages.push(extracted);
          }
        }
        if (messages.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
          ctx.recordRule(ruleId);
          return true;
        }
      }
    }
  }

  return false;
};

export const extractModelToBoth = (
  ctx: ExtractorContext,
  sourceKey: string,
  transform: (raw: unknown) => string | null = (raw) =>
    typeof raw === "string" ? raw : null,
  ruleId: string,
): boolean => {
  if (
    ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ||
    ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL)
  ) {
    return false;
  }

  const raw = ctx.bag.attrs.get(sourceKey);
  if (raw !== undefined) {
    const model = transform(raw);
    if (isNonEmptyString(model)) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model);
      ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model);
      ctx.recordRule(ruleId);
      ctx.bag.attrs.delete(sourceKey);
      return true;
    }
  }

  return false;
};

export type UsageTokenSources =
  | { input?: readonly string[]; output?: readonly string[] }
  | { object: string };

export const extractUsageTokens = (
  ctx: ExtractorContext,
  sources: UsageTokenSources,
  ruleId: string,
): void => {
  let inTok: number | null = null;
  let outTok: number | null = null;

  if ("object" in sources) {
    const usageObj = ctx.bag.attrs.getParsed(sources.object);
    if (isRecord(usageObj)) {
      const obj = usageObj as Record<string, unknown>;
      inTok = asNumber(obj.promptTokens);
      outTok = asNumber(obj.completionTokens);
      if (inTok !== null || outTok !== null) {
        ctx.bag.attrs.delete(sources.object);
      }
    }
  } else {
    if (sources.input) {
      for (const key of sources.input) {
        const val = ctx.bag.attrs.get(key);
        if (val !== undefined) {
          inTok = asNumber(val);
          if (inTok !== null) {
            ctx.bag.attrs.delete(key);
            break;
          }
        }
      }
    }
    if (sources.output) {
      for (const key of sources.output) {
        const val = ctx.bag.attrs.get(key);
        if (val !== undefined) {
          outTok = asNumber(val);
          if (outTok !== null) {
            ctx.bag.attrs.delete(key);
            break;
          }
        }
      }
    }
  }

  if (inTok !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, inTok);
  if (outTok !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, outTok);
  if (inTok !== null || outTok !== null) ctx.recordRule(ruleId);
};

export const spanTypeToGenAiOperationName = (t: unknown): string | null => {
  if (typeof t !== "string") return null;
  return SPAN_TYPE_TO_GEN_AI_OP[t] ?? null;
};
