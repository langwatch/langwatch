/**
 * Claude Code Extractor
 *
 * Log side handles: the `user_prompt` log event of Anthropic Claude Code's
 * native OpenTelemetry log records (scope `com.anthropic.claude_code.events`),
 * lifting the user-typed prompt onto `langwatch.input` so the trace
 * summary headline input is populated. It is the only claude_code event
 * this extractor lifts; the model-call events (`api_request`,
 * `api_request_body`, `api_response_body`) stay on the log path untouched
 * by this extractor and are consumed downstream by the trace I/O fold and
 * the ingest-time body derivation (see log-content-derivation.ts).
 *
 * Detection: log record scope matches CLAUDE_CODE_SCOPE_NAMES and
 *            attributes["event.name"] === "user_prompt".
 *
 * Canonical attributes produced (when present on the wire):
 * - langwatch.input      (user_prompt — from `prompt` attr, only when
 *                         OTEL_LOG_USER_PROMPTS=1)
 * - langwatch.thread.id  (user_prompt — from session.id)
 *
 * Span side handles: Claude Code's native `claude_code.llm_request` span.
 * This is the CLI's own OTel exporter, a different wire than gateway-proxied
 * traffic — the gateway re-emits gen_ai.* semconv spans (GenAIExtractor's
 * job), but the CLI's native span carries model/token usage under bare,
 * un-prefixed attribute names (`model`, `input_tokens`, `output_tokens`,
 * `cache_read_tokens`, `cache_creation_tokens`). Nothing lifted these onto
 * canonical gen_ai.usage.* attributes before, so SpanCostService (which only
 * reads the canonical names) saw no tokens for a native Claude Code trace —
 * trace.totalCost / totalPromptTokenCount / totalCompletionTokenCount came up
 * empty everywhere that reads canonical attrs (trace list, drawer header,
 * cost tooltips), even though the coding-agent-specific session/terminal
 * derivations (which read the bare names directly) were unaffected.
 *
 * The body-parsing helpers (extractAssistantTextFromResponseBody,
 * extractAssistantOutputFromResponseBody, buildInputMessagesFromRequestBody)
 * and the isConversationalQuerySource gate live here as the home of
 * claude_code body knowledge, and are imported by the ingest-time derivation
 * and the read-time span enrichment. The langwatch wrapper sets all 4
 * OTEL_LOG_* unlock knobs (USER_PROMPTS + TOOL_CONTENT + TOOL_DETAILS +
 * RAW_API_BODIES) so the bodies carry input/output text on every turn.
 */

import { capPayloadString } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedLogRecord";

import { ATTR_KEYS } from "./_constants";
import { asNumber } from "./_guards";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const CLAUDE_CODE_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "com.anthropic.claude_code.events",
]);

/** The CLI's own native model-call span — see the span-side doc above. */
const LLM_REQUEST_SPAN_NAME = "claude_code.llm_request";

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
 * treated as conversational for backwards-compat. Exported so the trace I/O
 * fold gates the trace's output text through this exact allowlist instead of
 * duplicating it.
 */
export const isConversationalQuerySource = (
  querySource: string | null,
): boolean =>
  querySource === null || CONVERSATIONAL_QUERY_SOURCES.has(querySource);

const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export class ClaudeCodeExtractor implements CanonicalAttributesExtractor {
  readonly id = "claude-code";

  apply(ctx: ExtractorContext): void {
    // Gateway-proxied claude_code traffic already arrives as gen_ai.* spans
    // (GenAIExtractor's job) — only the CLI's own native span needs lifting.
    if (ctx.span.name !== LLM_REQUEST_SPAN_NAME) return;

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
    liftNumber(
      "cache_read_tokens",
      ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
    );
    liftNumber(
      "cache_creation_tokens",
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
    );

    const model = attrs.get("model");
    if (typeof model === "string" && model.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model);
      fired = true;
    }

    if (fired) ctx.recordRule("claude-code/llm_request");
  }

  applyLog(ctx: LogExtractorContext): void {
    if (!CLAUDE_CODE_SCOPE_NAMES.has(ctx.bag.scopeName)) return;
    const eventName = ctx.bag.attrs.get("event.name");

    // The model-call events (api_request / api_request_body /
    // api_response_body) are folded downstream from the log path itself,
    // not lifted here — the only claude_code event this extractor lifts
    // onto canonical attributes is user_prompt.
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
 * The assistant's reply for a model call, rendered from its api_response_body.
 * Unlike {@link extractAssistantTextFromResponseBody} (the headline path, text
 * only), this includes `tool_use` blocks so a model call whose reply IS a tool
 * invocation still shows what it did: the call that decided to run Bash renders
 * `[tool_use: Bash]` plus the command instead of an empty output. Text and
 * tool_use blocks are concatenated in wire order.
 *
 * The trace headline keeps the text-only extractor so a tool-deciding turn's
 * headline stays the final text reply, not a tool marker.
 *
 * @internal exported for unit testing
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

/** JSON.stringify that never throws on a circular/odd value. */
function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}

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
 * Harvest tool RESULT content out of an `api_request_body` payload.
 *
 * Claude's telemetry never ships tool stdout on the `tool_result` event (it
 * carries sizes only) — the actual result text appears one turn LATER, as the
 * `tool_result` content blocks of the NEXT model call's request body, keyed by
 * `tool_use_id`. With `OTEL_LOG_RAW_API_BODIES=1` those bodies are in the
 * trace's logs, so a read-time join can put the real output back on the tool
 * span. Returns `tool_use_id` → flattened content text for every tool_result
 * block found; empty map when the body is unparseable or has none.
 *
 * @internal exported for the read-time tool-span enrichment + unit testing
 */
export function extractToolResultsFromRequestBody(
  raw: unknown,
): Map<string, string> {
  const out = new Map<string, string>();
  if (raw === null || raw === undefined) return out;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length === 0) return out;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (!parsed || typeof parsed !== "object") return out;
  const obj = parsed as { messages?: unknown };
  if (!Array.isArray(obj.messages)) return out;
  for (const m of obj.messages) {
    if (!m || typeof m !== "object") continue;
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as {
        type?: unknown;
        tool_use_id?: unknown;
        content?: unknown;
      };
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") {
        continue;
      }
      if (out.has(b.tool_use_id)) continue;
      const text = contentToText(b.content);
      if (text.length > 0) {
        out.set(
          b.tool_use_id,
          capPayloadString(text, undefined, "tool_result"),
        );
      }
    }
  }
  return out;
}

/**
 * Parse a claude_code.api_request_body JSON payload (the Anthropic
 * /v1/messages REQUEST) into the canonical `gen_ai.input.messages` chat array:
 * the system prompt (when present) followed by every turn as `{ role, content }`
 * with each message's content flattened to text via {@link contentToText}.
 *
 * This is what makes the trace detail render a real multi-turn conversation
 * instead of a single user message holding the raw request JSON. Returns null
 * when the body isn't parseable (claude truncates large bodies inline, so the
 * caller falls back to the clean `user_prompt` text), has no `messages` array,
 * or every turn flattened to empty.
 *
 * @internal exported for the ingest-time body derivation + unit testing
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
