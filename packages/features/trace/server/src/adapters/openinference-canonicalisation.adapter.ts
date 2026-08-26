/** Maps OpenInference span kind, context, and token usage to canonical keys. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import { ALLOWED_SPAN_TYPES } from "../services/canonical-extraction.service";
import { asNumber } from "../services/canonical-guard.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

export class OpenInferenceCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "openinference";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const explicitType = attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (!(typeof explicitType === "string" && ALLOWED_SPAN_TYPES.has(explicitType))) {
      const rawKind = attrs.take(ATTR_KEYS.OPENINFERENCE_SPAN_KIND);
      const kind = typeof rawKind === "string" ? rawKind.toLowerCase() : null;

      if (kind && ALLOWED_SPAN_TYPES.has(kind)) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
        ctx.recordRule(`${this.id}:openinference.span.kind->langwatch.span.type`);
      }
    }

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

    const prompt = asNumber(attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT));
    if (prompt !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, prompt);
    }
    const completion = asNumber(
      attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION),
    );
    if (completion !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, completion);
    }
    // `total` is consumed (so it doesn't leak into params) but not stored —
    // total tokens are always derived as prompt + completion downstream.
    attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_TOTAL);

    const reasoning = asNumber(
      attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING),
    );
    if (reasoning !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, reasoning);
    }
    const cacheRead = asNumber(
      attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ),
    );
    if (cacheRead !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheRead);
    }
    const cacheWrite = asNumber(
      attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE),
    );
    if (cacheWrite !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheWrite);
    }
    if (
      prompt !== null ||
      completion !== null ||
      reasoning !== null ||
      cacheRead !== null ||
      cacheWrite !== null
    ) {
      ctx.recordRule(`${this.id}:llm.token_count`);
    }
  }
}
