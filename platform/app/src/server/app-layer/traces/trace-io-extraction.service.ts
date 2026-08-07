import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer, type LangWatchSpan } from "langwatch";
import type { NormalizedSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "./canonicalisation/extractors/_messages";

/**
 * Service for extracting input/output text from spans using tree traversal
 * and framework-specific heuristics.
 *
 * Priority for I/O extraction (highest to lowest):
 * 1. gen_ai.input.messages / gen_ai.output.messages (GenAI semantic convention)
 * 2. langwatch.input / langwatch.output (LangWatch canonical attributes)
 *
 * @example
 * ```typescript
 * const service = new TraceIOExtractionService();
 * const input = service.extractFirstInput(spans);
 * const output = service.extractLastOutput(spans);
 * ```
 */
export class TraceIOExtractionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.io-extraction",
  );

  /**
   * Extracts the first meaningful input from the trace with rich JSON data.
   * Uses span tree traversal to find the topmost input, filtering out
   * evaluation and guardrail spans.
   *
   * @returns ExtractedIO with both raw JSON and text representation, or null if not found
   */
  private computeFirstInput(
    spans: NormalizedSpan[],
    otelSpan: LangWatchSpan,
  ): ExtractedIO | null {
    if (spans.length === 0) {
      otelSpan.setAttributes({ "input.found": false });
      return null;
    }

    const tree = this.organizeSpansIntoTree(spans);
    const orderedSpans = this.flattenSpanTree(tree, "outside-in");

    // Filter to spans with valid inputs
    const spansWithInput = orderedSpans.filter((span) => {
      if (shouldExcludeSpan(span)) return false;
      const input = this.extractRichIOFromSpan(span, "input");
      return input !== null;
    });

    const firstSpan = spansWithInput[0];

    if (firstSpan) {
      const input = this.extractRichIOFromSpan(firstSpan, "input");
      otelSpan.setAttributes({
        "input.found": true,
        "span.type": getSpanType(firstSpan),
        "input.length": input?.text.length ?? 0,
      });
      return input;
    }

    // No semantic match — try stringified-payload fallback against the
    // topmost span that HAS an input attribute, so `ComputedInput` is
    // non-null when the trace genuinely carries data. Fallback is
    // applied only after every semantic candidate has been exhausted,
    // so it can never shadow a real match.
    for (const span of orderedSpans) {
      if (shouldExcludeSpan(span)) continue;
      const fb = this.extractFallbackIOFromSpan(span, "input");
      if (fb) {
        otelSpan.setAttributes({
          "input.found": true,
          "input.source": "stringified_fallback",
          "input.length": fb.text.length,
        });
        return fb;
      }
    }

    otelSpan.setAttributes({
      "input.found": false,
      "fallback.used": true,
    });
    const httpFallback = this.getHttpFallback(orderedSpans);
    return httpFallback
      ? {
          raw: httpFallback,
          text: httpFallback,
          source: "langwatch" as const,
        }
      : null;
  }

  extractFirstInput(spans: NormalizedSpan[]): ExtractedIO | null {
    return this.tracer.withActiveSpan(
      "TraceIOExtractionService.extractFirstInput",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "span.count": spans.length },
      },
      (otelSpan) => this.computeFirstInput(spans, otelSpan),
    );
  }

  /**
   * Extracts the last meaningful output from the trace with rich JSON data.
   * Prioritizes single top-level node output, then falls back to last-finishing span.
   *
   * @returns ExtractedIO with both raw JSON and text representation, or null if not found
   */
  private hasValidOutput(span: NormalizedSpan): boolean {
    if (shouldExcludeSpan(span)) return false;
    const output = this.extractRichIOFromSpan(span, "output");
    return output !== null;
  }

  // Try single top-level node first.
  private singleTopLevelOutput(
    tree: SpanTreeNode[],
    otelSpan: LangWatchSpan,
  ): ExtractedIO | null | undefined {
    const topLevelWithOutput = this.flattenSpanTree(tree, "inside-out")
      .filter((span) => this.hasValidOutput(span))
      .reverse();

    if (topLevelWithOutput.length !== 1 || !topLevelWithOutput[0]) {
      return undefined;
    }

    const span = topLevelWithOutput[0];
    const output = this.extractRichIOFromSpan(span, "output");

    otelSpan.setAttributes({
      "output.found": true,
      "span.type": getSpanType(span),
      "output.source": "single_top_level",
      "output.length": output?.text.length ?? 0,
    });

    return output;
  }

  // Fall back to last-finishing span.
  private lastFinishingOutput(
    spans: NormalizedSpan[],
    otelSpan: LangWatchSpan,
  ): ExtractedIO | null | undefined {
    const sortedByEndTime = spans
      .filter((span) => this.hasValidOutput(span))
      .sort((a, b) => b.endTimeUnixMs - a.endTimeUnixMs);

    const lastSpan = sortedByEndTime[0];
    if (!lastSpan) return undefined;

    const output = this.extractRichIOFromSpan(lastSpan, "output");
    otelSpan.setAttributes({
      "output.found": true,
      "span.type": getSpanType(lastSpan),
      "output.source": "last_finishing",
      "output.length": output?.text.length ?? 0,
    });
    return output;
  }

  // No semantic match on any span — try stringified-payload fallback
  // against the span that finished last. See `extractFirstInput` for
  // rationale: fallback is never allowed to shadow a semantic match.
  private stringifiedOutputFallback(
    spans: NormalizedSpan[],
    otelSpan: LangWatchSpan,
  ): ExtractedIO | null | undefined {
    const allByEndTime = [...spans].sort(
      (a, b) => b.endTimeUnixMs - a.endTimeUnixMs,
    );
    for (const span of allByEndTime) {
      if (shouldExcludeSpan(span)) continue;
      const fb = this.extractFallbackIOFromSpan(span, "output");
      if (fb) {
        otelSpan.setAttributes({
          "output.found": true,
          "output.source": "stringified_fallback",
          "output.length": fb.text.length,
        });
        return fb;
      }
    }
    return undefined;
  }

  private computeLastOutput(
    spans: NormalizedSpan[],
    otelSpan: LangWatchSpan,
  ): ExtractedIO | null {
    if (spans.length === 0) {
      otelSpan.setAttributes({ "output.found": false });
      return null;
    }

    const tree = this.organizeSpansIntoTree(spans);

    const topLevel = this.singleTopLevelOutput(tree, otelSpan);
    if (topLevel !== undefined) return topLevel;

    const lastFinishing = this.lastFinishingOutput(spans, otelSpan);
    if (lastFinishing !== undefined) return lastFinishing;

    const fallback = this.stringifiedOutputFallback(spans, otelSpan);
    if (fallback !== undefined) return fallback;

    otelSpan.setAttributes({
      "output.found": false,
      "fallback.used": true,
    });
    const httpFallback = this.getHttpStatusFallback(tree);
    return httpFallback
      ? {
          raw: httpFallback,
          text: httpFallback,
          source: "langwatch" as const,
        }
      : null;
  }

  extractLastOutput(spans: NormalizedSpan[]): ExtractedIO | null {
    return this.tracer.withActiveSpan(
      "TraceIOExtractionService.extractLastOutput",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "span.count": spans.length },
      },
      (otelSpan) => this.computeLastOutput(spans, otelSpan),
    );
  }

  /**
   * Extracts rich I/O from span attributes using priority order:
   * 1. gen_ai.input/output.messages (GenAI semantic convention)
   * 2. langwatch.input/output (LangWatch canonical attributes)
   *
   * @returns ExtractedIO with both raw JSON and text representation
   */
  private static readonly IO_ATTR_KEYS = {
    input: {
      genAi: ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
      langwatch: ATTR_KEYS.LANGWATCH_INPUT,
    },
    output: {
      genAi: ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
      langwatch: ATTR_KEYS.LANGWATCH_OUTPUT,
    },
  } as const;

  extractRichIOFromSpan(
    span: NormalizedSpan,
    type: "input" | "output",
  ): ExtractedIO | null {
    const attrs = span.spanAttributes;
    const keys = TraceIOExtractionService.IO_ATTR_KEYS[type];

    // Priority 1: GenAI messages
    const genAiValue = attrs[keys.genAi];
    if (genAiValue !== undefined && genAiValue !== null) {
      const normalized = normalizeChatPayload(genAiValue);
      const text = messagesToText(normalized, type);
      if (text) {
        return { raw: normalized, text, source: "gen_ai" };
      }
    }

    // Priority 2: LangWatch attribute — semantic matches only.
    // Returns non-null ONLY when the payload yields a meaningful text
    // (direct string or heuristic hit on a recognized wrapper key).
    // If the payload is an unknown shape, callers should fall back to
    // `extractFallbackIOFromSpan` as a last-resort rather than letting
    // a stringified mystery object shadow a real match on another span.
    const langwatchValue = attrs[keys.langwatch];
    if (langwatchValue !== undefined && langwatchValue !== null) {
      const normalized = normalizeChatPayload(langwatchValue);
      const text = messagesToText(normalized, type);
      if (text) {
        return { raw: normalized, text, source: "langwatch" };
      }
    }

    return null;
  }

  /**
   * Last-resort stringified fallback for spans that HAVE a langwatch.input/output
   * attribute but whose shape defeats every semantic heuristic. Returning a
   * stringified payload here is strictly better than leaving `ComputedInput` /
   * `ComputedOutput` NULL (renders as `<empty>` in the UI), but callers must
   * prefer `extractRichIOFromSpan` so a fallback match never shadows a real
   * semantic match on another span in the same trace.
   */
  extractFallbackIOFromSpan(
    span: NormalizedSpan,
    type: "input" | "output",
  ): ExtractedIO | null {
    const attrs = span.spanAttributes;
    const keys = TraceIOExtractionService.IO_ATTR_KEYS[type];
    const langwatchValue = attrs[keys.langwatch];

    if (langwatchValue === undefined || langwatchValue === null) return null;
    if (typeof langwatchValue === "string") {
      return langwatchValue.length > 0
        ? { raw: langwatchValue, text: langwatchValue, source: "langwatch" }
        : null;
    }

    const fallbackText = stringifyForText(langwatchValue);
    if (fallbackText) {
      return { raw: langwatchValue, text: fallbackText, source: "langwatch" };
    }
    return null;
  }

  /**
   * Organizes flat array of spans into a tree structure.
   */
  organizeSpansIntoTree(spans: NormalizedSpan[]): SpanTreeNode[] {
    // Sort by start time for chronological ordering
    const sorted = [...spans].sort(
      (a, b) => a.startTimeUnixMs - b.startTimeUnixMs,
    );

    // Build node map
    const nodeMap = new Map<string, SpanTreeNode>();
    for (const span of sorted) {
      nodeMap.set(span.spanId, { span, children: [] });
    }

    // Build parent-child relationships
    for (const span of sorted) {
      if (span.parentSpanId && nodeMap.has(span.parentSpanId)) {
        const node = nodeMap.get(span.spanId)!;
        const parent = nodeMap.get(span.parentSpanId)!;
        parent.children.push(node);
      }
    }

    // Extract root nodes
    const roots = Array.from(nodeMap.values()).filter(
      (node) => !node.span.parentSpanId || !nodeMap.has(node.span.parentSpanId),
    );

    return roots;
  }

  /**
   * Flattens a span tree into an array using specified traversal order.
   */
  flattenSpanTree(tree: SpanTreeNode[], mode: FlattenMode): NormalizedSpan[] {
    const result: NormalizedSpan[] = [];
    collectSpansInTraversalOrder(tree, mode, result);
    return result;
  }

  private getHttpFallback(orderedSpans: NormalizedSpan[]): string | null {
    const topSpan = orderedSpans.find((span) => !span.parentSpanId);
    if (!topSpan) return null;

    const httpMethod = topSpan.spanAttributes["http.method"];
    const httpTarget = topSpan.spanAttributes["http.target"];

    if (typeof httpMethod === "string" && typeof httpTarget === "string") {
      return `${httpMethod} ${httpTarget}`;
    }

    return topSpan.name ?? null;
  }

  private getHttpStatusFallback(tree: SpanTreeNode[]): string | null {
    const topSpan = this.flattenSpanTree(tree, "outside-in").find(
      (span) => !span.parentSpanId,
    );

    if (topSpan) {
      const status = topSpan.spanAttributes["http.status_code"];
      if (typeof status === "number") {
        return status.toString();
      }
    }

    return null;
  }
}

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

