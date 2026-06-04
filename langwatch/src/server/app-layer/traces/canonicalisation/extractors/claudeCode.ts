/**
 * Claude Code Extractor
 *
 * Handles: Anthropic Claude Code's native OpenTelemetry log records
 * (scope `com.anthropic.claude_code.events`). Lifts cost-bearing
 * `api_request` events, the user-typed `user_prompt` event, AND
 * the full `api_response_body` (assistant text) onto canonical
 * `langwatch.*` attributes so the trace summary renders the same
 * shape as a real gen_ai span.
 *
 * Detection: log record scope matches CLAUDE_CODE_SCOPE_NAMES and
 *            attributes["event.name"] in { "api_request",
 *            "user_prompt", "api_response_body" }.
 *
 * Canonical attributes produced (when present on the wire):
 * - langwatch.model               (api_request)
 * - langwatch.cost.usd            (api_request)
 * - langwatch.input_tokens        (api_request)
 * - langwatch.output_tokens       (api_request)
 * - langwatch.cache_read_tokens   (api_request)
 * - langwatch.cache_creation_tokens (api_request)
 * - langwatch.thread.id           (api_request OR user_prompt OR api_response_body — from session.id)
 * - langwatch.input               (user_prompt — from `prompt` attr,
 *                                  only when OTEL_LOG_USER_PROMPTS=1)
 * - langwatch.output              (api_response_body — concatenated `content[].text`
 *                                  blocks from the response body JSON, only
 *                                  when OTEL_LOG_RAW_API_BODIES=1)
 *
 * Span-side `apply()` is a no-op — Claude Code Path A claude_code
 * traffic comes through the gateway as gen_ai.* spans handled by
 * GenAIExtractor. This extractor is the Path B (OTLP-from-claude-code)
 * counterpart on the log side.
 *
 * Earlier we reported claude-code 2.x as having a hard vendor limit
 * on assistant output text — that was wrong. The text DOES flow on
 * the `api_response_body` event, but only when OTEL_LOG_RAW_API_BODIES=1
 * is in the env. The langwatch wrapper now sets all 4 OTEL_LOG_*
 * unlock knobs by default (USER_PROMPTS + TOOL_CONTENT + TOOL_DETAILS
 * + RAW_API_BODIES) so this lift covers every cost-bearing turn.
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
    if (eventName === "api_response_body") {
      this.liftApiResponseBody(ctx);
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

  private liftApiResponseBody(ctx: LogExtractorContext): void {
    const bodyRaw = ctx.bag.attrs.take("body");
    const sessionId = asString(ctx.bag.attrs.get("session.id"));

    const responseText = extractAssistantTextFromResponseBody(bodyRaw);

    let fired = false;
    if (responseText !== null) {
      ctx.setAttr("langwatch.output", responseText);
      fired = true;
    }
    if (sessionId !== null) {
      ctx.setAttrIfAbsent("langwatch.thread.id", sessionId);
      fired = true;
    }
    if (fired) ctx.recordRule("claude-code/api_response_body");
  }
}

/**
 * Walk a claude_code.api_response_body JSON payload and pull out the
 * concatenated assistant text from every `content[]` entry of
 * `type === "text"`. Returns null if the body isn't parseable, has
 * no text blocks, or all text blocks are empty.
 *
 * The body JSON shape per Anthropic's Messages API:
 *   { "content": [
 *       { "type": "text", "text": "..." },
 *       { "type": "tool_use", "name": "...", "input": {...} },
 *       { "type": "thinking", "thinking": "<REDACTED>" },
 *       ...
 *     ], ... }
 *
 * tool_use blocks are intentionally NOT folded into langwatch.output —
 * they're tool invocations, not the assistant's reply. They surface
 * separately via the `tool_decision` + `tool_result` events.
 *
 * thinking blocks come back redacted by Anthropic anyway, so there's
 * nothing useful to lift.
 *
 * @internal exported for unit testing only
 */
export function extractAssistantTextFromResponseBody(
  raw: unknown,
): string | null {
  if (raw === null || raw === undefined) return null;
  // The upstream attribute bag (`parseJsonStringValues`) eagerly
  // JSON.parses string attributes that look like JSON, so we may
  // receive either the raw string OR the pre-parsed object here.
  // Accept both.
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length === 0) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const block = c as { type?: unknown; text?: unknown };
    if (block.type !== "text") continue;
    if (typeof block.text !== "string") continue;
    if (block.text.length === 0) continue;
    parts.push(block.text);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
