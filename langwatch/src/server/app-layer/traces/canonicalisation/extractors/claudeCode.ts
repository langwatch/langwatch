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
 *                                  when OTEL_LOG_RAW_API_BODIES=1 AND the call is
 *                                  a genuine conversation turn — see
 *                                  CONVERSATIONAL_QUERY_SOURCES; utility calls
 *                                  like prompt_suggestion are skipped)
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

import { capPayloadString } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedLogRecord";

import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const CLAUDE_CODE_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
]);

/**
 * Claude Code emits an `api_response_body` event for EVERY model call it
 * makes, not just the user-facing conversation — including non-conversational
 * utility calls that carry text we must NOT treat as the assistant's reply:
 *
 * - `prompt_suggestion`     — the greyed-out autosuggest of what the user
 *                             might type next (e.g. "continue", "run ls again")
 * - `generate_session_title`— the haiku-generated conversation title, shipped
 *                             as a `{"title": "..."}` JSON text block
 * - `quota` / future utility sources — token-probe / housekeeping calls
 *
 * Folding those into `langwatch.output` corrupts the trace's headline output:
 * the fold is last-write-wins, so a throwaway autosuggest emitted after the
 * real reply overwrites it. We therefore lift output text ONLY from genuine
 * conversation turns. The main REPL thread is the headline conversation; an
 * absent `query_source` is treated as conversational for backwards-compat with
 * older claude-code builds (and other emitters) that don't stamp the field.
 * Utility-call text is still fully captured as its own stored log record — it
 * just doesn't pollute the single rolled-up ComputedOutput.
 */
const CONVERSATIONAL_QUERY_SOURCES: ReadonlySet<string> = new Set([
  "repl_main_thread",
]);

/**
 * True when an `api_response_body` came from a genuine conversation turn whose
 * text is the assistant's reply to the user — as opposed to a non-conversational
 * utility call (see CONVERSATIONAL_QUERY_SOURCES). An absent query_source is
 * treated as conversational for backwards-compat. Exported so the trace-io
 * accumulation projection (which lifts ComputedOutput directly from
 * api_response_body, a second path) reuses this exact gate instead of
 * duplicating the allowlist.
 */
export const isConversationalQuerySource = (
  querySource: string | null,
): boolean =>
  querySource === null || CONVERSATIONAL_QUERY_SOURCES.has(querySource);

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
    const querySource = asString(ctx.bag.attrs.get("query_source"));
    const bodyRaw = ctx.bag.attrs.take("body");
    const sessionId = asString(ctx.bag.attrs.get("session.id"));

    // Only fold the assistant text from genuine conversation turns into
    // langwatch.output — utility calls (prompt_suggestion autosuggest,
    // generate_session_title, etc.) carry text that is NOT the assistant's
    // reply and would clobber the headline ComputedOutput (last write wins).
    // See CONVERSATIONAL_QUERY_SOURCES.
    const responseText = isConversationalQuerySource(querySource)
      ? extractAssistantTextFromResponseBody(bodyRaw)
      : null;

    let fired = false;
    if (responseText !== null) {
      ctx.setAttr("langwatch.output", responseText);
      fired = true;
    }
    // thread.id correlation is lifted from EVERY api_response_body (including
    // utility calls) so the trace stays stitched even if the only records in a
    // window are non-conversational.
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
  // Defence-in-depth payload-size guard. claude-code 2.x caps each
  // api_response_body inline at ~60KB upstream, and the log
  // command-level cap (capOversizedLogRecord, alexis) bounds the
  // stored body before redaction/fold. This second cap bounds the
  // ComputedOutput / langwatch.output value specifically, in case
  // a future claude release lifts the 60KB inline cap or a different
  // emitter ships an api_response_body without one.
  return capPayloadString(parts.join("\n\n"), undefined, "assistant_output");
}
