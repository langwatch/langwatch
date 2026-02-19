/**
 * Extractor Helper Functions
 *
 * This module provides shared utility functions used by multiple extractors
 * for common operations like:
 * - Type guards and value coercion
 * - JSON parsing and message normalization
 * - Input/output message extraction
 * - Model and token usage extraction
 * - Span type inference
 *
 * These helpers reduce code duplication and ensure consistent behavior
 * across all extractors.
 */

import type { NormalizedEvent } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "./_constants";
import type { ExtractorContext } from "./_types";

// ═══════════════════════════════════════════════════════════════════════════════
// Type Guards & Basic Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type guard for plain objects (non-null, non-array objects).
 */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Type guard for message-like objects.
 */
export interface MessageLike {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export const isMessageLike = (v: unknown): v is MessageLike =>
  isRecord(v) &&
  (typeof (v as MessageLike).role === "string" ||
    (v as MessageLike).role === undefined);

export const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const safeJsonParse = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (s.length < 2) return v;

  const looksJson =
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"));

  if (!looksJson) return v;

  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
};

export const coerceToStringArray = (v: unknown): string[] | null => {
  if (v == null) return null;
  const xs = Array.isArray(v) ? v : [v];
  const out = xs.map(String).filter((s) => s.length > 0);
  return out.length ? out : null;
};

/**
 * Extracts text from a content block, handling both standard ({type:"text", text:"..."})
 * and pi-ai/Vercel AI SDK style ({type:"text", content:"..."}).
 */
const textFromBlock = (p: unknown): string | null => {
  if (!isRecord(p)) return null;
  const rec = p as Record<string, unknown>;
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.content === "string") return rec.content;
  return null;
};

/**
 * Gets the content array from a message, checking both `content` and `parts`
 * (Vercel AI SDK / pi-ai use `parts` instead of `content`).
 */
const getMessageContentOrParts = (msg: MessageLike): unknown =>
  msg.content ?? (msg as Record<string, unknown>).parts;

export const extractSystemInstructionFromMessages = (
  messages: unknown,
): string | null => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const first = messages[0];
  if (!isMessageLike(first) || first.role !== "system") {
    return null;
  }

  const content = getMessageContentOrParts(first);
  if (content == null) {
    return null;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const texts = content
      .map(textFromBlock)
      .filter((p): p is string => p !== null);

    const extracted = texts.join("");
    return extracted.length > 0 ? extracted : null;
  }

  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Model & Provider Helpers
// ═══════════════════════════════════════════════════════════════════════════════

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

