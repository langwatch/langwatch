/**
 * Ingest-time derivation of the useful content out of raw LLM API bodies.
 *
 * An emitter that logs its raw provider request/response (Claude Code's
 * `OTEL_LOG_RAW_API_BODIES=1` is the canonical case) ships a 60 KB JSON blob per
 * model call. Everything downstream wants the same few things out of it — the
 * assistant's text, which tools it called, why it stopped — and today EVERY
 * consumer re-parses that blob to get them: the write-time fold does it, and the
 * read-time span enrichment does it again on every single drawer open.
 *
 * So we do it ONCE, here, at ingest, and stamp the result onto the log record's
 * attributes. Two things fall out:
 *
 * 1. Reads get cheap. The fold and the span enrichment read a small string
 *    attribute instead of parsing a blob.
 * 2. The data becomes QUERYABLE. Log attributes are a plain `Map(String,String)`
 *    in ClickHouse, so "which tools does this project call most", "how often does
 *    Claude stop on max_tokens" become ordinary queries — no bespoke
 *    product-specific table needed.
 *
 * The attribute names are deliberately GENERIC (`langwatch.gen_ai.*`), not
 * Claude-shaped: any emitter that logs an Anthropic/OpenAI-style body can be
 * given a derivation here and every consumer reads the same keys. The
 * `langwatch.` prefix marks them as ours — derived — so they can never be
 * confused with what the emitter actually put on the wire.
 *
 * Best-effort by construction: a body that is absent, truncated (Claude caps at
 * 60 KB, which breaks the JSON) or simply unparseable yields no derived
 * attributes, and every consumer still has its existing fallback path.
 */
import {
  buildInputMessagesFromRequestBody,
  extractAssistantTextFromResponseBody,
} from "./canonicalisation/extractors/claudeCode";

/** The scope Claude Code's log events arrive under. */
const CLAUDE_CODE_EVENTS_SCOPE = "com.anthropic.claude_code.events";

const REQUEST_BODY_EVENT = "api_request_body";
const RESPONSE_BODY_EVENT = "api_response_body";

/**
 * Derived attribute keys. Generic across emitters — a consumer reads these
 * without knowing (or caring) which coding agent produced the log.
 */
export const DERIVED_ATTRS = {
  /** The assistant's reply text, concatenated from the response's text blocks. */
  OUTPUT_TEXT: "langwatch.gen_ai.output.text",
  /** The tools the assistant asked for, as `[{"id","name"}]` JSON. */
  OUTPUT_TOOL_CALLS: "langwatch.gen_ai.output.tool_calls",
  /** Convenience for aggregation — how many tools this call asked for. */
  OUTPUT_TOOL_CALL_COUNT: "langwatch.gen_ai.output.tool_call_count",
  /** Why the model stopped: end_turn | tool_use | max_tokens | refusal | … */
  STOP_REASON: "langwatch.gen_ai.response.stop_reason",
  /** How many messages of rolling history this call carried. */
  INPUT_MESSAGE_COUNT: "langwatch.gen_ai.input.message_count",
} as const;

/**
 * Prefixes grouping the derived attrs by the captured-content category they
 * are computed FROM. The API's log redaction strips attributes by these
 * prefixes when the matching category is hidden from the viewer — derived
 * text is captured content too, just re-shaped at ingest. `STOP_REASON`
 * (`langwatch.gen_ai.response.*`) sits outside both prefixes on purpose:
 * like `cost_usd`, it is operational metadata, not content.
 */
export const DERIVED_INPUT_ATTR_PREFIX = "langwatch.gen_ai.input.";
export const DERIVED_OUTPUT_ATTR_PREFIX = "langwatch.gen_ai.output.";

/** A single tool the assistant asked for. */
interface DerivedToolCall {
  id: string;
  name: string;
}

/**
 * Attributes to merge onto a log record at ingest. Empty for any record we have
 * no derivation for — the caller merges unconditionally and pays nothing.
 */
export function deriveLogContentAttributes({
  scopeName,
  attributes,
}: {
  scopeName: string;
  attributes: Record<string, string>;
}): Record<string, string> {
  if (scopeName !== CLAUDE_CODE_EVENTS_SCOPE) return {};

  const eventName = attributes["event.name"];
  const body = attributes.body;
  if (typeof body !== "string" || body.length === 0) return {};

  if (eventName === RESPONSE_BODY_EVENT) {
    return deriveFromResponseBody(body);
  }
  if (eventName === REQUEST_BODY_EVENT) {
    return deriveFromRequestBody(body);
  }
  return {};
}

function deriveFromResponseBody(body: string): Record<string, string> {
  const derived: Record<string, string> = {};

  // Reuse the canonical extractor rather than re-walking `content[]` here — it
  // already handles the truncation-tolerant cases.
  const text = extractAssistantTextFromResponseBody(body);
  if (text !== null && text.length > 0) {
    derived[DERIVED_ATTRS.OUTPUT_TEXT] = text;
  }

  const parsed = parseJsonObject(body);
  if (parsed === null) return derived;

  const toolCalls = readToolCalls(parsed.content);
  if (toolCalls.length > 0) {
    derived[DERIVED_ATTRS.OUTPUT_TOOL_CALLS] = JSON.stringify(toolCalls);
    derived[DERIVED_ATTRS.OUTPUT_TOOL_CALL_COUNT] = String(toolCalls.length);
  }

  const stopReason = parsed.stop_reason;
  if (typeof stopReason === "string" && stopReason.length > 0) {
    derived[DERIVED_ATTRS.STOP_REASON] = stopReason;
  }

  return derived;
}

function deriveFromRequestBody(body: string): Record<string, string> {
  const messages = buildInputMessagesFromRequestBody(body);
  if (messages === null || messages.length === 0) return {};
  return {
    [DERIVED_ATTRS.INPUT_MESSAGE_COUNT]: String(messages.length),
  };
}

/**
 * The `tool_use` blocks in an Anthropic response's `content[]`. The tool's
 * `input` is deliberately NOT lifted: it is unbounded (a Write tool's input is
 * an entire file), it already rides the raw body, and the tool's real arguments
 * are on its own span. What we want here is the cheap, queryable shape — which
 * tools, how many.
 */
function readToolCalls(content: unknown): DerivedToolCall[] {
  if (!Array.isArray(content)) return [];

  const calls: DerivedToolCall[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    const name = typeof b.name === "string" ? b.name : null;
    if (name === null) continue;
    calls.push({ id: typeof b.id === "string" ? b.id : "", name });
  }
  return calls;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Claude truncates oversized bodies inline, which leaves invalid JSON. That
    // is expected, not exceptional — the text extractor above is
    // truncation-tolerant and consumers keep their fallbacks.
    return null;
  }
}

export type { DerivedToolCall };