/** Depth-first traversal backing `flattenSpanTree`; pushes into `result` in place. */
function collectSpansInTraversalOrder(
  nodes: SpanTreeNode[],
  mode: FlattenMode,
  result: NormalizedSpan[],
): void {
  for (const node of nodes) {
    if (mode === "outside-in") result.push(node.span);
    if (node.children.length > 0) {
      collectSpansInTraversalOrder(node.children, mode, result);
    }
    if (mode === "inside-out") result.push(node.span);
  }
}

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

function getSpanType(span: NormalizedSpan): string {
  const type = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
  return typeof type === "string" ? type : "unknown";
}

function shouldExcludeSpan(span: NormalizedSpan): boolean {
  const type = getSpanType(span);
  return type === "evaluation" || type === "guardrail";
}

/**
 * Common keys that wrap a single text value in JSON payloads from various
 * frameworks (LangChain, Haystack, Flowise, Optimization Studio, etc.).
 * Order matters: first match wins.
 */
const COMMON_TEXT_KEYS = [
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
const MAX_PLAIN_JSON_RECURSION_DEPTH = 32;

/** Recurses into a nested plain-object value, or returns null when it isn't one. */
function recurseIntoPlainJsonValue(val: unknown, depth: number): string | null {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return extractTextFromPlainJson(val as Record<string, unknown>, depth + 1);
  }
  return null;
}

