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
  // `claude -p` / Agent SDK sessions stamp every conversational turn with
  // query_source "sdk", there is no repl thread. Without this, an SDK-driven
  // session's reply never reaches the trace headline output ("no output
  // recorded" on every -p trace). The utility calls this allowlist exists to
  // exclude (prompt_suggestion, generate_session_title, quota) keep their own
  // distinct sources either way.
  "sdk",
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
    if (!isConversationalQuerySource(querySource)) return;
    const effort = asString(ctx.bag.attrs.get("effort"));
    if (effort === null) return;
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
    if (usage === null) return;
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
  // api_response_body inline at ~60KB upstream. This cap bounds the
  // ComputedOutput / langwatch.output value specifically, in case
  // a future claude release lifts the 60KB inline cap or a different
  // emitter ships an api_response_body without one.
  return capPayloadString(parts.join("\n\n"), undefined, "assistant_output");
}

/**
 * Anthropic's per-TTL cache-write split out of a response body's usage:
 * `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`.
 * Returns null when the body is unparseable or carries no split (older API
 * responses report only the flat cache_creation_input_tokens total).
 *
 * @internal exported for unit testing
 */
export function extractCacheCreationTtlSplit(raw: unknown): {
  ephemeral5mInputTokens: number;
  ephemeral1hInputTokens: number;
} | null {
  const parsed = parseJsonBody(raw);
  if (!parsed) return null;
  const usage = parsed.usage;
  if (!usage || typeof usage !== "object") return null;
  const cacheCreation = (usage as { cache_creation?: unknown }).cache_creation;
  if (!cacheCreation || typeof cacheCreation !== "object") return null;
  const split = cacheCreation as {
    ephemeral_5m_input_tokens?: unknown;
    ephemeral_1h_input_tokens?: unknown;
  };
  const fiveMinute = asNumber(split.ephemeral_5m_input_tokens) ?? 0;
  const oneHour = asNumber(split.ephemeral_1h_input_tokens) ?? 0;
  if (fiveMinute <= 0 && oneHour <= 0) return null;
  return {
    ephemeral5mInputTokens: fiveMinute,
    ephemeral1hInputTokens: oneHour,
  };
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
      // claude caps the body at ~60KB inline, cutting the JSON mid-string -
      // and Anthropic's request layout puts `system` and `tools` AFTER the
      // rolling message history, so the cut destroys exactly the context the
      // reader most wants. Salvage every complete leading message plus
      // whatever of the system prompt survived, instead of throwing the body
      // away (which used to collapse the whole input to the bare user_prompt).
      return salvageTruncatedRequestBody(raw);
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as {
    system?: unknown;
    messages?: unknown;
    tools?: unknown;
  };
  if (!Array.isArray(obj.messages)) return null;

  const out: Array<{ role: string; content: string }> = [];

  if (obj.system !== undefined) {
    const systemText = contentToText(obj.system);
    if (systemText.length > 0) {
      out.push({ role: "system", content: systemText });
    }
  }

  const toolsMessage = toolDefinitionsMessage(obj.tools);
  if (toolsMessage !== null) out.push(toolsMessage);

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
 * The request's tool definitions as a compact system-side message: name and
 * first description line per tool. This is where MCP servers and skills show
 * up in what the session actually pays for, a request with 40 tools is 40
 * schemas of context on every call, and until now the whole array was
 * silently dropped.
 */
function toolDefinitionsMessage(
  tools: unknown,
): { role: string; content: string } | null {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  const lines: string[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const t = tool as { name?: unknown; description?: unknown };
    if (typeof t.name !== "string" || t.name.length === 0) continue;
    const description =
      typeof t.description === "string"
        ? (t.description.split("\n", 1)[0] ?? "").trim()
        : "";
    lines.push(description ? `${t.name}: ${description}` : t.name);
  }
  if (lines.length === 0) return null;
  return {
    role: "system",
    content: capPayloadString(
      `[tools available: ${lines.length}]\n${lines.join("\n")}`,
      undefined,
      "tool_definitions",
    ),
  };
}

/** claude appends this marker where it cut an oversized inline body. */
const CLAUDE_TRUNCATION_MARKER = /\s*\[TRUNCATED - [^\]]*\]\s*$/;

/**
 * Best-effort parse of a request body claude cut mid-JSON: a single scanner
 * pass finds the complete leading `messages` elements and the `system` /
 * `tools` values (whole or partial), and rebuilds the same message array the
 * intact path produces. Partial system text is kept and marked, for a
 * session past ~60KB of history the head of the system prompt is all that
 * survives the cap, and it is still what identifies the session's context.
 *
 * @internal exported for unit testing
 */
