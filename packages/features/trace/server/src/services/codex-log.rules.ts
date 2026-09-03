import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { LogExtractorContext } from "../ports/canonical-attributes.port";
import { asNumber, asString, CODEX_EVENT_NAME_PREFIX } from "./codex-canonical-value.rules";

export class CodexLogCanonicaliser {
  apply(ctx: LogExtractorContext): void {
    const eventName = ctx.bag.attrs.get("event.name");
    if (typeof eventName !== "string") {
      return;
    }
    if (!eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) {
      return;
    }

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
    const reasoningEffort = asString(ctx.bag.attrs.take("model_reasoning_effort"));

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
    if (threadId !== null) {
      ctx.setAttr("langwatch.thread.id", threadId);
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
    const model = asString(ctx.bag.attrs.take("model"));
    const principalEmail = asString(ctx.bag.attrs.take("user.email"));
    const reasoningEffort = asString(ctx.bag.attrs.take("reasoning_effort"));

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
    const prompt = asString(ctx.bag.attrs.take("prompt"));
    if (prompt === null) {
      return;
    }
    ctx.setAttr("langwatch.input", prompt);
    ctx.recordRule("codex/user_prompt");
  }
}
