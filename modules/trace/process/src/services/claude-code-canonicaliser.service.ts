import { ATTR_KEYS, CLAUDE_CODE_LLM_REQUEST_SPAN_NAME } from "@langwatch/trace-contract";

import { asNumber } from "../rules/canonical-guard.rules.ts";
import {
  claudeCacheWritesLongLived,
  isConversationalQuerySource,
} from "../rules/claude-code-call-policy.rules.ts";
import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "./canonical-attributes.service.ts";
import { ClaudeCodeResponseService } from "./claude-code-response.service.ts";

const claudeCodeResponseService = ClaudeCodeResponseService.create();

export const CLAUDE_CODE_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
]);

const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export class ClaudeCodeCanonicaliserService implements AttributeCanonicaliser {
  static create(): ClaudeCodeCanonicaliserService {
    return new ClaudeCodeCanonicaliserService();
  }

  private constructor() {}

  readonly id = "claude-code";

  apply(ctx: ExtractorContext): void {
    // Gateway-proxied claude_code traffic already arrives as gen_ai.* spans
    // (GenAICanonicaliserService's job) — only the CLI's own native span needs lifting.
    if (ctx.span.name !== CLAUDE_CODE_LLM_REQUEST_SPAN_NAME) {
      return;
    }

    const attrs = ctx.bag.attrs;
    let fired = false;

    const liftNumber = (rawKey: string, canonicalKey: string) => {
      const n = asNumber(attrs.get(rawKey));
      if (n !== null && n > 0) {
        ctx.setAttrIfAbsent(canonicalKey, n);
        fired = true;
      }
    };

    liftNumber("input_tokens", ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS);
    liftNumber("output_tokens", ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS);
    liftNumber("cache_read_tokens", ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS);
    liftNumber("cache_creation_tokens", ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS);
    // The span doesn't say how long cache-written tokens live; a main-thread
    // call is stamped hour-long so computeSpanCost prices at 2x rather than
    // the 1.25x that undercounted cache-heavy turns by about a third.
    const cacheWriteTokens = asNumber(attrs.get("cache_creation_tokens"));
    const writesLongLivedCache =
      cacheWriteTokens !== null &&
      cacheWriteTokens > 0 &&
      claudeCacheWritesLongLived({
        llmRequestContext: asString(attrs.get("llm_request.context")),
        querySource: asString(attrs.get("query_source")),
      });
    if (writesLongLivedCache) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS, cacheWriteTokens);
      fired = true;
    }

    const model = attrs.get("model");
    if (typeof model === "string" && model.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model);
      fired = true;
    }

    if (fired) {
      ctx.recordRule("claude-code/llm_request");
    }
  }

  applyLog(ctx: LogExtractorContext): void {
    if (!CLAUDE_CODE_SCOPE_NAMES.has(ctx.bag.scopeName)) {
      return;
    }

    const eventName = ctx.bag.attrs.get("event.name");

    // The model-call events' I/O text is folded downstream from the log path
    // itself (TraceLogRecordIOService), not lifted here, this extractor lifts
    // only scalar canonical attributes.
    if (eventName === "user_prompt") {
      this.liftUserPrompt(ctx);

      return;
    }

    if (eventName === "api_request") {
      this.liftApiRequest(ctx);

      return;
    }

    if (eventName === "api_response_body") {
      this.liftApiResponseBodyUsage(ctx);

      return;
    }
  }

  /**
   * Lifts reasoning effort from api_request event; only conversational turns update
   * trace level to avoid overwriting with utility-call effort values.
   */
  private liftApiRequest(ctx: LogExtractorContext): void {
    const querySource = asString(ctx.bag.attrs.get("query_source"));
    if (!isConversationalQuerySource(querySource)) {
      return;
    }

    const effort = asString(ctx.bag.attrs.get("effort"));
    if (effort === null) {
      return;
    }

    ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT, effort);
    ctx.recordRule("claude-code/api_request");
  }

  /**
   * The per-TTL cache-creation split lives ONLY in the response body's
   * `usage.cache_creation` object. Lifted per call here; the trace summary
   * fold sums per-call values, which can never double-count a span.
   */
  private liftApiResponseBodyUsage(ctx: LogExtractorContext): void {
    const usage = claudeCodeResponseService.extractCacheCreationTtlSplit(ctx.bag.attrs.get("body"));
    if (usage === null) {
      return;
    }

    let fired = false;
    if (usage.ephemeral5mInputTokens > 0) {
      ctx.setAttr(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS,
        usage.ephemeral5mInputTokens,
      );
      fired = true;
    }

    if (usage.ephemeral1hInputTokens > 0) {
      ctx.setAttr(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS,
        usage.ephemeral1hInputTokens,
      );
      fired = true;
    }

    if (fired) {
      ctx.recordRule("claude-code/api_response_body_usage");
    }
  }

  private liftUserPrompt(ctx: LogExtractorContext): void {
    const prompt = asString(ctx.bag.attrs.take("prompt"));
    const sessionId = asString(ctx.bag.attrs.get("session.id"));

    let fired = false;
    if (prompt !== null) {
      ctx.setAttr("langwatch.input", prompt);
      fired = true;
    }

    if (sessionId !== null) {
      ctx.setAttrIfAbsent("langwatch.thread.id", sessionId);
      fired = true;
    }

    if (fired) {
      ctx.recordRule("claude-code/user_prompt");
    }
  }
}