export function salvageTruncatedRequestBody(
  raw: string,
): Array<{ role: string; content: string }> | null {
  const trimmed = raw.replace(CLAUDE_TRUNCATION_MARKER, "");
  const out: Array<{ role: string; content: string }> = [];

  const system = salvageTopLevelValue(trimmed, "system");
  if (system !== null) {
    const systemText = system.complete
      ? contentToText(safeParse(system.slice) ?? system.slice)
      : salvagePartialText(system.slice);
    if (systemText && systemText.length > 0) {
      out.push({
        role: "system",
        content: system.complete
          ? systemText
          : `${systemText}\n\n[system prompt truncated by claude's 60KB telemetry cap]`,
      });
    }
  }

  const tools = salvageTopLevelValue(trimmed, "tools");
  if (tools !== null) {
    const parsedTools = tools.complete
      ? safeParse(tools.slice)
      : salvageCompleteArrayElements(tools.slice);
    const toolsMessage = toolDefinitionsMessage(parsedTools);
    if (toolsMessage !== null) out.push(toolsMessage);
  }

  const messages = salvageTopLevelValue(trimmed, "messages");
  let truncatedMidMessages = false;
  if (messages !== null) {
    const parsedMessages = messages.complete
      ? safeParse(messages.slice)
      : salvageCompleteArrayElements(messages.slice);
    truncatedMidMessages = !messages.complete;
    if (Array.isArray(parsedMessages)) {
      for (const m of parsedMessages) {
        if (!m || typeof m !== "object") continue;
        const message = m as { role?: unknown; content?: unknown };
        const role = typeof message.role === "string" ? message.role : "user";
        const content = contentToText(message.content);
        if (content.length === 0) continue;
        out.push({ role, content });
      }
    }
  }

  if (out.length === 0) return null;
  if (truncatedMidMessages || system === null || !system.complete) {
    out.push({
      role: "system",
      content:
        "[request body truncated by claude's 60KB telemetry cap, later turns and remaining context omitted]",
    });
  }
  return out;
}

function safeParse(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

interface SalvagedValue {
  /** The raw character span of the value (complete or cut). */
  slice: string;
  /** Whether the value closed before the cut. */
  complete: boolean;
}

/**
 * Single-pass scan for a top-level key's value span in (possibly cut) JSON.
 * Tracks string/escape state and bracket depth; never allocates a parse tree,
 * so a 60KB body costs one linear pass per key.
 */
function salvageTopLevelValue(raw: string, key: string): SalvagedValue | null {
  const needle = `"${key}":`;
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      // Only a depth-1 position can start a top-level key.
      if (depth === 1 && raw.startsWith(needle, i)) {
        const valueStart = i + needle.length;
        return scanValueSpan(raw, valueStart);
      }
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return null;
}

/** The span of one JSON value starting at `start`, or its cut prefix. */
function scanValueSpan(raw: string, start: number): SalvagedValue {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let began = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        if (depth === 0) {
          return { slice: raw.slice(start, i + 1), complete: true };
        }
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      began = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      began = true;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return { slice: raw.slice(start, i + 1), complete: true };
      }
    } else if (depth === 0 && began && (ch === "," || ch === "}")) {
      // A bare scalar (number/true/false/null) ended.
      return { slice: raw.slice(start, i), complete: true };
    }
  }
  return { slice: raw.slice(start), complete: false };
}

/**
 * The complete leading elements of a CUT array literal, the elements that
 * closed before the truncation point parse individually; the cut one is
 * dropped.
 */
function salvageCompleteArrayElements(slice: string): unknown[] {
  const elements: unknown[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let elementStart = -1;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      if (depth === 2 && elementStart === -1) elementStart = i;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 1 && elementStart !== -1) {
        const parsed = safeParse(slice.slice(elementStart, i + 1));
        if (parsed !== null) elements.push(parsed);
        elementStart = -1;
      }
    }
  }
  return elements;
}

/**
 * The readable text out of a CUT string or content-block-array fragment:
 * for a string value the raw chars up to the cut (minus any dangling escape),
 * for an array of blocks the complete blocks' text plus the cut block's
 * partial `"text"` string.
 */
function salvagePartialText(slice: string): string | null {
  const fragment = slice.trimStart();
  if (fragment.startsWith('"')) {
    return decodePartialJsonString(fragment.slice(1));
  }
  if (fragment.startsWith("[")) {
    const complete = salvageCompleteArrayElements(fragment);
    const parts: string[] = [];
    const completeText = contentToText(complete);
    if (completeText.length > 0) parts.push(completeText);
    // The cut element's partial text, when the cut landed inside its "text".
    const lastTextKey = fragment.lastIndexOf('"text":');
    if (lastTextKey !== -1) {
      const afterKey = fragment
        .slice(lastTextKey + '"text":'.length)
        .trimStart();
      if (afterKey.startsWith('"') && !isClosedString(afterKey)) {
        const partial = decodePartialJsonString(afterKey.slice(1));
        if (partial && partial.length > 0) parts.push(partial);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  return null;
}

/** Whether a fragment starting at a quote closes its string. */
function isClosedString(fragment: string): boolean {
  let escaped = false;
  for (let i = 1; i < fragment.length; i++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    const ch = fragment[i];
    if (ch === "\\") escaped = true;
    else if (ch === '"') return true;
  }
  return false;
}

/**
 * Decode the content of a JSON string cut before its closing quote: drop a
 * dangling escape (`\` or incomplete `\uXX`), close the quote, parse.
 */
function decodePartialJsonString(content: string): string | null {
  let body = content;
  // An unescaped closing quote means the string actually completed.
  const closed = isClosedString(`"${body}`);
  if (closed) {
    const end = `"${body}`.indexOf('"', 1);
    body = `"${body}`.slice(1, end);
  }
  // Trim a trailing incomplete \uXXXX escape, then a trailing lone backslash.
  body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  let backslashes = 0;
  for (let i = body.length - 1; i >= 0 && body[i] === "\\"; i--) backslashes++;
  if (backslashes % 2 === 1) body = body.slice(0, -1);
  const parsed = safeParse(`"${body}"`);
  return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
}