/** Text for a single COMMON_TEXT_KEYS candidate, or null when `val` yields none. */
function textFromCommonKeyValue(val: unknown, depth: number): string | null {
  if (typeof val === "string" && val.length > 0) return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  // Nested object with a known key (e.g. { inputs: { input: "hello" } })
  return recurseIntoPlainJsonValue(val, depth);
}

function textFromCommonKeys(
  obj: Record<string, unknown>,
  depth: number,
): string | null {
  for (const key of COMMON_TEXT_KEYS) {
    const val = obj[key];
    if (val === undefined) continue;
    const text = textFromCommonKeyValue(val, depth);
    if (text) return text;
  }
  return null;
}

// LangChain: { inputs: { input: ... } } / { outputs: { output: ... } }
function textFromInputsOutputsWrapper(
  obj: Record<string, unknown>,
  depth: number,
): string | null {
  return recurseIntoPlainJsonValue(obj.inputs ?? obj.outputs, depth);
}

// Single-key wrapper fallback: many frameworks emit the real payload under an
// arbitrary wrapper key like `{ data: {...} }`, `{ result: {...} }`,
// `{ response: {...} }`. Recurse into the inner object so the COMMON_TEXT_KEYS
// loop above gets a chance to find `content`/`answer`/`text`/... inside.
function textFromSingleKeyWrapper(
  obj: Record<string, unknown>,
  depth: number,
): string | null {
  const entries = Object.entries(obj);
  if (entries.length !== 1) return null;
  const [, only] = entries[0]!;
  return recurseIntoPlainJsonValue(only, depth);
}