export const spanTypeToGenAiOperationName = (t: unknown): string | null => {
  switch (t) {
    case "llm":
      return "chat";
    case "tool":
      return "tool";
    case "agent":
      return "agent";
    case "rag":
      return "retrieval";
    default:
      return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Message Normalization & Extraction
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Best-effort "messages" decoding from unknown payloads:
 * - array => assume messages
 * - { messages: [...] } => messages
 * - string => raw prompt/completion
 */
export const decodeMessagesPayload = (payload: unknown): unknown => {
  if (Array.isArray(payload)) return payload;
  if (
    isRecord(payload) &&
    Array.isArray((payload as Record<string, unknown>).messages)
  ) {
    return (payload as Record<string, unknown>).messages;
  }
  return payload;
};

/**
 * Unwraps messages that are wrapped in an extra `{ message: {...} }` object.
 * Some telemetry formats wrap each message in an additional "message" property.
 *
 * Example:
 *   Input:  [{ message: { role: "user", content: "hello" } }]
 *   Output: [{ role: "user", content: "hello" }]
 *
 * @param messages - Array of potentially wrapped messages
 * @returns Array with unwrapped messages
 */
export const unwrapWrappedMessages = (messages: unknown[]): unknown[] => {
  return messages.map((msg) => {
    if (
      isRecord(msg) &&
      isRecord((msg as Record<string, unknown>).message) &&
      // Ensure the wrapper only has "message" key (avoid false positives)
      Object.keys(msg).length === 1
    ) {
      return (msg as Record<string, unknown>).message;
    }
    return msg;
  });
};

/**
 * Normalizes various input formats to a messages array.
 * Also handles wrapped messages (e.g., `[{ message: { role: "user", ... } }]`).
 *
 * @param raw - The raw input (string, array, or object)
 * @param defaultRole - Default role to use when converting string to message
 * @returns Normalized messages array or null if conversion failed
 */
export const normalizeToMessages = (
  raw: unknown,
  defaultRole: "user" | "assistant" = "user",
): unknown[] | null => {
  if (typeof raw === "string") {
    return [{ role: defaultRole, content: raw }];
  }
  if (Array.isArray(raw)) {
    // Unwrap messages that are wrapped in { message: {...} }
    return unwrapWrappedMessages(raw);
  }
  if (
    isRecord(raw) &&
    Array.isArray((raw as Record<string, unknown>).messages)
  ) {
    return unwrapWrappedMessages(
      (raw as Record<string, unknown>).messages as unknown[],
    );
  }
  // Fallback: wrap in message object
  return [{ role: defaultRole, content: raw }];
};

/**
 * Message source configuration for extraction helpers.
 */
export type MessageSource =
  | { type: "attr"; keys: readonly string[] }
  | {
      type: "event";
      name: string;
      extractor: (ev: NormalizedEvent) => unknown;
    };

/**
 * Extracts input messages from various sources and sets them in the context.
 *
 * @param ctx - The extractor context
 * @param sources - Array of message sources to try (in order)
 * @param ruleId - Rule ID to record when extraction succeeds
 * @returns true if messages were extracted, false otherwise
 */
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
          const parsed = safeJsonParse(raw);
          const decoded = decodeMessagesPayload(parsed);
          const msgs = normalizeToMessages(decoded, "user");
          if (msgs) {
            const systemInstruction =
              extractSystemInstructionFromMessages(msgs);
            ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, msgs);
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

/**
 * Extracts output messages from various sources and sets them in the context.
 *
 * @param ctx - The extractor context
 * @param sources - Array of message sources to try (in order)
 * @param ruleId - Rule ID to record when extraction succeeds
 * @returns true if messages were extracted, false otherwise
 */
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
          const parsed = safeJsonParse(raw);
          const decoded = decodeMessagesPayload(parsed);
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

/**
 * Infers and sets span type if it's not already set.
 *
 * @param ctx - The extractor context
 * @param type - The span type to set
 * @param ruleId - Rule ID to record when type is set
 */
export const inferSpanTypeIfAbsent = (
  ctx: ExtractorContext,
  type: string,
  ruleId: string,
): void => {
  if (!ctx.bag.attrs.has(ATTR_KEYS.SPAN_TYPE) && ALLOWED_SPAN_TYPES.has(type)) {
    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, type);
    ctx.recordRule(ruleId);
  }
};

/**
 * Extracts model from a source key and sets both request and response model attributes.
 *
 * @param ctx - The extractor context
 * @param sourceKey - The attribute key to extract from
 * @param transform - Optional transform function to apply to the raw value
 * @param ruleId - Rule ID to record when model is extracted
 * @returns true if model was extracted, false otherwise
 */
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

/**
 * Usage token sources configuration.
 */
export type UsageTokenSources =
  | {
      input?: readonly string[];
      output?: readonly string[];
    }
  | {
      object: string;
    };

/**
 * Extracts usage tokens from various sources and sets them in the context.
 *
 * @param ctx - The extractor context
 * @param sources - Token source configuration
 * @param ruleId - Rule ID to record when tokens are extracted
 */
export const extractUsageTokens = (
  ctx: ExtractorContext,
  sources: UsageTokenSources,
  ruleId: string,
): void => {
  let inTok: number | null = null;
  let outTok: number | null = null;

  if ("object" in sources) {
    const usageObj = safeJsonParse(ctx.bag.attrs.take(sources.object));
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

  if (inTok !== null) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, inTok);
  }
  if (outTok !== null) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, outTok);
  }
  if (inTok !== null || outTok !== null) {
    ctx.recordRule(ruleId);
  }
};
