import { ATTR_KEYS, SPAN_TYPE_TO_GEN_AI_OP } from "./attributeKeys.ts";
import { type ExtractorContext, takeAttribute, takeEvents } from "./canonicalAttributes.ts";
import { asNumber, isNonEmptyString, isRecord } from "./canonicalGuard.ts";
import {
  decodeMessagesPayload,
  extractSystemInstructionFromMessages,
  normalizeToMessages,
  stripLiftedSystemMessage,
} from "./canonicalMessage.ts";
import type { CanonicalEvent } from "./canonicalTypes.ts";

type MessageSource =
  | { type: "attr"; keys: readonly string[] }
  | {
      type: "event";
      name: string;
      extractor: (ev: CanonicalEvent) => unknown;
    };

type ExtractMessagesConfig = {
  attrKey: string;
  defaultRole: "user" | "assistant";
  extractSystemInstructions: boolean;
};

/** Whether one attribute key carried the messages this extraction wanted. */
const extractMessagesFromAttr = ({
  ctx,
  key,
  ruleId,
  config,
}: {
  ctx: ExtractorContext;
  key: string;
  ruleId: string;
  config: ExtractMessagesConfig;
}): boolean => {
  const raw = takeAttribute(ctx.bag.attrs, key);
  if (raw === void 0) return false;

  const msgs = normalizeToMessages(decodeMessagesPayload(raw), config.defaultRole);
  if (!msgs) return false;

  if (config.extractSystemInstructions) {
    const systemInstruction = extractSystemInstructionFromMessages(msgs);
    // Strip system messages — they go to gen_ai.system_instructions
    const chatMsgs = systemInstruction ? stripLiftedSystemMessage(msgs) : msgs;
    if (chatMsgs.length > 0) {
      ctx.setAttr(config.attrKey, chatMsgs);
    }
    if (systemInstruction !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstruction);
    }
    ctx.recordRule(ruleId);

    return true;
  }
  if (msgs.length === 0) return false;

  ctx.setAttr(config.attrKey, msgs);
  ctx.recordRule(ruleId);

  return true;
};

/** Whether one event source carried the messages this extraction wanted. */
const extractMessagesFromEvents = ({
  ctx,
  source,
  ruleId,
  config,
}: {
  ctx: ExtractorContext;
  source: Extract<MessageSource, { type: "event" }>;
  ruleId: string;
  config: ExtractMessagesConfig;
}): boolean => {
  const messages: unknown[] = [];
  for (const ev of takeEvents(ctx.bag.events, source.name)) {
    const extracted = source.extractor(ev);
    if (extracted !== void 0) {
      messages.push(extracted);
    }
  }
  if (messages.length === 0) return false;

  ctx.setAttr(config.attrKey, messages);
  ctx.recordRule(ruleId);

  return true;
};

const extractMessages = ({
  ctx,
  sources,
  ruleId,
  config,
}: {
  ctx: ExtractorContext;
  sources: MessageSource[];
  ruleId: string;
  config: ExtractMessagesConfig;
}): boolean => {
  const alreadyPresent = ctx.bag.attrs.has(config.attrKey) || ctx.out[config.attrKey] !== void 0;
  if (alreadyPresent) {
    return false;
  }

  for (const source of sources) {
    if (source.type === "event") {
      if (extractMessagesFromEvents({ ctx, source, ruleId, config })) return true;

      continue;
    }

    for (const key of source.keys) {
      if (extractMessagesFromAttr({ ctx, key, ruleId, config })) return true;
    }
  }

  return false;
};

export const extractInputMessages = (
  ctx: ExtractorContext,
  sources: MessageSource[],
  ruleId: string,
): boolean =>
  extractMessages({
    ctx,
    sources,
    ruleId,
    config: {
      attrKey: ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
      defaultRole: "user",
      extractSystemInstructions: true,
    },
  });

export const extractOutputMessages = (
  ctx: ExtractorContext,
  sources: MessageSource[],
  ruleId: string,
): boolean =>
  extractMessages({
    ctx,
    sources,
    ruleId,
    config: {
      attrKey: ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
      defaultRole: "assistant",
      extractSystemInstructions: false,
    },
  });

