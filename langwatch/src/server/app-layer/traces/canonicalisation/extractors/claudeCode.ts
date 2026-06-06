/**
 * Claude Code Extractor (log side)
 *
 * Handles: the `user_prompt` log event of Anthropic Claude Code's native
 * OpenTelemetry log records (scope `com.anthropic.claude_code.events`),
 * lifting the user-typed prompt onto `langwatch.input` so the trace
 * summary headline input is populated.
 *
 * The cost-bearing model-call events (`api_request`, `api_request_body`,
 * `api_response_body`) are NOT handled here: they are trapped at ingest
 * and CONVERTED into a single standard gen_ai.* span by
 * `claude-code-log-to-span.ts`, then dropped from the log path. The
 * existing span pipeline + canonicalisation + fold lift model / tokens /
 * cost / input / output from that span. This extractor therefore only
 * sees the lifecycle/prompt events that stay on the log path.
 *
 * Detection: log record scope matches CLAUDE_CODE_SCOPE_NAMES and
 *            attributes["event.name"] === "user_prompt".
 *
 * Canonical attributes produced (when present on the wire):
 * - langwatch.input      (user_prompt — from `prompt` attr, only when
 *                         OTEL_LOG_USER_PROMPTS=1)
 * - langwatch.thread.id  (user_prompt — from session.id)
 *
 * Span-side `apply()` is a no-op — Claude Code Path A claude_code traffic
 * comes through the gateway as gen_ai.* spans handled by GenAIExtractor,
 * and Path B model calls become synthesized gen_ai.* spans whose attrs are
 * already canonical.
 *
 * The body-parsing helpers (extractAssistantTextFromResponseBody,
 * extractUserTextFromRequestBody) and the isConversationalQuerySource gate
 * live here as the home of claude_code body knowledge and are imported by
 * the log-to-span converter. The langwatch wrapper sets all 4 OTEL_LOG_*
 * unlock knobs (USER_PROMPTS + TOOL_CONTENT + TOOL_DETAILS + RAW_API_BODIES)
 * so the converted spans carry input/output text on every turn.
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
 * Surfacing those as the span's `gen_ai.completion` would mislabel a throwaway
 * autosuggest as the assistant's reply. We therefore set completion text ONLY
 * for genuine conversation turns. The main REPL thread is the headline
 * conversation; an absent `query_source` is treated as conversational for
 * backwards-compat with older claude-code builds (and other emitters) that
 * don't stamp the field. The token/cost usage of utility calls still folds —
 * only their TEXT is withheld from the completion.
 */
const CONVERSATIONAL_QUERY_SOURCES: ReadonlySet<string> = new Set([
  "repl_main_thread",
]);

/**
 * True when an `api_response_body` came from a genuine conversation turn whose
 * text is the assistant's reply to the user — as opposed to a non-conversational
 * utility call (see CONVERSATIONAL_QUERY_SOURCES). An absent query_source is
 * treated as conversational for backwards-compat. Exported so the log-to-span
 * converter gates the synthesized span's gen_ai.completion through this exact
 * allowlist instead of duplicating it.
 */
