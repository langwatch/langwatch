/**
 * OpenInference Extractor
 *
 * Handles: OpenInference semantic conventions (openinference.* namespace)
 * Reference: https://github.com/Arize-ai/openinference
 *
 * OpenInference is a set of conventions used by Arize Phoenix and related tools.
 * This extractor handles span kind mapping and context attributes set via
 * `using_attributes()` (user_id, session_id, tags).
 *
 * Detection: Presence of openinference.span.kind attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from openinference.span.kind)
 * - langwatch.user.id (from user.id)
 * - gen_ai.conversation.id (from session.id)
 * - langwatch.labels (from tag.tags)
 */

import { ATTR_KEYS } from "./_constants";
import { ALLOWED_SPAN_TYPES } from "./_extraction";
import { asNumber } from "./_guards";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class OpenInferenceExtractor implements CanonicalAttributesExtractor {
  readonly id = "openinference";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type (from openinference.span.kind)
    // Skip if explicit type is already set
    // ─────────────────────────────────────────────────────────────────────────
    const explicitType = attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (
      typeof explicitType === "string" &&
      ALLOWED_SPAN_TYPES.has(explicitType)
    ) {
      // Don't return early — still process user.id, session.id, tag.tags
    } else {
      const rawKind = attrs.take(ATTR_KEYS.OPENINFERENCE_SPAN_KIND);
      const kind = typeof rawKind === "string" ? rawKind.toLowerCase() : null;

      if (kind && ALLOWED_SPAN_TYPES.has(kind)) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
        ctx.recordRule(
          `${this.id}:openinference.span.kind->langwatch.span.type`,
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User ID (from OpenInference using_attributes(user_id=...))
    // Sets "user.id" span attribute. Map to canonical langwatch.user.id.
    // Uses setAttrIfAbsent so explicit langwatch attributes take precedence.
    // ─────────────────────────────────────────────────────────────────────────
    const userId = attrs.take(ATTR_KEYS.OPENINFERENCE_USER_ID);
    if (typeof userId === "string" && userId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_USER_ID, userId);
      ctx.recordRule(`${this.id}:user.id`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session ID → Thread/Conversation ID
    // OpenInference session.id maps to gen_ai.conversation.id (thread_id)
    // This matches the ES legacy path behavior in otel.traces.ts
    // ─────────────────────────────────────────────────────────────────────────
    const sessionId = attrs.take(ATTR_KEYS.OPENINFERENCE_SESSION_ID);
    if (typeof sessionId === "string" && sessionId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId);
      ctx.recordRule(`${this.id}:session.id`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tags → Labels
    // OpenInference tag.tags maps to langwatch.labels
    // The value may be a JSON array string or a raw array
    // ─────────────────────────────────────────────────────────────────────────
    const tags = attrs.take(ATTR_KEYS.OPENINFERENCE_TAG_TAGS);
    if (tags !== undefined) {
      // Normalize to string for consistency with langwatch.labels format
      const labelsStr = typeof tags === "string" ? tags : JSON.stringify(tags);
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_LABELS, labelsStr);
      ctx.recordRule(`${this.id}:tag.tags`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Token Usage (llm.token_count.*)
    // OpenInference instrumentors (openai, anthropic, langchain, ...) emit
    // token counts under this namespace. Map them to canonical gen_ai.usage.*
    // so downstream cost computation picks them up.
    // ─────────────────────────────────────────────────────────────────────────
    const prompt = asNumber(
      attrs.take(ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT),
    );
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
      attrs.take(
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING,
      ),
    );
    if (reasoning !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, reasoning);
    }
    const cacheRead = asNumber(
      attrs.take(
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ,
      ),
    );
    if (cacheRead !== null) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        cacheRead,
      );
    }
    const cacheWrite = asNumber(
      attrs.take(
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE,
      ),
    );
    if (cacheWrite !== null) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        cacheWrite,
      );
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