export const extractModelToBoth = ({
  ctx,
  sourceKey,
  ruleId,
  transform = (raw) => (typeof raw === "string" ? raw : null),
}: {
  ctx: ExtractorContext;
  sourceKey: string;
  ruleId: string;
  transform?: (raw: unknown) => string | null;
}): boolean => {
  const modelAlreadyKnown =
    ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ||
    ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL);
  if (modelAlreadyKnown) {
    return false;
  }

  const raw = takeAttribute(ctx.bag.attrs, sourceKey);
  if (raw !== void 0) {
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
 * Coerces string-typed numeric attributes (e.g. "1.5") into actual numbers.
 * Walks each key in the attribute bag, replaces stringy numbers in place,
 * and records a `<extractorId>:coerce(<key>)` rule for traceability.
 */
export const coerceStringNumberAttrs = (
  ctx: ExtractorContext,
  extractorId: string,
  keys: readonly string[],
): void => {
  for (const key of keys) {
    const raw = ctx.bag.attrs.get(key);
    if (typeof raw === "string") {
      const n = asNumber(raw);
      if (n !== null) {
        takeAttribute(ctx.bag.attrs, key);
        ctx.setAttr(key, n);
        ctx.recordRule(`${extractorId}:coerce(${key})`);
      }
    }
  }
};

type UsageTokenSources =
  | { input?: readonly string[]; output?: readonly string[] }
  | { object: string };

/**
 * Takes each key in turn and stops at the first that reads as a number; the
 * last value taken is the answer, so an all-unreadable list gives null.
 */
const pickFirstTokenCount = (ctx: ExtractorContext, keys: readonly string[]): number | null => {
  let count: number | null = null;
  for (const key of keys) {
    const val = takeAttribute(ctx.bag.attrs, key);
    if (val === void 0) continue;

    count = asNumber(val);
    if (count !== null) break;
  }

  return count;
};

export const extractUsageTokens = (
  ctx: ExtractorContext,
  sources: UsageTokenSources,
  ruleId: string,
): void => {
  let inTok: number | null = null;
  let outTok: number | null = null;

  if ("object" in sources) {
    const usageObj = takeAttribute(ctx.bag.attrs, sources.object);
    if (isRecord(usageObj)) {
      inTok = asNumber(usageObj.promptTokens);
      outTok = asNumber(usageObj.completionTokens);
    }
  } else {
    if (sources.input) inTok = pickFirstTokenCount(ctx, sources.input);

    if (sources.output) outTok = pickFirstTokenCount(ctx, sources.output);
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

/**
 * Records a value type annotation for a canonical attribute key.
 * Stored as entries in langwatch.reserved.value_types: ["key=type", ...].
 * Used by downstream mappers to determine the correct SpanInputOutput type.
 */
export const recordValueType = (ctx: ExtractorContext, attrKey: string, type: string): void => {
  const existing = ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES];
  const isStringList = Array.isArray(existing) && existing.every((x) => typeof x === "string");
  if (isStringList) {
    existing.push(`${attrKey}=${type}`);
  } else {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES, [`${attrKey}=${type}`]);
  }
};

/**
 * Consolidates error information from various attribute sources into
 * canonical error.type and error.message attributes.
 * Sources: exception.*, error.*, status.message, span.error.*
 */
export const extractErrorInfo = (ctx: ExtractorContext): void => {
  const { attrs } = ctx.bag;

  const errorTypeAlreadySet = ctx.out[ATTR_KEYS.ERROR_TYPE] !== void 0;

  const exceptionType = attrs.get(ATTR_KEYS.EXCEPTION_TYPE);
  const exceptionMsg = attrs.get(ATTR_KEYS.EXCEPTION_MESSAGE);
  const statusMsg = attrs.get(ATTR_KEYS.STATUS_MESSAGE);

  const spanErrorHas =
    attrs.get(ATTR_KEYS.SPAN_ERROR_HAS_ERROR) ?? attrs.get(ATTR_KEYS.ERROR_HAS_ERROR);
  const spanErrorMsg =
    attrs.get(ATTR_KEYS.SPAN_ERROR_MESSAGE) ?? attrs.get(ATTR_KEYS.ERROR_MESSAGE);

  // Priority 1: Explicit span error flag with message
  if ((spanErrorHas === true || spanErrorHas === "true") && isNonEmptyString(spanErrorMsg)) {
    ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_MESSAGE, spanErrorMsg);
    ctx.recordRule("error:span.error");
    return;
  }

  // Priority 2: Exception type and message
  const hasExceptionPair = isNonEmptyString(exceptionType) && isNonEmptyString(exceptionMsg);
  if (hasExceptionPair) {
    if (!errorTypeAlreadySet) {
      ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_TYPE, exceptionType);
    }
    ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_MESSAGE, exceptionMsg);
    ctx.recordRule("error:exception");
    return;
  }

  // Priority 3: Status message fallback
  if (isNonEmptyString(statusMsg)) {
    ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_MESSAGE, statusMsg);
    ctx.recordRule("error:status.message");
  }
};

