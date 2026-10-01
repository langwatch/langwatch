import { ATTR_KEYS } from "@langwatch/trace-contract";

import { type LogExtractorContext, takeAttribute } from "../rules/canonical-attributes.rules.ts";
import {
  asNumber,
  asString,
  CODEX_EVENT_NAME_PREFIX,
} from "../rules/codex-canonical-value.rules.ts";

export class CodexLogCanonicaliserService {
  private constructor() {}

  static create(): CodexLogCanonicaliserService {
    return new CodexLogCanonicaliserService();
  }

  apply(ctx: LogExtractorContext): void {
    const eventName = ctx.bag.attrs.get("event.name");
    if (typeof eventName !== "string") {
      return;
    }

    if (!eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) {
      return;
    }

    this.liftConversationId(ctx);

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

  /**
   * Every codex log record names its session as `conversation.id`. A turn
   * with no span has only logs to key the session fold off, so this lifts
   * it onto the trace's conversation key and `langwatch.thread.id`.
   */
  private liftConversationId(ctx: LogExtractorContext): void {
    const conversationId = asString(ctx.bag.attrs.get("conversation.id"));
    if (conversationId === null) return;
    ctx.setAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, conversationId);
    ctx.setAttr("langwatch.thread.id", conversationId);
    ctx.recordRule("codex/conversation_id");
  }

  private liftSseEvent(ctx: LogExtractorContext): void {
    const model = asString(takeAttribute(ctx.bag.attrs, "model"));
    const inputTokens = asNumber(takeAttribute(ctx.bag.attrs, "input_token_count"));
    const outputTokens = asNumber(takeAttribute(ctx.bag.attrs, "output_token_count"));
    const cacheReadTokens = asNumber(takeAttribute(ctx.bag.attrs, "cached_token_count"));
    const principalEmail = asString(takeAttribute(ctx.bag.attrs, "user.email"));
    const reasoningEffort = asString(takeAttribute(ctx.bag.attrs, "model_reasoning_effort"));

    let fired = false;
    if (reasoningEffort !== null) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT, reasoningEffort);
      fired = true;
    }

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

    if (principalEmail !== null) {
      ctx.setAttr("langwatch.principal.email", principalEmail);
      fired = true;
    }

    if (fired) {
      ctx.recordRule("codex/sse_event");
    }
  }

  private liftConversationStarts(ctx: LogExtractorContext): void {
    const model = asString(takeAttribute(ctx.bag.attrs, "model"));
    const principalEmail = asString(takeAttribute(ctx.bag.attrs, "user.email"));
    const reasoningEffort = asString(takeAttribute(ctx.bag.attrs, "reasoning_effort"));

    let fired = false;
    if (reasoningEffort !== null) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT, reasoningEffort);
      fired = true;
    }

    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }

    if (principalEmail !== null) {
      ctx.setAttr("langwatch.principal.email", principalEmail);
      fired = true;
    }

    if (fired) {
      ctx.recordRule("codex/conversation_starts");
    }
  }

  private liftUserPrompt(ctx: LogExtractorContext): void {
    const prompt = asString(takeAttribute(ctx.bag.attrs, "prompt"));
    if (prompt === null) {
      return;
    }

    ctx.setAttr("langwatch.input", prompt);
    ctx.recordRule("codex/user_prompt");
  }
}
