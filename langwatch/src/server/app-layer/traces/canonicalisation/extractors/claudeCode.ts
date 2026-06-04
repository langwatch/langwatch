/**
 * Claude Code Extractor
 *
 * Handles: Anthropic Claude Code's native OpenTelemetry log records
 * (scope `com.anthropic.claude_code.events`). Lifts cost-bearing
 * `api_request` events AND the user-typed `user_prompt` event onto
 * canonical `langwatch.*` attributes so the trace summary renders
 * the same shape as a real gen_ai span.
 *
 * Detection: log record scope matches CLAUDE_CODE_SCOPE_NAMES and
 *            attributes["event.name"] in { "api_request",
 *            "user_prompt" }.
 *
 * Canonical attributes produced (when present on the wire):
 * - langwatch.model               (api_request)
 * - langwatch.cost.usd            (api_request)
 * - langwatch.input_tokens        (api_request)
 * - langwatch.output_tokens       (api_request)
 * - langwatch.cache_read_tokens   (api_request)
 * - langwatch.cache_creation_tokens (api_request)
 * - langwatch.thread.id           (api_request OR user_prompt — from session.id)
 * - langwatch.input               (user_prompt — from `prompt` attr,
 *                                  only when OTEL_LOG_USER_PROMPTS=1
 *                                  is set, which the langwatch wrapper
 *                                  does by default for claude)
 *
 * Span-side `apply()` is a no-op — Claude Code Path A traffic flows
 * through the gateway and emits gen_ai.* attributes that the
 * GenAIExtractor handles. This extractor is the Path B (OTLP-from-
 * Claude-Code) counterpart, living on the log side.
 *
 * Output text gap: Claude Code 2.x does NOT emit the assistant
 * response body on its api_request event (only model + tokens +
 * cost + duration). The response is rendered to the user's terminal
 * but never serialised on the OTel wire. This is a true vendor
 * limit upstream of this extractor.
 */

import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const CLAUDE_CODE_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
]);

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

export class ClaudeCodeExtractor implements CanonicalAttributesExtractor {
  readonly id = "claude-code";

  apply(_ctx: ExtractorContext): void {
    // Path A claude_code traffic comes through the gateway as gen_ai.*
    // spans; the GenAIExtractor handles that side. Nothing to do here.
  }

  applyLog(ctx: LogExtractorContext): void {
    if (!CLAUDE_CODE_SCOPE_NAMES.has(ctx.bag.scopeName)) return;
    const eventName = ctx.bag.attrs.get("event.name");

    if (eventName === "api_request") {
      this.liftApiRequest(ctx);
      return;
    }
    if (eventName === "user_prompt") {
      this.liftUserPrompt(ctx);
      return;
    }
  }

  private liftApiRequest(ctx: LogExtractorContext): void {
    const model = asString(ctx.bag.attrs.take("model"));
    const costUsd = asNumber(ctx.bag.attrs.take("cost_usd"));
    const inputTokens = asNumber(ctx.bag.attrs.take("input_tokens"));
    const outputTokens = asNumber(ctx.bag.attrs.take("output_tokens"));
    const cacheReadTokens = asNumber(ctx.bag.attrs.take("cache_read_tokens"));
    const cacheCreationTokens = asNumber(
      ctx.bag.attrs.take("cache_creation_tokens"),
    );
    const sessionId = asString(ctx.bag.attrs.get("session.id"));

    let fired = false;
    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }
    if (costUsd !== null) {
      ctx.setAttr("langwatch.cost.usd", String(costUsd));
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
    if (cacheCreationTokens !== null) {
      ctx.setAttr(
        "langwatch.cache_creation_tokens",
        String(cacheCreationTokens),
      );
      fired = true;
    }
    if (sessionId !== null) {
      ctx.setAttr("langwatch.thread.id", sessionId);
      fired = true;
    }

    if (fired) ctx.recordRule("claude-code/api_request");
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