export const mapSpanTypeToGenAiOperationName = (t: unknown): string | null => {
  if (typeof t !== "string") {
    return null;
  }
  return SPAN_TYPE_TO_GEN_AI_OP[t] ?? null;
};

export const ALLOWED_SPAN_TYPES: Readonly<Record<string, true>> = {
  span: true,
  llm: true,
  tool: true,
  agent: true,
  rag: true,
  workflow: true,
  component: true,
  evaluation: true,
  server: true,
  client: true,
  producer: true,
  consumer: true,
};

/**
 * Infers and sets span type if it's not already set.
 * Checks both the bag (raw attributes) and out (set by previous extractors).
 */
export const inferSpanTypeIfAbsent = (
  ctx: ExtractorContext,
  type: string,
  ruleId: string,
): void => {
  const canInferSpanType =
    !ctx.bag.attrs.has(ATTR_KEYS.SPAN_TYPE) &&
    ctx.out[ATTR_KEYS.SPAN_TYPE] === void 0 &&
    ALLOWED_SPAN_TYPES[type] === true;
  if (canInferSpanType) {
    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, type);
    ctx.recordRule(ruleId);
  }
};

/**
 * Normalizes Vercel AI SDK model object to "provider/model" string.
 * Example: { id: "gpt-4", provider: "openai.chat" } → "openai/gpt-4"
 */
export const normaliseModelFromAiModelObject = (aiModel: unknown): string | null => {
  if (!isRecord(aiModel)) {
    return null;
  }

  const id = aiModel.id;
  if (!isNonEmptyString(id)) {
    return null;
  }

  const providerRaw = aiModel.provider;
  const provider =
    typeof providerRaw === "string" && providerRaw.trim() !== "" ? providerRaw.split(".")[0] : "";

  return [provider, id].filter(Boolean).join("/") || id;
};

/** The spans whose canonical input count is already the fresh remainder, so none restates it. */
const freshInputSpans = new WeakSet<object>();

/** Whether an earlier pass already restated this span's input count as the fresh remainder. */
export function isInputRestatedAsFresh(ctx: ExtractorContext): boolean {
  return freshInputSpans.has(ctx.out);
}

/** Declares the span's input count fresh as its source sends it, so no pass restates it. */
export function markInputAsFresh(ctx: ExtractorContext, { ruleId }: { ruleId: string }): void {
  freshInputSpans.add(ctx.out);
  ctx.recordRule(ruleId);
}

/**
 * Whether the span's provider is Anthropic, as named by the GenAI or AI SDK attributes, or by the
 * `anthropic/` prefix the AI SDK model object gives the canonical model.
 */
export function isAnthropicProviderSpan(ctx: ExtractorContext): boolean {
  const read = (key: string): unknown =>
    ctx.out[key] !== void 0 ? ctx.out[key] : ctx.bag.attrs.get(key);
  const model = read(ATTR_KEYS.AI_MODEL);
  const names = [
    read(ATTR_KEYS.GEN_AI_PROVIDER_NAME),
    read(ATTR_KEYS.GEN_AI_SYSTEM),
    read("ai.model.provider"),
    isRecord(model) ? model.provider : void 0,
  ];
  const requestModel = read(ATTR_KEYS.GEN_AI_REQUEST_MODEL);

  return (
    names.some((name) => typeof name === "string" && name.toLowerCase().includes("anthropic")) ||
    (typeof requestModel === "string" && requestModel.startsWith("anthropic/"))
  );
}

/** Records the fresh input count a source stated itself, and marks the span as restated. */
export function setFreshInputTokens(
  ctx: ExtractorContext,
  { freshInput, ruleId }: { freshInput: number; ruleId: string },
): void {
  freshInputSpans.add(ctx.out);
  ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, freshInput);
  ctx.recordRule(ruleId);
}

/**
 * Restates an input count that includes the cache reads and writes as the fresh remainder, the
 * canonical shape, at most once per span. The cache write defaults to the canonical cache-creation
 * count. An input count smaller than its cache buckets cannot include them and is left.
 */
export function restateInputAsFresh(
  ctx: ExtractorContext,
  { cacheWrite, ruleId }: { cacheWrite?: number; ruleId: string },
): void {
  if (isInputRestatedAsFresh(ctx)) {
    return;
  }

  const read = (key: string): number | null =>
    asNumber(ctx.out[key] !== void 0 ? ctx.out[key] : ctx.bag.attrs.get(key));
  const input = read(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS);
  const cached =
    Math.max(0, read(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS) ?? 0) +
    Math.max(0, cacheWrite ?? read(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS) ?? 0);
  if (input === null || cached === 0 || input < cached) {
    return;
  }

  setFreshInputTokens(ctx, { freshInput: input - cached, ruleId });
}
