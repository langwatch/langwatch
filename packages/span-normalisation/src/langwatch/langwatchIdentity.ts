import { ATTR_KEYS } from "../attributeKeys.ts";
import { type ExtractorContext, takeAttribute } from "../canonicalAttributes.ts";
import { ALLOWED_SPAN_TYPES } from "../canonicalExtraction.ts";

const LANGWATCH_RULE_PREFIX = "langwatch";

export function canonicaliseLangWatchIdentity(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  const spanType = attrs.get(ATTR_KEYS.SPAN_TYPE);
  if (
    typeof spanType === "string" &&
    spanType.length > 0 &&
    ALLOWED_SPAN_TYPES[spanType] === true
  ) {
    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, spanType);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:span.type`);
  }

  const threadId =
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_THREAD_ID) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY_ROOT) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID);
  if (threadId !== void 0 && typeof threadId === "string" && threadId.length > 0) {
    ctx.setAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, threadId);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:conversation.id`);
  }

  const userId =
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_USER_ID) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_USER_ID_LEGACY) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_USER_ID_LEGACY_ROOT);
  if (userId !== void 0) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_USER_ID, userId);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:user.id`);
  }

  const customerId =
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_CUSTOMER_ID) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY_ROOT);
  if (customerId !== void 0) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_CUSTOMER_ID, customerId);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:customer.id`);
  }

  const ragContexts =
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_RAG_CONTEXTS) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY);
  if (ragContexts !== void 0) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, ragContexts);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:rag.contexts`);
  }

  const labels =
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_LABELS) ??
    takeAttribute(attrs, ATTR_KEYS.LANGWATCH_TAGS);
  if (labels !== void 0) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_LABELS, labels);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:labels`);
  }
}

type AttributeSource = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;

/** A session key as the coding-agent aggregate reads it: a string, or a finite number as text. */
export function asSessionKey(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** A launcher's `langwatch.session.id`: off the record first, else off its resource. */
export function readDeclaredSessionKey({
  attributes,
  resourceAttributes,
}: {
  attributes: AttributeSource;
  resourceAttributes: Readonly<Record<string, unknown>> | null | undefined;
}): string | null {
  const key = ATTR_KEYS.LANGWATCH_SESSION_ID;
  const own =
    attributes instanceof Map ? attributes.get(key) : (attributes as Record<string, unknown>)[key];
  return asSessionKey(own) ?? asSessionKey(resourceAttributes?.[key]);
}