/**
 * Extracts a human-readable text representation from a plain JSON object
 * that is NOT message-shaped (no role/content structure).
 *
 * Handles common wrapper patterns like `{ input: "hello" }` or
 * `{ question: "what is 2+2?" }` that are used by various frameworks.
 */
function extractTextFromPlainJson(
  obj: Record<string, unknown>,
  depth = 0,
): string | null {
  if (depth >= MAX_PLAIN_JSON_RECURSION_DEPTH) return null;

  return (
    textFromCommonKeys(obj, depth) ??
    textFromInputsOutputsWrapper(obj, depth) ??
    textFromSingleKeyWrapper(obj, depth)
  );
}

/**
 * Recursively checks whether a value carries at least one meaningful leaf
 * (non-empty string, number, or boolean). Empty strings, null/undefined, empty
 * arrays/objects, and wrappers whose leaves are all of the above (e.g. `{ data:
 * {} }`, `{ result: [] }`, `{ a: { b: "" } }`) are treated as empty. Uses a
 * WeakSet to guard against circular references.
 */
function hasMeaningfulLeaf(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "object") return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  if (Array.isArray(value))
    return value.some((v) => hasMeaningfulLeaf(v, seen));
  return Object.values(value as Record<string, unknown>).some((v) =>
    hasMeaningfulLeaf(v, seen),
  );
}

/**
 * Produces a short-enough, non-empty text representation of an already-parsed
 * JSON-serializable value. Used as the last-resort fallback when heuristic text
 * extraction fails — storing `JSON.stringify(value)` in `ComputedOutput` is
 * strictly better than storing `NULL` (which renders as `<empty>` in the UI).
 *
 * Callers guarantee `value` is not null/undefined and not a string (those are
 * handled earlier via semantic extraction), so only number/boolean/array/object
 * cases matter here. Wrappers with no meaningful leaf (e.g. `{ data: {} }`) are
 * rejected so they don't end up as non-null-but-useless computed I/O.
 */
function stringifyForText(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!hasMeaningfulLeaf(value)) return null;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function normalizeChatPayloadStringValue(
  value: string,
  seen: WeakSet<object>,
): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeChatPayload(parsed, seen);
    } catch {
      // not parseable JSON — leave the raw string alone
    }
  }
  return value;
}

function normalizeChatPayloadArray(
  value: unknown[],
  seen: WeakSet<object>,
): unknown {
  if (seen.has(value)) return null;
  seen.add(value);
  return value.map((item) => normalizeChatPayload(item, seen));
}

