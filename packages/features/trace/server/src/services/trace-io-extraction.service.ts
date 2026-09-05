/**
 * FROZEN TWIN of `platform/app/src/server/app-layer/traces/trace-io-extraction.service.ts`. The
 * application keeps its copy while both graphs ingest; edit neither without editing the other.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { ATTR_KEYS, type TraceCanonicalisationService } from "@langwatch/trace-contract";

/**
 * Service for extracting input/output text from spans using tree traversal and
 * framework-specific heuristics. Priority for I/O extraction (highest to lowest): 1.
 * @example
 */
export class TraceIOExtractionService {
  static create(traceCanonicalisation: TraceCanonicalisationService): TraceIOExtractionService {
    return new TraceIOExtractionService(traceCanonicalisation);
  }

  private constructor(private readonly traceCanonicalisation: TraceCanonicalisationService) {}
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.io-extraction");

  /**
   * Extracts the first meaningful input from the trace with rich JSON data. Uses span tree
   * traversal to find the topmost input, filtering out evaluation and guardrail spans.
   * @returns ExtractedIO with both raw JSON and text representation, or null if not found
   */
  tryExtractFirstInput(spans: NormalizedSpan[]): ExtractedIO | null {
    return this.tracer.withActiveSpan(
      "TraceIOExtractionService.tryExtractFirstInput",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "span.count": spans.length },
      },
      (otelSpan) => {
        if (spans.length === 0) {
          otelSpan.setAttributes({ "input.found": false });

          return null;
        }

        const tree = this.organizeSpansIntoTree(spans);
        const orderedSpans = this.flattenSpanTree(tree, "outside-in");

        // Filter to spans with valid inputs
        const spansWithInput = orderedSpans.filter((span) => {
          if (shouldExcludeSpan(span)) {
            return false;
          }

          const input = this.tryExtractRichIOFromSpan(span, "input");

          return input !== null;
        });

        const firstSpan = spansWithInput[0];

        if (firstSpan) {
          const input = this.tryExtractRichIOFromSpan(firstSpan, "input");
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
          if (shouldExcludeSpan(span)) {
            continue;
          }

          const fb = this.tryExtractFallbackIOFromSpan(span, "input");
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
      },
    );
  }

  /**
   * Extracts the last meaningful output from the trace with rich JSON data. Prioritizes single
   * top-level node output, then falls back to last-finishing span.
   * @returns ExtractedIO with both raw JSON and text representation, or null if not found
   */
  tryExtractLastOutput(spans: NormalizedSpan[]): ExtractedIO | null {
    return this.tracer.withActiveSpan(
      "TraceIOExtractionService.tryExtractLastOutput",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "span.count": spans.length },
      },
      (otelSpan) => {
        if (spans.length === 0) {
          otelSpan.setAttributes({ "output.found": false });

          return null;
        }

        const tree = this.organizeSpansIntoTree(spans);

        const hasValidOutput = (span: NormalizedSpan): boolean => {
          if (shouldExcludeSpan(span)) {
            return false;
          }

          const output = this.tryExtractRichIOFromSpan(span, "output");

          return output !== null;
        };

        // Try single top-level node first
        const topLevelWithOutput = this.flattenSpanTree(tree, "inside-out")
          .filter(hasValidOutput)
          .reverse();

        if (topLevelWithOutput.length === 1 && topLevelWithOutput[0]) {
          const span = topLevelWithOutput[0];
          const output = this.tryExtractRichIOFromSpan(span, "output");

          otelSpan.setAttributes({
            "output.found": true,
            "span.type": getSpanType(span),
            "output.source": "single_top_level",
            "output.length": output?.text.length ?? 0,
          });

          return output;
        }

        // Fall back to last-finishing span
        const sortedByEndTime = spans
          .filter(hasValidOutput)
          .sort((a, b) => b.endTimeUnixMs - a.endTimeUnixMs);

        const lastSpan = sortedByEndTime[0];

        if (lastSpan) {
          const output = this.tryExtractRichIOFromSpan(lastSpan, "output");
          otelSpan.setAttributes({
            "output.found": true,
            "span.type": getSpanType(lastSpan),
            "output.source": "last_finishing",
            "output.length": output?.text.length ?? 0,
          });

          return output;
        }

        // No semantic match on any span — try stringified-payload fallback
        // against the span that finished last. See `tryExtractFirstInput` for
        // rationale: fallback is never allowed to shadow a semantic match.
        const allByEndTime = [...spans].sort((a, b) => b.endTimeUnixMs - a.endTimeUnixMs);
        for (const span of allByEndTime) {
          if (shouldExcludeSpan(span)) {
            continue;
          }

          const fb = this.tryExtractFallbackIOFromSpan(span, "output");
          if (fb) {
            otelSpan.setAttributes({
              "output.found": true,
              "output.source": "stringified_fallback",
              "output.length": fb.text.length,
            });

            return fb;
          }
        }

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
      },
    );
  }

  /**
   * Extracts rich I/O from span attributes using priority order: 1.
   * gen_ai.input/output.messages (GenAI semantic convention) 2.
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

  tryExtractRichIOFromSpan(span: NormalizedSpan, type: "input" | "output"): ExtractedIO | null {
    const attrs = span.spanAttributes;
    const keys = TraceIOExtractionService.IO_ATTR_KEYS[type];

    // Priority 1: GenAI messages
    const genAiValue = attrs[keys.genAi];
    if (genAiValue !== undefined && genAiValue !== null) {
      const normalized = normalizeChatPayload(genAiValue);
      const text = messagesToText(normalized, type, this.traceCanonicalisation);
      if (text) {
        return { raw: normalized, text, source: "gen_ai" };
      }
    }

    // Priority 2: LangWatch attribute — semantic matches only. Returns non-null ONLY when the
    // payload yields a meaningful text (direct string or heuristic hit on a recognized wrapper
    // key). If the payload is an unknown shape, callers should fall back to
    // `tryExtractFallbackIOFromSpan` as a last-resort rather than letting a stringified mystery
    // object shadow a real match on another span.
    const langwatchValue = attrs[keys.langwatch];
    if (langwatchValue !== undefined && langwatchValue !== null) {
      const normalized = normalizeChatPayload(langwatchValue);
      const text = messagesToText(normalized, type, this.traceCanonicalisation);
      if (text) {
        return { raw: normalized, text, source: "langwatch" };
      }
    }

    return null;
  }

  /**
   * Last-resort stringified fallback for spans that HAVE a langwatch.input/output attribute but
   * whose shape defeats every semantic heuristic.
   */
  tryExtractFallbackIOFromSpan(span: NormalizedSpan, type: "input" | "output"): ExtractedIO | null {
    const attrs = span.spanAttributes;
    const keys = TraceIOExtractionService.IO_ATTR_KEYS[type];
    const langwatchValue = attrs[keys.langwatch];

    if (langwatchValue === undefined || langwatchValue === null) {
      return null;
    }

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
    const sorted = [...spans].sort((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);

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

    const traverse = (nodes: SpanTreeNode[]) => {
      for (const node of nodes) {
        if (mode === "outside-in") {
          result.push(node.span);
        }

        if (node.children.length > 0) {
          traverse(node.children);
        }

        if (mode === "inside-out") {
          result.push(node.span);
        }
      }
    };

    traverse(tree);

    return result;
  }

  private getHttpFallback(orderedSpans: NormalizedSpan[]): string | null {
    const topSpan = orderedSpans.find((span) => !span.parentSpanId);
    if (!topSpan) {
      return null;
    }

    const httpMethod = topSpan.spanAttributes["http.method"];
    const httpTarget = topSpan.spanAttributes["http.target"];

    if (typeof httpMethod === "string" && typeof httpTarget === "string") {
      return `${httpMethod} ${httpTarget}`;
    }

    return topSpan.name ?? null;
  }

  private getHttpStatusFallback(tree: SpanTreeNode[]): string | null {
    const topSpan = this.flattenSpanTree(tree, "outside-in").find((span) => !span.parentSpanId);

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

/**
 * Extracts a human-readable text representation from a plain JSON object that is NOT
 * message-shaped (no role/content structure). Handles common wrapper patterns like `{ input:
 * "hello" }` or `{ question: "what is 2+2?" }` that are used by various frameworks.
 */
function extractTextFromPlainJson(obj: Record<string, unknown>, depth = 0): string | null {
  if (depth >= MAX_PLAIN_JSON_RECURSION_DEPTH) {
    return null;
  }

  for (const key of COMMON_TEXT_KEYS) {
    const val = obj[key];
    if (val === undefined) {
      continue;
    }

    if (typeof val === "string" && val.length > 0) {
      return val;
    }

    if (typeof val === "number" || typeof val === "boolean") {
      return String(val);
    }

    // Nested object with a known key (e.g. { inputs: { input: "hello" } })
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = extractTextFromPlainJson(val as Record<string, unknown>, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  // LangChain: { inputs: { input: ... } } / { outputs: { output: ... } }
  const wrapper = obj.inputs ?? obj.outputs;
  if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
    const nested = extractTextFromPlainJson(wrapper as Record<string, unknown>, depth + 1);
    if (nested) {
      return nested;
    }
  }

  // Single-key wrapper fallback: many frameworks emit the real payload under an
  // arbitrary wrapper key like `{ data: {...} }`, `{ result: {...} }`,
  // `{ response: {...} }`. Recurse into the inner object so the COMMON_TEXT_KEYS
  // loop above gets a chance to find `content`/`answer`/`text`/... inside.
  const entries = Object.entries(obj);
  if (entries.length === 1) {
    const [, only] = entries[0]!;
    if (only && typeof only === "object" && !Array.isArray(only)) {
      const nested = extractTextFromPlainJson(only as Record<string, unknown>, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

/**
 * Recursively checks whether a value carries at least one meaningful leaf (non-empty string,
 * number, or boolean).
 */
function hasMeaningfulLeaf(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
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
function stringifyForText(value: unknown): string | null {
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
function tryUnwrapJsonTextBlock(
  t: string,
  seen: WeakSet<object>,
): { unwrapped: true; value: unknown } | { unwrapped: false } {
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
      return { unwrapped: true, value: normalizeChatPayload(inner, seen) };
    }

    return { unwrapped: false };
  } catch {
    // not clean JSON — fall through and keep the text wrapper
    return { unwrapped: false };
  }
}

function normalizeChatPayload(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") {
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

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return null;
    }

    seen.add(value);

    return value.map((item) => normalizeChatPayload(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value as object)) {
      return null;
    }

    seen.add(value as object);
    const obj = value as Record<string, unknown>;
    // If this object IS a content block whose `text` is a JSON-encoded
    // typed block (with a non-text inner `type`), replace it with the
    // unwrapped block.
    if (obj.type === "text" && typeof obj.text === "string") {
      const t = obj.text.trim();
      if (t.startsWith("{") && t.endsWith("}") && t.includes('"type":"')) {
        const result = tryUnwrapJsonTextBlock(t, seen);
        if (result.unwrapped) {
          return result.value;
        }
      }

      // Text block that wasn't unwrapped: preserve `text` verbatim so
      // user-pasted JSON-looking content stays as the original string.
      return obj;
    }

    // Otherwise: walk every property, normalizing in place.
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

  return value;
}

function messagesToText(
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
