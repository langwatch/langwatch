import { ATTR_KEYS, CLAUDE_CODE_LLM_REQUEST_SPAN_NAME } from "@langwatch/trace-contract";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../ports/canonical-attributes.port";
import { asNumber } from "../services/canonical-guard.service";
import {
  claudeCacheWritesLongLived,
  isConversationalQuerySource,
} from "../services/claude-code-call-policy.service";
import { extractCacheCreationTtlSplit } from "../services/claude-code-response.service";

const CLAUDE_CODE_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
]);

const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export class ClaudeCodeCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "claude-code";

  apply(ctx: ExtractorContext): void {
    // Gateway-proxied claude_code traffic already arrives as gen_ai.* spans
    // (GenAICanonicalisationAdapter's job) — only the CLI's own native span needs lifting.
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
    liftNumber(
      "cache_creation_tokens",
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
    );
    // The span states how many tokens were written to the cache but not how
    // long they live; the lifetime follows the call's request context (see
    // claudeCacheWritesLongLived). A main-thread call's writes are stamped
    // hour-long so computeSpanCost prices them at 2x input rather than the
    // five-minute 1.25x, which undercounted every cache-heavy turn by about a
    // third. setAttrIfAbsent keeps a provider-stated split, should the span
    // ever start carrying one, ahead of this rule.
    const cacheWriteTokens = asNumber(attrs.get("cache_creation_tokens"));
    if (
      cacheWriteTokens !== null &&
      cacheWriteTokens > 0 &&
      claudeCacheWritesLongLived({
        llmRequestContext: asString(attrs.get("llm_request.context")),
        querySource: asString(attrs.get("query_source")),
      })
    ) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS,
        cacheWriteTokens,
      );
      fired = true;
    }

    const model = attrs.get("model");
    if (typeof model === "string" && model.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model);
      fired = true;
    }

    if (fired) ctx.recordRule("claude-code/llm_request");
  }

  applyLog(ctx: LogExtractorContext): void {
    if (!CLAUDE_CODE_SCOPE_NAMES.has(ctx.bag.scopeName)) {
      return;
    }
    const eventName = ctx.bag.attrs.get("event.name");

    // The model-call events' I/O text is folded downstream from the log path
    // itself (extractIOFromLogRecord), not lifted here, this extractor lifts
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
   * The reasoning effort setting rides the `effort` attr of api_request
   * events (e.g. "low" | "high" | "max", Anthropic's adaptive-thinking
   * knob). Only conversational turns set the trace-level value: utility
   * calls (title generation, autosuggest) run at their own effort and must
   * not override what the user's actual turns ran at. Log lifts merge
   * last-write-wins into the trace attributes, so the trace shows the
   * session's most recent conversational effort, same key the codex span
   * path uses and the drawer header pill reads.
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
   * `usage.cache_creation` object, no span or log attribute carries it.
   * Lifted per call here; the trace summary fold sums the per-call values
   * into reserved running totals (these are the only cache numbers that
   * ride logs exclusively, so summing them can never double-count a span).
   */
  private liftApiResponseBodyUsage(ctx: LogExtractorContext): void {
    const usage = extractCacheCreationTtlSplit(ctx.bag.attrs.get("body"));
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
    if (fired) ctx.recordRule("claude-code/api_response_body_usage");
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
    if (fired) ctx.recordRule("claude-code/user_prompt");
  }
}
