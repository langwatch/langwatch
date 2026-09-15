/**
 * The text half of trace IO extraction: what a span tree looks like, which spans never carry the
 * trace's own input or output, and how a payload of any of the shapes an SDK may send becomes the
 * one line a reader sees. Pure, so the traversal and its heuristics can be tested apart.
 */

import type { NormalizedSpan } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";

/**
 * Represents a span organized in a tree structure with its children.
 */
export interface SpanTreeNode {
  span: NormalizedSpan;
  children: SpanTreeNode[];
}

/**
 * Options for flattening a span tree.
 */
export type FlattenMode = "outside-in" | "inside-out";

/**
 * Extracted I/O result - can be either raw JSON or a text representation.
 */
export interface ExtractedIO {
  /** The raw attribute value as extracted from the source */
  raw: unknown;
  /** A text representation for display/search */
  text: string;
  /** Which attribute the value was extracted from */
  source: "langwatch" | "gen_ai";
}

export function getSpanType(span: NormalizedSpan): string {
  const type = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];

  return typeof type === "string" ? type : "unknown";
}

export function shouldExcludeSpan(span: NormalizedSpan): boolean {
  const type = getSpanType(span);

  return type === "evaluation" || type === "guardrail";
}

/**
 * Common keys that wrap a single text value in JSON payloads from various
 * frameworks (LangChain, Haystack, Flowise, Optimization Studio, etc.).
 * Order matters: first match wins.
 */
export const COMMON_TEXT_KEYS = [
  "text",
  "input",
  "question",
  "user_query",
  "query",
  "message",
  "input_value",
  "output",
  "answer",
  "content",
  "prompt",
] as const;

/**
 * Maximum recursion depth for plain-JSON text extraction. Guards against
 * pathological nesting (accidental or adversarial) — real-world payloads
 * rarely exceed a depth of ~4-5, so 32 is generous and still safe.
 */
export const MAX_PLAIN_JSON_RECURSION_DEPTH = 32;

/** The text one known key carries directly, or nothing when it carries none. */
function scalarText(val: unknown): string | null {
  if (typeof val === "string") return val.length > 0 ? val : null;
  if (typeof val === "number" || typeof val === "boolean") return String(val);

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The first of the known text keys that carries text, directly or one level down. */
function textFromCommonKeys(obj: Record<string, unknown>, depth: number): string | null {
  for (const key of COMMON_TEXT_KEYS) {
    const val = obj[key];
    if (val === undefined) continue;

    const scalar = scalarText(val);
    if (scalar !== null) return scalar;

    // Nested object with a known key (e.g. { inputs: { input: "hello" } })
    if (!isPlainObject(val)) continue;
    const nested = extractTextFromPlainJson(val, depth + 1);
    if (nested) return nested;
  }

  return null;
}

/**
 * The single-key wrapper fallback: many frameworks emit the real payload under an arbitrary
 * wrapper key like `{ data: {…} }`, `{ result: {…} }`, `{ response: {…} }`. Recursing into the
 * inner object gives the known-key scan a chance to find `content`/`answer`/`text`/… inside.
 */
function textFromSingleKeyWrapper(obj: Record<string, unknown>, depth: number): string | null {
  const entries = Object.entries(obj);
  if (entries.length !== 1) return null;

  const [, only] = entries[0]!;
  if (!isPlainObject(only)) return null;

  return extractTextFromPlainJson(only, depth + 1);
}

/**
 * Extracts a human-readable text representation from a plain JSON object that is NOT
 * message-shaped (no role/content structure). Handles common wrapper patterns like `{ input:
 * "hello" }` or `{ question: "what is 2+2?" }` that are used by various frameworks.
 */
export function extractTextFromPlainJson(obj: Record<string, unknown>, depth = 0): string | null {
  if (depth >= MAX_PLAIN_JSON_RECURSION_DEPTH) {
    return null;
  }

  const known = textFromCommonKeys(obj, depth);
  if (known) return known;

  // LangChain: { inputs: { input: ... } } / { outputs: { output: ... } }
  const wrapper = obj.inputs ?? obj.outputs;
  if (isPlainObject(wrapper)) {
    const nested = extractTextFromPlainJson(wrapper, depth + 1);
    if (nested) return nested;
  }

  return textFromSingleKeyWrapper(obj, depth);
}

/**
 * Recursively checks whether a value carries at least one meaningful leaf (non-empty string,
 * number, or boolean).
 */
export function hasMeaningfulLeaf(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.length > 0;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (typeof value !== "object") {
    return false;
  }

  if (seen.has(value as object)) {
    return false;
  }

  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.some((v) => hasMeaningfulLeaf(v, seen));
  }

  return Object.values(value as Record<string, unknown>).some((v) => hasMeaningfulLeaf(v, seen));
}

