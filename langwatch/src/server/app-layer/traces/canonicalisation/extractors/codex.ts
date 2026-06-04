/**
 * Codex Extractor
 *
 * Handles: OpenAI Codex's native OpenTelemetry log records. Codex
 * emits three event types this extractor claims on the log side:
 *
 * - `codex.sse_event`: the cost-bearing turn event with model + token
 *   counts + conversation.id + user.email. Codex does NOT emit a cost
 *   field on the wire; cost is filled downstream via the receiver-side
 *   model-pricing lookup once the unified pipeline is wired in.
 * - `codex.conversation_starts`: lets the trace summary show the
 *   conversation grouping (model + principal) even when the very
 *   first sse_event hasn't fired yet.
 * - `codex.user_prompt`: carries the user's prompt text, which the
 *   trace summary lifts onto langwatch.input.
 *
 * Detection: attributes["event.name"] starts with "codex.". Codex
 * doesn't pin its scope name in a stable way across releases, so we
 * gate on event.name (matches the bespoke extractCodexSseEventMetrics
 * + extractCodexConversationStartMetrics + codex.user_prompt branch
 * in extractIOFromLogRecord that this class replaces).
 *
 * Canonical attributes produced (only when the corresponding wire
 * field is present):
 * - langwatch.model
 * - langwatch.input_tokens
 * - langwatch.output_tokens
 * - langwatch.cache_read_tokens
 * - langwatch.thread.id (from conversation.id)
 * - langwatch.principal.email (from user.email)
 * - langwatch.input (from codex.user_prompt prompt)
 *
 * Span-side `apply()` is a no-op — Path A traffic flows through the
 * gateway and emits gen_ai.* attributes that GenAIExtractor handles.
 */

import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const CODEX_EVENT_NAME_PREFIX = "codex.";

const asNumber = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  return Number.isFinite(n) ? n : null;
};

const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export class CodexExtractor implements CanonicalAttributesExtractor {
  readonly id = "codex";

  apply(_ctx: ExtractorContext): void {
    // Path A codex traffic flows through the gateway as gen_ai.*
    // spans; GenAIExtractor handles that side. Nothing to do here.
  }

  applyLog(ctx: LogExtractorContext): void {
    const eventName = ctx.bag.attrs.get("event.name");
    if (typeof eventName !== "string") return;
    if (!eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) return;

    if (eventName === "codex.sse_event") {
      this.liftSseEvent(ctx);
      return;
    }
    if (eventName === "codex.conversation_starts") {
      this.liftConversationStarts(ctx);
      return;
    }
    if (eventName === "codex.user_prompt") {
      this.liftUserPrompt(ctx);
      return;
    }
  }

  private liftSseEvent(ctx: LogExtractorContext): void {
    const model = asString(ctx.bag.attrs.take("model"));
    const inputTokens = asNumber(ctx.bag.attrs.take("input_token_count"));
    const outputTokens = asNumber(ctx.bag.attrs.take("output_token_count"));
    const cacheReadTokens = asNumber(ctx.bag.attrs.take("cached_token_count"));
    const threadId = asString(ctx.bag.attrs.take("conversation.id"));
    const principalEmail = asString(ctx.bag.attrs.take("user.email"));

    let fired = false;
    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }
    if (inputTokens !== null) {
      ctx.setAttr("langwatch.input_tokens", String(inputTokens));
      fired = true;
    }
    if (outputTokens !== null) {
      ctx.setAttr("langwatch.output_tokens", String(outputTokens));
      fired = true;
    }
    if (cacheReadTokens !== null) {
      ctx.setAttr("langwatch.cache_read_tokens", String(cacheReadTokens));
      fired = true;
    }
    if (threadId !== null) {
      ctx.setAttr("langwatch.thread.id", threadId);
      fired = true;
    }
    if (principalEmail !== null) {
      ctx.setAttr("langwatch.principal.email", principalEmail);
      fired = true;
    }
    if (fired) ctx.recordRule("codex/sse_event");
  }

  private liftConversationStarts(ctx: LogExtractorContext): void {
    const model = asString(ctx.bag.attrs.take("model"));
    const principalEmail = asString(ctx.bag.attrs.take("user.email"));

    let fired = false;
    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }
    if (principalEmail !== null) {
      ctx.setAttr("langwatch.principal.email", principalEmail);
      fired = true;
    }
    if (fired) ctx.recordRule("codex/conversation_starts");
  }

  private liftUserPrompt(ctx: LogExtractorContext): void {
    const prompt = asString(ctx.bag.attrs.take("prompt"));
    if (prompt === null) return;
    ctx.setAttr("langwatch.input", prompt);
    ctx.recordRule("codex/user_prompt");
  }
}
