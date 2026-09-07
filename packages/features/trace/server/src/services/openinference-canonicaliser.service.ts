/** Maps OpenInference span kind, context, and token usage to canonical keys. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import { ALLOWED_SPAN_TYPES } from "../rules/canonical-extraction.rules.ts";
import { asNumber } from "../rules/canonical-guard.rules.ts";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port.ts";

export class OpenInferenceCanonicaliserService implements CanonicalAttributesPort {
  static create(): OpenInferenceCanonicaliserService {
    return new OpenInferenceCanonicaliserService();
  }

  readonly id = "openinference";

  /** `openinference.span.kind` names the span type, unless one was declared explicitly. */
  private applySpanType(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const explicitType = attrs.get(ATTR_KEYS.SPAN_TYPE);
    const hasExplicitType =
      typeof explicitType === "string" && ALLOWED_SPAN_TYPES[explicitType] === true;
    if (hasExplicitType) {
      return;
    }

    const rawKind = attrs.take(ATTR_KEYS.OPENINFERENCE_SPAN_KIND);
    const kind = typeof rawKind === "string" ? rawKind.toLowerCase() : null;
    if (kind && ALLOWED_SPAN_TYPES[kind] === true) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
      ctx.recordRule(`${this.id}:openinference.span.kind->langwatch.span.type`);
    }
  }

  /** The user, session and tag attributes, each under its canonical key. */
  private applyIdentity(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const userId = attrs.take(ATTR_KEYS.OPENINFERENCE_USER_ID);
    if (typeof userId === "string" && userId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_USER_ID, userId);
      ctx.recordRule(`${this.id}:user.id`);
    }

    const sessionId = attrs.take(ATTR_KEYS.OPENINFERENCE_SESSION_ID);
    if (typeof sessionId === "string" && sessionId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId);
      ctx.recordRule(`${this.id}:session.id`);
    }

    const tags = attrs.take(ATTR_KEYS.OPENINFERENCE_TAG_TAGS);
    if (tags !== void 0) {
      const labelsStr = typeof tags === "string" ? tags : JSON.stringify(tags);
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_LABELS, labelsStr);
      ctx.recordRule(`${this.id}:tag.tags`);
    }
  }

  /**
   * Every token count, under its canonical key. `total` is consumed (so it does not leak into
   * params) but not stored — total tokens are always derived as prompt + completion downstream.
   */
  private applyTokenCounts(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const counts: [string, string][] = [
      [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT, ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS],
      [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION, ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS],
    ];

    let recordedAnyTokenCount = false;
    for (const [source, target] of counts) {
      const value = asNumber(attrs.take(source));
      if (value !== null) {
        ctx.setAttrIfAbsent(target, value);
        recordedAnyTokenCount = true;
      }
    }

    attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_TOTAL);

    const detailCounts: [string, string][] = [
      [
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING,
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
      ],
      [
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ,
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      ],
      [
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE,
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
      ],
    ];
    for (const [source, target] of detailCounts) {
      const value = asNumber(attrs.take(source));
      if (value !== null) {
        ctx.setAttrIfAbsent(target, value);
        recordedAnyTokenCount = true;
      }
    }

    if (recordedAnyTokenCount) {
      ctx.recordRule(`${this.id}:llm.token_count`);
    }
  }

  apply(ctx: ExtractorContext): void {
    this.applySpanType(ctx);
    this.applyIdentity(ctx);
    this.applyTokenCounts(ctx);
  }
}
