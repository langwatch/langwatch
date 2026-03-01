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
        const raw = ctx.bag.attrs.take(key);
        if (raw !== undefined) {
          const decoded = decodeMessagesPayload(raw);
          const msgs = normalizeToMessages(decoded, "user");
          if (msgs) {
            const systemInstruction =
              extractSystemInstructionFromMessages(msgs);
            // Strip system messages — they go to gen_ai.request.system_instruction
            const chatMsgs = systemInstruction
              ? msgs.filter(
                  (m) =>
                    !(
                      m &&
                      typeof m === "object" &&
                      (m as Record<string, unknown>).role === "system"
                    ),
                )
              : msgs;
            ctx.setAttr(
              ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
              chatMsgs.length > 0 ? chatMsgs : msgs,
            );
            if (systemInstruction !== null) {
              ctx.setAttrIfAbsent(
                ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
                systemInstruction,
              );
            }
            ctx.recordRule(ruleId);
            return true;
          }
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
        const raw = ctx.bag.attrs.take(key);
        if (raw !== undefined) {
          const decoded = decodeMessagesPayload(raw);
          const msgs = normalizeToMessages(decoded, "assistant");
          if (msgs && msgs.length > 0) {
            ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, msgs);
            ctx.recordRule(ruleId);
            return true;
          }
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

  const raw = ctx.bag.attrs.take(sourceKey);
  if (raw !== undefined) {
    const model = transform(raw);
    if (isNonEmptyString(model)) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model);
      ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model);
      ctx.recordRule(ruleId);
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
    const usageObj = ctx.bag.attrs.take(sources.object);
    if (isRecord(usageObj)) {
      const obj = usageObj as Record<string, unknown>;
      inTok = asNumber(obj.promptTokens);
      outTok = asNumber(obj.completionTokens);
    }
  } else {
    if (sources.input) {
      for (const key of sources.input) {
        const val = ctx.bag.attrs.take(key);
        if (val !== undefined) {
          inTok = asNumber(val);
          if (inTok !== null) break;
        }
      }
    }
    if (sources.output) {
      for (const key of sources.output) {
        const val = ctx.bag.attrs.take(key);
        if (val !== undefined) {
          outTok = asNumber(val);
          if (outTok !== null) break;
        }
      }
    }
  }

  if (inTok !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, inTok);
  if (outTok !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, outTok);
  if (inTok !== null || outTok !== null) ctx.recordRule(ruleId);
};

/**
 * Records a value type annotation for a canonical attribute key.
 * Stored as entries in langwatch.reserved.value_types: ["key=type", ...].
 * Used by downstream mappers to determine the correct SpanInputOutput type.
 */
export const recordValueType = (
  ctx: ExtractorContext,
  attrKey: string,
  type: string,
): void => {
  const existing = ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES];
  const arr: string[] = Array.isArray(existing) ? [...(existing as string[])] : [];
  arr.push(`${attrKey}=${type}`);
  ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES, arr);
};

/**
 * Consolidates error information from various attribute sources into
 * canonical error.type and error.message attributes.
 * Sources: exception.*, error.*, status.message, span.error.*
 */
export const extractErrorInfo = (ctx: ExtractorContext): void => {
  const { attrs } = ctx.bag;

  if (ctx.out[ATTR_KEYS.ERROR_TYPE] !== undefined) return;

  const exceptionType = attrs.get(ATTR_KEYS.EXCEPTION_TYPE);
  const exceptionMsg = attrs.get(ATTR_KEYS.EXCEPTION_MESSAGE);
  const statusMsg = attrs.get(ATTR_KEYS.STATUS_MESSAGE);

  const spanErrorHas =
    attrs.get(ATTR_KEYS.SPAN_ERROR_HAS_ERROR) ??
    attrs.get(ATTR_KEYS.ERROR_HAS_ERROR);
  const spanErrorMsg =
    attrs.get(ATTR_KEYS.SPAN_ERROR_MESSAGE) ??
    attrs.get(ATTR_KEYS.ERROR_MESSAGE);

  // Priority 1: Explicit span error flag with message
  if (
    typeof spanErrorHas === "boolean" &&
    spanErrorHas &&
    isNonEmptyString(spanErrorMsg)
  ) {
    ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_TYPE, spanErrorMsg);
    ctx.recordRule("error:span.error");
    return;
  }

  // Priority 2: Exception type and message
  if (isNonEmptyString(exceptionType) && isNonEmptyString(exceptionMsg)) {
    ctx.setAttrIfAbsent(
      ATTR_KEYS.ERROR_TYPE,
      `${exceptionType}: ${exceptionMsg}`,
    );
    ctx.recordRule("error:exception");
    return;
  }

  // Priority 3: Status message fallback
  if (isNonEmptyString(statusMsg)) {
    ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_TYPE, statusMsg);
    ctx.recordRule("error:status.message");
  }
};

export const spanTypeToGenAiOperationName = (t: unknown): string | null => {
  if (typeof t !== "string") return null;
  return SPAN_TYPE_TO_GEN_AI_OP[t] ?? null;
};

export const ALLOWED_SPAN_TYPES = new Set([
  "span",
  "llm",
  "tool",
  "agent",
  "rag",
  "server",
  "client",
  "producer",
  "consumer",
]);

/**
 * Infers and sets span type if it's not already set.
 * Checks both the bag (raw attributes) and out (set by previous extractors).
 */
export const inferSpanTypeIfAbsent = (
  ctx: ExtractorContext,
  type: string,
  ruleId: string,
): void => {
  if (
    !ctx.bag.attrs.has(ATTR_KEYS.SPAN_TYPE) &&
    ctx.out[ATTR_KEYS.SPAN_TYPE] === undefined &&
    ALLOWED_SPAN_TYPES.has(type)
  ) {
    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, type);
    ctx.recordRule(ruleId);
  }
};

/**
 * Normalizes Vercel AI SDK model object to "provider/model" string.
 * Example: { id: "gpt-4", provider: "openai.chat" } → "openai/gpt-4"
 */
export const normaliseModelFromAiModelObject = (
  aiModel: unknown,
): string | null => {
  if (!isRecord(aiModel)) return null;

  const id = (aiModel as Record<string, unknown>).id;
  if (!isNonEmptyString(id)) return null;

  const providerRaw = (aiModel as Record<string, unknown>).provider;
  const provider =
    typeof providerRaw === "string" && providerRaw.trim() !== ""
      ? providerRaw.split(".")[0]
      : "";

  return [provider, id].filter(Boolean).join("/") || id;
};