export const isConversationalQuerySource = (
  querySource: string | null,
): boolean =>
  querySource === null || CONVERSATIONAL_QUERY_SOURCES.has(querySource);

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

    // The model-call events (api_request / api_request_body /
    // api_response_body) are trapped at ingest and converted to a gen_ai
    // span by claude-code-log-to-span.ts — they never reach the log path,
    // so the only claude_code event this extractor lifts is user_prompt.
    if (eventName === "user_prompt") {
      this.liftUserPrompt(ctx);
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
    if (fired) ctx.recordRule("claude-code/user_prompt");
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

/**
 * Walk a claude_code.api_request_body JSON payload (the Anthropic
 * /v1/messages REQUEST) and pull out the latest user turn's text — the
 * span's gen_ai.prompt. The body shape:
 *   { "model": "...", "system": "...", "messages": [
 *       { "role": "user", "content": "..." },
 *       { "role": "assistant", "content": [{ "type": "text", "text": "..." }] },
 *       { "role": "user", "content": [{ "type": "text", "text": "..." }] }
 *     ] }
 *
 * `content` is either a plain string or an array of content blocks. We take
 * the LAST `role === "user"` message (the current turn's input) and
 * concatenate its text. Returns null when the body isn't parseable (claude
 * truncates large request bodies inline, so the caller falls back to the raw
 * capped body), has no messages, or the last user message has no text.
 *
 * Pure extraction — the caller bounds the result with capPayloadString.
 *
 * @internal exported for the log-to-span converter + unit testing
 */
/**
 * Flatten one Anthropic message `content` (string OR array of content blocks)
 * to display text. Text + tool_result blocks contribute their text; tool_use
 * blocks render as a compact `[tool_use: name]` marker so the turn reads as a
 * conversation rather than raw JSON; thinking blocks are redacted by Anthropic
 * and images carry no text, so both are dropped.
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      if (block.length > 0) parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const b = block as {
      type?: unknown;
      text?: unknown;
      name?: unknown;
      content?: unknown;
    };
    if (b.type === "text" && typeof b.text === "string") {
      if (b.text.length > 0) parts.push(b.text);
    } else if (b.type === "tool_result") {
      const nested = contentToText(b.content);
      if (nested.length > 0) parts.push(nested);
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      parts.push(`[tool_use: ${b.name}]`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Parse a claude_code.api_request_body JSON payload (the Anthropic
 * /v1/messages REQUEST) into the canonical `gen_ai.input.messages` chat array:
 * the system prompt (when present) followed by every turn as `{ role, content }`
 * with each message's content flattened to text via {@link contentToText}.
 *
 * This is what makes the trace detail render a real multi-turn conversation
 * instead of a single user message holding the raw request JSON — the failure
 * mode when the converter fell back to the raw body blob. Returns null when the
 * body isn't parseable (claude truncates large bodies inline, so the caller
 * falls back to the clean `user_prompt` text), has no `messages` array, or every
 * turn flattened to empty.
 *
 * @internal exported for the log-to-span converter + unit testing
 */
export function buildInputMessagesFromRequestBody(
  raw: unknown,
): Array<{ role: string; content: string }> | null {
  if (raw === null || raw === undefined) return null;
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
  const obj = parsed as { system?: unknown; messages?: unknown };
  if (!Array.isArray(obj.messages)) return null;

  const out: Array<{ role: string; content: string }> = [];

  if (obj.system !== undefined) {
    const systemText = contentToText(obj.system);
    if (systemText.length > 0) {
      out.push({ role: "system", content: systemText });
    }
  }

  for (const m of obj.messages) {
    if (!m || typeof m !== "object") continue;
    const message = m as { role?: unknown; content?: unknown };
    const role = typeof message.role === "string" ? message.role : "user";
    const content = contentToText(message.content);
    if (content.length === 0) continue;
    out.push({ role, content });
  }

  return out.length > 0 ? out : null;
}

export function extractUserTextFromRequestBody(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
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
  const messages = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;

  let lastUserContent: unknown = null;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const message = m as { role?: unknown; content?: unknown };
    if (message.role === "user") lastUserContent = message.content;
  }
  if (lastUserContent === null) return null;

  if (typeof lastUserContent === "string") {
    return lastUserContent.length > 0 ? lastUserContent : null;
  }
  if (!Array.isArray(lastUserContent)) return null;
  const parts: string[] = [];
  for (const c of lastUserContent) {
    if (!c || typeof c !== "object") continue;
    const block = c as { type?: unknown; text?: unknown };
    if (block.type !== "text") continue;
    if (typeof block.text !== "string") continue;
    if (block.text.length === 0) continue;
    parts.push(block.text);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}