/**
 * Produces a short-enough, non-empty text representation of an already-parsed JSON-serializable
 * value.
 */
export function stringifyForText(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (!hasMeaningfulLeaf(value)) {
    return null;
  }

  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/**
 * Attempts to unwrap a "text" content block's `text`, when it is itself a JSON-encoded typed
 * block with a non-"text" inner `type`, into that inner block (recursively normalized).
 */
export function tryUnwrapJsonTextBlock(
  t: string,
  seen: WeakSet<object>,
): { unwrapped: true; value: unknown } | { unwrapped: false } {
  try {
    const inner = JSON.parse(t) as Record<string, unknown>;
    const isNonTextBlock =
      inner && typeof inner === "object" && typeof inner.type === "string" && inner.type !== "text";
    if (isNonTextBlock) {
      // Recurse into the unwrapped block in case the inner shape
      // also has nested wrappers (e.g. tool_result.content).
      return { unwrapped: true, value: normalizeChatPayload(inner, seen) };
    }

    return { unwrapped: false };
  } catch {
    // not clean JSON — fall through and keep the text wrapper
    return { unwrapped: false };
  }
}

/** A JSON-looking string is re-parsed and normalized; anything else is left verbatim. */
function normalizeChatString(value: string, seen: WeakSet<object>): unknown {
  const trimmed = value.trim();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksLikeJson) return value;

  try {
    return normalizeChatPayload(JSON.parse(trimmed), seen);
  } catch {
    // not parseable JSON — leave the raw string alone
    return value;
  }
}

/**
 * A content block whose `text` is a JSON-encoded typed block (with a non-text inner `type`) is
 * replaced by the unwrapped block. A text block that was not unwrapped keeps its `text`
 * verbatim, so user-pasted JSON-looking content stays the original string.
 */
function normalizeTextBlock(obj: Record<string, unknown>, seen: WeakSet<object>): unknown {
  const t = (obj.text as string).trim();
  const looksLikeTypedBlock = t.startsWith("{") && t.endsWith("}") && t.includes('"type":"');
  if (!looksLikeTypedBlock) return obj;

  const result = tryUnwrapJsonTextBlock(t, seen);

  return result.unwrapped ? result.value : obj;
}

/** Walks every property, normalizing in place. */
function normalizeChatObject(obj: Record<string, unknown>, seen: WeakSet<object>): unknown {
  const out: Record<string, unknown> = {};
  const isChatMessage = typeof obj.role === "string";
  for (const [k, v] of Object.entries(obj)) {
    // A chat message's content is user/model text, so a JSON-looking string
    // must stay text. Structured AI responses commonly use this shape and
    // are intentionally displayed as JSON in the trace output.
    const keepVerbatim = isChatMessage && k === "content" && typeof v === "string";
    out[k] = keepVerbatim ? v : normalizeChatPayload(v, seen);
  }

  return out;
}

export function normalizeChatPayload(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === "string") {
    return normalizeChatString(value, seen);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return null;

    seen.add(value);

    return value.map((item) => normalizeChatPayload(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value as object)) return null;

    seen.add(value as object);
    const obj = value as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      return normalizeTextBlock(obj, seen);
    }

    return normalizeChatObject(obj, seen);
  }

  return value;
}

export function messagesToText(
  messages: unknown,
  mode: "input" | "output",
  traceCanonicalisation: TraceCanonicalisationService,
): string | null {
  if (!messages) {
    return null;
  }

  if (typeof messages === "string") {
    // Try to parse JSON-encoded message payloads and extract text semantically
    try {
      const parsed: unknown = JSON.parse(messages);
      if (typeof parsed === "object" && parsed !== null) {
        return messagesToText(parsed, mode, traceCanonicalisation);
      }
    } catch {
      // Not JSON — return the string as-is
    }

    return messages;
  }

  if (Array.isArray(messages)) {
    return traceCanonicalisation.tryExtractMessageText({
      value: messages,
      mode,
    });
  }

  // Try message-shaped extraction first (content, parts, text, value)
  const messageText = traceCanonicalisation.tryExtractMessageText({
    value: messages,
    mode,
  });
  if (messageText) {
    return messageText;
  }

  // Fall back to common JSON wrapper keys (input, question, query, etc.)
  if (typeof messages === "object" && messages !== null) {
    return extractTextFromPlainJson(messages as Record<string, unknown>);
  }

  return null;
}
