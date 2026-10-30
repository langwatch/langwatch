/**
 * Lifts the pi attributes the GenAI conventions have no name for (ADR-188). pi
 * dual-writes each model-call attribute, its key beside the convention key, so
 * the preceding GenAI adapter already holds model, operation and token counts.
 */

import { ATTR_KEYS } from "./attributeKeys.ts";
import {
  type AttributeCanonicaliser,
  type ExtractorContext,
  hasAttributeWithPrefix,
  takeAttribute,
} from "./canonicalAttributes.ts";
import { extractModelToBoth, inferSpanTypeIfAbsent } from "./canonicalExtraction.ts";
import { asNumber, isNonEmptyString } from "./canonicalGuard.ts";

const PI_ATTR_PREFIX = "pi.";

/** pi's span names → langwatch span types. Its names are the whole name, never a prefix. */
const SPAN_NAME_TO_SPAN_TYPE: Record<string, string> = {
  "pi.harness.run": "agent",
  "pi.harness.turn": "agent",
  "pi.harness.tool": "tool",
  "pi.ai.request": "llm",
};

/**
 * pi's token spellings → the canonical key for each. Plain input and output are
 * absent: the GenAI adapter takes those from pi's dual-written convention keys,
 * and reading a count twice is how a token total ends up doubled.
 */
const TOKEN_LIFTS: readonly (readonly [string, string])[] = [
  ["pi.ai.usage.cache_read_tokens", ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
  ["pi.ai.usage.cache_write_tokens", ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
  ["pi.ai.usage.reasoning_tokens", ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS],
];

export class PiCanonicaliserService implements AttributeCanonicaliser {
  static create(): PiCanonicaliserService {
    return new PiCanonicaliserService();
  }

  private constructor() {}

  readonly id = "pi";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const spanName = ctx.span.name ?? "";

    // pi's own namespace is the only provenance test. The scope and service
    // names are not: `pi` is a substring of `copilot` and of `anthropic`.
    const isPiSpan =
      spanName.startsWith(PI_ATTR_PREFIX) || hasAttributeWithPrefix(attrs, PI_ATTR_PREFIX);
    if (!isPiSpan) return;

    const spanType = SPAN_NAME_TO_SPAN_TYPE[spanName];
    if (spanType !== void 0) {
      inferSpanTypeIfAbsent(ctx, spanType, `${this.id}:span_type.from_span_name`);
    }

    // Fallback only: pi's convention key is what the GenAI adapter reads, and
    // `extractModelToBoth` declines when that key is present.
    extractModelToBoth({ ctx, sourceKey: "pi.ai.model", ruleId: `${this.id}:model` });

    this.liftTokens(ctx);
    this.liftOutcome(ctx);
    this.liftIdentifiers(ctx);

    // `pi.ai.usage.cost` is deliberately never read. pi's self-reported figure
    // survives under pi's own key as a drift signal; the charge is the
    // catalogue price of the call's own tokens (ADR-188 Decision 7).
  }

  private liftTokens(ctx: ExtractorContext): void {
    for (const [sourceKey, canonicalKey] of TOKEN_LIFTS) {
      if (ctx.out[canonicalKey] !== void 0 || ctx.bag.attrs.has(canonicalKey)) continue;
      const tokens = asNumber(ctx.bag.attrs.get(sourceKey));
      if (tokens === null) continue;
      takeAttribute(ctx.bag.attrs, sourceKey);
      ctx.setAttr(canonicalKey, tokens);
      ctx.recordRule(`${this.id}:${sourceKey}`);
    }
  }

  /** How the call ended: pi's stop reason and, when it failed, the error it names. */
  private liftOutcome(ctx: ExtractorContext): void {
    const stopReason = ctx.bag.attrs.get("pi.ai.response.stop_reason");
    if (
      isNonEmptyString(stopReason) &&
      ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_FINISH_REASONS] === void 0
    ) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_FINISH_REASONS, stopReason);
      ctx.recordRule(`${this.id}:response.stop_reason`);
    }

    const errorType = ctx.bag.attrs.get("pi.ai.error.type") ?? ctx.bag.attrs.get("pi.error.type");
    if (isNonEmptyString(errorType) && ctx.out[ATTR_KEYS.ERROR_TYPE] === void 0) {
      ctx.setAttr(ATTR_KEYS.ERROR_TYPE, errorType);
      ctx.recordRule(`${this.id}:error.type`);
    }
  }

  /**
   * The session and tool identifiers pi's harness spans carry. Copied rather
   * than taken: the coding-agent fold reads pi's own keys off the same span, so
   * consuming one here would lose it the session it belongs to.
   */
  private liftIdentifiers(ctx: ExtractorContext): void {
    const sessionId = ctx.bag.attrs.get("pi.session.id");
    if (isNonEmptyString(sessionId) && ctx.out[ATTR_KEYS.LANGWATCH_THREAD_ID] === void 0) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, sessionId);
      ctx.recordRule(`${this.id}:thread.id`);
    }

    const toolName = ctx.bag.attrs.get("pi.tool.name");
    if (isNonEmptyString(toolName) && ctx.out[ATTR_KEYS.GEN_AI_TOOL_NAME] === void 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_TOOL_NAME, toolName);
      ctx.recordRule(`${this.id}:tool.name`);
    }
  }
}
