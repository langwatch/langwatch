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
import { topLevelKeyIndex } from "../../block-classification/claudeCodeBody";

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
 * Parse a string-or-already-parsed JSON body into an object. The upstream
 * attribute bag (`parseJsonStringValues`) eagerly JSON.parses string
 * attributes that look like JSON, so a body attribute can arrive as either a
 * raw string OR a pre-parsed object — accept both. Returns null when absent or
 * unparseable (claude truncates large bodies inline, making them invalid JSON).
 */
function parseJsonBody(raw: unknown): Record<string, unknown> | null {
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
  return parsed as Record<string, unknown>;
}

/**
 * The assistant's reply for a model call's span OUTPUT, rendered from its
 * api_response_body. Unlike {@link extractAssistantTextFromResponseBody} (the
 * headline path, text only), this includes `tool_use` blocks so a model call
 * whose reply IS a tool invocation still shows what it did: the call that
 * decided to run Bash renders `[tool_use: Bash]` plus the command instead of an
 * empty output. Text and tool_use blocks are concatenated in wire order.
 *
 * Used only for the synthesized span's `gen_ai.completion`; the trace headline
 * keeps the text-only extractor so a tool-deciding turn's headline stays the
 * final text reply, not a tool marker.
 *
 * @internal exported for the log-to-span converter + unit testing
 */
export function extractAssistantOutputFromResponseBody(
  raw: unknown,
): string | null {
  const parsed = parseJsonBody(raw);
  if (!parsed) return null;
  const content = parsed.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const block = c as {
      type?: unknown;
      text?: unknown;
      name?: unknown;
      input?: unknown;
    };
    if (block.type === "text") {
      if (typeof block.text === "string" && block.text.length > 0) {
        parts.push(block.text);
      }
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      const args =
        block.input !== undefined && block.input !== null
          ? safeStringify(block.input)
          : "";
      parts.push(
        args
          ? `[tool_use: ${block.name}]\n${args}`
          : `[tool_use: ${block.name}]`,
      );
    }
  }
  if (parts.length === 0) return null;
  return capPayloadString(parts.join("\n\n"), undefined, "assistant_output");
}

/**
 * Recover the tool RESULTS fed back to the model from an api_request_body
 * conversation. Claude Code's telemetry never carries a tool's stdout (see
 * project_claude_tool_output_no_env_var) — the only place a tool's output
 * appears is the NEXT model call's request body, where the result is sent back
 * as a `tool_result` content block keyed by `tool_use_id`. Returns a map from
 * `tool_use_id` to its flattened result text so the converter can attach each
 * tool's output to the matching tool span. The first occurrence of a given
 * `tool_use_id` wins (the result is identical in every later turn that echoes
 * the conversation).
 *
 * Claude truncates a large request body INLINE at ~60KB (`body_truncated=true`),
 * so on a real tool-using turn the whole body does NOT JSON.parse — its tail
 * (the most recent tool_result) is cut. So this falls back to a string-aware
 * brace scan that recovers every COMPLETE tool_result block present before the
 * truncation point and skips the cut-off trailing one. The real wire shape is
 * `{"tool_use_id":"…","type":"tool_result","content":"…"|[…],"is_error":bool}`,
 * with `content` a plain string (Bash) or an array of blocks (Read, etc.) —
 * {@link contentToText} flattens both.
 *
 * @internal exported for the log-to-span converter + unit testing
 */
export function collectToolResultsFromRequestBody(
  raw: unknown,
): Map<string, string> {
  const out = new Map<string, string>();
  const parsed = parseJsonBody(raw);
  if (parsed && Array.isArray(parsed.messages)) {
    // Clean path: the body parsed whole (short turn, not truncated).
    for (const m of parsed.messages) {
      if (!m || typeof m !== "object") continue;
      collectToolResultBlocks((m as { content?: unknown }).content, out);
    }
    return out;
  }
  // Truncated body: scan the raw string for complete tool_result objects.
  if (typeof raw === "string" && raw.length > 0) {
    scanToolResultsFromTruncatedBody(raw, out);
  }
  return out;
}

/** Record any `tool_result` blocks in a message `content` array into `out`. */
function collectToolResultBlocks(
  content: unknown,
  out: Map<string, string>,
): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as {
      type?: unknown;
      tool_use_id?: unknown;
      content?: unknown;
    };
    if (b.type !== "tool_result") continue;
    if (typeof b.tool_use_id !== "string" || b.tool_use_id.length === 0) {
      continue;
    }
    if (out.has(b.tool_use_id)) continue;
    const text = contentToText(b.content);
    if (text.length > 0) out.set(b.tool_use_id, text);
  }
}

/**
 * String-aware brace scan that pulls every COMPLETE `{…}` object out of a
 * (possibly truncated) JSON body and records the ones that are `tool_result`
 * blocks. An object whose closing brace was cut by truncation never balances,
 * so it is simply never recorded — which is the right behaviour: a truncated
 * result has no recoverable text. Tracks string/escape state so braces inside
 * string values do not corrupt the depth count.
 */
function scanToolResultsFromTruncatedBody(
  raw: string,
  out: Map<string, string>,
): void {
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push(i);
    else if (ch === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      // Only attempt the ones that could be a tool_result block (innermost
      // pops first, so the block itself is tried before its enclosing message).
      const slice = raw.slice(start, i + 1);
      if (!slice.includes('"tool_result"')) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(slice);
      } catch {
        continue;
      }
      if (!obj || typeof obj !== "object") continue;
      const b = obj as {
        type?: unknown;
        tool_use_id?: unknown;
        content?: unknown;
      };
      if (b.type !== "tool_result") continue;
      if (typeof b.tool_use_id !== "string" || b.tool_use_id.length === 0) {
        continue;
      }
      if (out.has(b.tool_use_id)) continue;
      const text = contentToText(b.content);
      if (text.length > 0) out.set(b.tool_use_id, text);
    }
  }
}