// If `obj` IS a content block whose `text` is a JSON-encoded typed block
// (with a non-text inner `type`), replace it with the unwrapped block.
// Text block that wasn't unwrapped: preserve `text` verbatim so
// user-pasted JSON-looking content stays as the original string.
function unwrapChatPayloadTextEnvelope(
  obj: Record<string, unknown>,
  text: string,
  seen: WeakSet<object>,
): unknown {
  const t = text.trim();
  if (t.startsWith("{") && t.endsWith("}") && t.includes('"type":"')) {
    try {
      const inner = JSON.parse(t) as Record<string, unknown>;
      if (
        inner &&
        typeof inner === "object" &&
        typeof inner.type === "string" &&
        inner.type !== "text"
      ) {
        // Recurse into the unwrapped block in case the inner shape
        // also has nested wrappers (e.g. tool_result.content).
        return normalizeChatPayload(inner, seen);
      }
    } catch {
      // not clean JSON — fall through and keep the text wrapper
    }
  }
  return obj;
}

// Walk every property, normalizing in place.
function normalizeChatPayloadObjectProperties(
  obj: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const isChatMessage = typeof obj.role === "string";
  for (const [k, v] of Object.entries(obj)) {
    // A chat message's content is user/model text, so a JSON-looking string
    // must stay text. Structured AI responses commonly use this shape and
    // are intentionally displayed as JSON in the trace output.
    out[k] =
      isChatMessage && k === "content" && typeof v === "string"
        ? v
        : normalizeChatPayload(v, seen);
  }
  return out;
}

function normalizeChatPayloadObject(
  value: Record<string, unknown>,
  seen: WeakSet<object>,
): unknown {
  if (seen.has(value)) return null;
  seen.add(value);
  if (value.type === "text" && typeof value.text === "string") {
    return unwrapChatPayloadTextEnvelope(value, value.text, seen);
  }
  return normalizeChatPayloadObjectProperties(value, seen);
}

/**
 * Some agent runtimes (Claude Code, certain Anthropic instrumentations)
 * emit chat content with each typed block (`thinking` / `tool_use` /
 * `tool_result`) wrapped *inside* a generic `{type:"text", text:"<JSON
 * of the real block>"}` envelope. That double-wrap means downstream
 * renderers have to peek into the `text` field and re-parse to recover
 * the actual block kind — and every consumer ends up implementing that
 * defensively. Normalize once at ingest so we store the proper Anthropic
 * content-block array end-to-end.
 *
 * Walks the input shape (string / object / array) and unwraps any
 * `{type:"text", text:"<JSON typed block>"}` it finds. Returns the
 * normalized value in the same outer shape (object stays object, array
 * stays array; a JSON string is parsed-and-renormalized when possible,
 * otherwise returned unchanged).
 */
function normalizeChatPayload(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === "string") {
    return normalizeChatPayloadStringValue(value, seen);
  }
  if (Array.isArray(value)) {
    return normalizeChatPayloadArray(value, seen);
  }
  if (value && typeof value === "object") {
    return normalizeChatPayloadObject(value as Record<string, unknown>, seen);
  }
  return value;
}

function messagesToTextFromString(
  messages: string,
  mode: "input" | "output",
): string | null {
  // Try to parse JSON-encoded message payloads and extract text semantically
  try {
    const parsed: unknown = JSON.parse(messages);
    if (typeof parsed === "object" && parsed !== null) {
      return messagesToText(parsed, mode);
    }
  } catch {
    // Not JSON — return the string as-is
  }
  return messages;
}

function messagesToTextFromArray(
  messages: unknown[],
  mode: "input" | "output",
): string | null {
  if (mode === "input") {
    const lastUserText = extractLastUserMessageText(messages);
    if (lastUserText) return lastUserText;
  }

  const texts: string[] = [];
  for (const msg of messages) {
    const text = extractMessageContentText(msg);
    if (text) texts.push(text);
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

function messagesToText(
  messages: unknown,
  mode: "input" | "output" = "output",
): string | null {
  if (!messages) return null;

  if (typeof messages === "string") {
    return messagesToTextFromString(messages, mode);
  }

  if (Array.isArray(messages)) {
    return messagesToTextFromArray(messages, mode);
  }

  // Try message-shaped extraction first (content, parts, text, value)
  const messageText = extractMessageContentText(messages);
  if (messageText) return messageText;

  // Fall back to common JSON wrapper keys (input, question, query, etc.)
  if (typeof messages === "object" && messages !== null) {
    return extractTextFromPlainJson(messages as Record<string, unknown>);
  }

  return null;
}
