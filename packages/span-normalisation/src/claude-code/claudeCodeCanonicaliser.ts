import { ATTR_KEYS, CLAUDE_CODE_LLM_REQUEST_SPAN_NAME } from "../attributeKeys.ts";
import {
  type AttributeCanonicaliser,
  type ExtractorContext,
  type LogExtractorContext,
  takeAttribute,
} from "../canonicalAttributes.ts";
import { markInputAsFresh } from "../canonicalExtraction.ts";
import { asNumber } from "../canonicalGuard.ts";
import { asSessionKey, readDeclaredSessionKey } from "../langwatch/langwatchIdentity.ts";
import { ClaudeCodeResponseService } from "./claudeCodeResponse.ts";

const claudeCodeResponseService = ClaudeCodeResponseService.create();

export const CLAUDE_CODE_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
]);

/** One tool call; its `.execution` and `.blocked_on_user` children are phases of it, not tools. */
const CLAUDE_CODE_TOOL_SPAN_NAME = "claude_code.tool";
const CLAUDE_CODE_SPAN_PREFIX = "claude_code.";

const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export class ClaudeCodeCanonicaliserService implements AttributeCanonicaliser {
  static create(): ClaudeCodeCanonicaliserService {
    return new ClaudeCodeCanonicaliserService();
  }

  private constructor() {}

  readonly id = "claude-code";

  apply(ctx: ExtractorContext): void {
    if (ctx.span.name.startsWith(CLAUDE_CODE_SPAN_PREFIX)) this.keySession(ctx);
    if (ctx.span.name === CLAUDE_CODE_TOOL_SPAN_NAME) {
      ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "tool");
      ctx.recordRule("claude-code/tool");
      return;
    }
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
      // Claude Code reports the API's input count, which excludes the cache reads and writes.
      markInputAsFresh(ctx, { ruleId: "claude-code/usage.input_tokens(fresh as sent)" });
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

  /**
   * The conversation is the agent's session: a launcher's `langwatch.session.id` (span, then
   * resource), else Claude Code's own `session.id`. A conversation it displaces, such as a
   * launcher's thread, moves to `langwatch.thread.id`; one equal to the session is already kept.
   */
  private keySession(ctx: ExtractorContext): void {
    const session =
      readDeclaredSessionKey({
        attributes: ctx.bag.attrs,
        resourceAttributes: ctx.span.resourceAttributes,
      }) ?? asSessionKey(ctx.bag.attrs.get("session.id"));
    const conversation =
      asString(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]) ??
      asString(takeAttribute(ctx.bag.attrs, ATTR_KEYS.GEN_AI_CONVERSATION_ID));
    if (session === null || session === conversation) {
      if (conversation !== null)
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, conversation);
      return;
    }
    if (conversation !== null) ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_THREAD_ID, conversation);
    ctx.setAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, session);
    ctx.recordRule("claude-code/session");
  }

  private liftUserPrompt(ctx: LogExtractorContext): void {
    const prompt = asString(takeAttribute(ctx.bag.attrs, "prompt"));
    const sessionId = asString(ctx.bag.attrs.get("session.id"));

    // A launcher that wraps the request declares the request itself; that one is the input.
    const declared =
      asString(ctx.out["langwatch.input"]) ?? asString(ctx.bag.attrs.get("langwatch.input"));

    let fired = false;
    if (declared !== null || prompt !== null) {
      ctx.setAttr("langwatch.input", declared ?? prompt);
      fired = true;
    }

    // The record's thread is the agent's session, as a span's conversation is (keySession).
    // A launcher's declared session wins over any thread the record named itself.
    const declaredSession = readDeclaredSessionKey({
      attributes: ctx.bag.attrs,
      resourceAttributes: ctx.resourceAttributes,
    });
    // A subagent span without a session names the subagent as its conversation;
    // the prompt names the session.
    if (declaredSession !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, declaredSession);
      ctx.setAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, declaredSession);
      fired = true;
    } else if (sessionId !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId);
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_THREAD_ID, sessionId);
      fired = true;
    }

    if (fired) {
      ctx.recordRule("claude-code/user_prompt");
    }
  }
}

const CONVERSATIONAL_QUERY_SOURCES: Readonly<Record<string, true>> = {
  repl_main_thread: true,
  sdk: true,
};

export const isConversationalQuerySource = (querySource: string | null): boolean =>
  querySource === null || CONVERSATIONAL_QUERY_SOURCES[querySource] === true;

/**
 * Prices main-thread cache writes as one-hour entries. Unknown contexts remain
 * short-lived so a provider change cannot overstate cost.
 */
export const claudeCacheWritesLongLived = ({
  llmRequestContext,
  querySource,
}: {
  llmRequestContext?: string | null;
  querySource?: string | null;
}): boolean => llmRequestContext === "interaction" || querySource === "repl_main_thread";