/** JSON.stringify that never throws on a circular/odd value. */
function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
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
  return buildInputMessagesFromRequestBodyDetailed(raw).messages;
}

/**
 * Like {@link buildInputMessagesFromRequestBody}, but also reports whether the
 * truncation-recovery path was taken (`recovered`). Callers that reinstate the
 * fresh user turn must gate on THIS rather than the `body_truncated` attribute:
 * a body over LangWatch's own oversize cap fails JSON.parse the same way, but
 * claude never stamped `body_truncated` on it.
 */
export function buildInputMessagesFromRequestBodyDetailed(raw: unknown): {
  messages: Array<{ role: string; content: string }> | null;
  recovered: boolean;
} {
  if (raw === null || raw === undefined) {
    return { messages: null, recovered: false };
  }
  if (typeof raw === "object") {
    return { messages: buildFromParsedRequestBody(raw), recovered: false };
  }
  if (typeof raw !== "string" || raw.length === 0) {
    return { messages: null, recovered: false };
  }
  try {
    return {
      messages: buildFromParsedRequestBody(JSON.parse(raw)),
      recovered: false,
    };
  } catch {
    // claude truncates large request bodies INLINE at ~60KB, so a real
    // coding-agent turn (system + tools + history) does NOT JSON.parse. Rather
    // than falling back to just the latest user turn — which strands the whole
    // cached prefix (system prompt + tool defs), leaving the cost classifier to
    // dump those tokens into `other_input` — recover what survived the cut.
    // Truncation always removes the TAIL, so the front-loaded system prompt and
    // the complete leading turns are intact.
    return {
      messages: recoverInputMessagesFromTruncatedBody(raw),
      recovered: true,
    };
  }
}

/** Build the canonical input-message array from an already-parsed request body. */
function buildFromParsedRequestBody(
  parsed: unknown,
): Array<{ role: string; content: string }> | null {
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

/**
 * Recover input messages from a body claude truncated inline (invalid JSON).
 * Best-effort, string-aware: pulls the `system` value (string or content-block
 * array) plus every COMPLETE `{ role, content }` message object present before
 * the truncation point. An incompletely-written trailing object never balances,
 * so it is simply skipped. Returns null when nothing usable survives (caller
 * then falls back to the clean co-located `user_prompt`).
 *
 * @internal exported for unit testing only
 */
export function recoverInputMessagesFromTruncatedBody(
  raw: string,
): Array<{ role: string; content: string }> | null {
  const out: Array<{ role: string; content: string }> = [];

  const systemText = recoverSystemText(raw);
  if (systemText && systemText.length > 0) {
    out.push({ role: "system", content: systemText });
  }

  const messagesKey = topLevelKeyIndex(raw, "messages");
  if (messagesKey >= 0) {
    const arrayStart = raw.indexOf("[", messagesKey);
    if (arrayStart >= 0) {
      for (const slice of completeObjectSlices(raw, arrayStart + 1)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(slice);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const message = parsed as { role?: unknown; content?: unknown };
        const role = typeof message.role === "string" ? message.role : "user";
        const content = contentToText(message.content);
        if (content.length === 0) continue;
        out.push({ role, content });
      }
    }
  }

  return out.length > 0 ? out : null;
}

/**
 * Recover the `system` field's text from a truncated body. Anthropic sends
 * `system` as a string OR an array of `{ type: "text", text }` blocks (with
 * cache_control); both shapes are handled. When the value is an array, complete
 * blocks are flattened even if the array itself was cut off before its closing
 * `]`. Returns null when no `system` value is present or nothing parses.
 */
function recoverSystemText(raw: string): string | null {
  const key = topLevelKeyIndex(raw, "system");
  if (key < 0) return null;
  let i = raw.indexOf(":", key);
  if (i < 0) return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i]!)) i++;
  if (i >= raw.length) return null;

  if (raw[i] === '"') {
    return readJsonStringAt(raw, i);
  }
  if (raw[i] === "[") {
    const parts: string[] = [];
    for (const slice of completeObjectSlices(raw, i + 1)) {
      try {
        const block = JSON.parse(slice);
        const text = contentToText([block]);
        if (text.length > 0) parts.push(text);
      } catch {
        // skip a block that didn't parse
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  return null;
}

/**
 * Read a complete JSON string literal starting at `quoteIndex` (which must point
 * at the opening `"`), honouring escapes. Returns the unescaped value, or null
 * when the string was cut off by truncation (no closing quote).
 */
function readJsonStringAt(raw: string, quoteIndex: number): string | null {
  let esc = false;
  for (let i = quoteIndex + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      try {
        return JSON.parse(raw.slice(quoteIndex, i + 1)) as string;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Yield every COMPLETE, balanced top-level `{…}` object slice at/after
 * `fromIndex`, tracking string/escape state so braces inside string values do
 * not corrupt the depth count. Stops at the first depth-0 `]` (the end of the
 * enclosing array) so a scan seeded at a `messages`/`system` array does not
 * bleed into sibling fields. A trailing object cut off by truncation never
 * balances and is never yielded.
 */
function* completeObjectSlices(
  raw: string,
  fromIndex: number,
): Generator<string> {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = fromIndex; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          yield raw.slice(start, i + 1);
          start = -1;
        }
      }
    } else if (ch === "]" && depth === 0) {
      return;
    }
  }
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
