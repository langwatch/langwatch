import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "./canonicalisation/extractors/_messages";
import type { NormalizedSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/spans";

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
  extractFirstInput(spans: NormalizedSpan[]): ExtractedIO | null {
    return this.tracer.withActiveSpan(
      "TraceIOExtractionService.extractFirstInput",
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
          ? { raw: httpFallback, text: httpFallback, source: "langwatch" as const }
          : null;
      },
    );
  }

  /**
   * Extracts the last meaningful output from the trace with rich JSON data.
   * Prioritizes single top-level node output, then falls back to last-finishing span.
   *
   * @returns ExtractedIO with both raw JSON and text representation, or null if not found
   */
  extractLastOutput(spans: NormalizedSpan[]): ExtractedIO | null {
    return this.tracer.withActiveSpan(
      "TraceIOExtractionService.extractLastOutput",
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
          if (shouldExcludeSpan(span)) return false;
          const output = this.extractRichIOFromSpan(span, "output");
          return output !== null;
        };

        // Try single top-level node first
        const topLevelWithOutput = this.flattenSpanTree(tree, "inside-out")
          .filter(hasValidOutput)
          .reverse();

        if (topLevelWithOutput.length === 1 && topLevelWithOutput[0]) {
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

        // Fall back to last-finishing span
        const sortedByEndTime = spans
          .filter(hasValidOutput)
          .sort((a, b) => b.endTimeUnixMs - a.endTimeUnixMs);

        const lastSpan = sortedByEndTime[0];

        if (lastSpan) {
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

        otelSpan.setAttributes({
          "output.found": false,
          "fallback.used": true,
        });
        const httpFallback = this.getHttpStatusFallback(tree);
        return httpFallback
          ? { raw: httpFallback, text: httpFallback, source: "langwatch" as const }
          : null;
      },
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
      const text = messagesToText(genAiValue, type);
      if (text) {
        return { raw: genAiValue, text, source: "gen_ai" };
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
      if (typeof langwatchValue === "string") {
        if (langwatchValue.length > 0) {
          return { raw: langwatchValue, text: langwatchValue, source: "langwatch" };
        }
      } else {
        const heuristicText = messagesToText(langwatchValue, type);
        if (heuristicText) {
          return { raw: langwatchValue, text: heuristicText, source: "langwatch" };
        }
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

    const traverse = (nodes: SpanTreeNode[]) => {
      for (const node of nodes) {
        if (mode === "outside-in") result.push(node.span);
        if (node.children.length > 0) traverse(node.children);
        if (mode === "inside-out") result.push(node.span);
      }
    };

    traverse(tree);
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

  for (const key of COMMON_TEXT_KEYS) {
    const val = obj[key];
    if (val === undefined) continue;
    if (typeof val === "string" && val.length > 0) return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    // Nested object with a known key (e.g. { inputs: { input: "hello" } })
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = extractTextFromPlainJson(
        val as Record<string, unknown>,
        depth + 1,
      );
      if (nested) return nested;
    }
  }

  // LangChain: { inputs: { input: ... } } / { outputs: { output: ... } }
  const wrapper = obj.inputs ?? obj.outputs;
  if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
    const nested = extractTextFromPlainJson(
      wrapper as Record<string, unknown>,
      depth + 1,
    );
    if (nested) return nested;
  }

  // Single-key wrapper fallback: many frameworks emit the real payload under an
  // arbitrary wrapper key like `{ data: {...} }`, `{ result: {...} }`,
  // `{ response: {...} }`. Recurse into the inner object so the COMMON_TEXT_KEYS
  // loop above gets a chance to find `content`/`answer`/`text`/... inside.
  const entries = Object.entries(obj);
  if (entries.length === 1) {
    const [, only] = entries[0]!;
    if (only && typeof only === "object" && !Array.isArray(only)) {
      const nested = extractTextFromPlainJson(
        only as Record<string, unknown>,
        depth + 1,
      );
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Produces a short-enough, non-empty text representation of an already-parsed
 * JSON-serializable value. Used as the last-resort fallback when heuristic text
 * extraction fails — storing `JSON.stringify(value)` in `ComputedOutput` is
 * strictly better than storing `NULL` (which renders as `<empty>` in the UI).
 */
function stringifyForText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const s = JSON.stringify(value);
    return s && s !== "{}" && s !== "[]" ? s : null;
  } catch {
    return null;
  }
}

function messagesToText(
  messages: unknown,
  mode: "input" | "output" = "output",
): string | null {
  if (!messages) return null;

  if (typeof messages === "string") {
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

  if (Array.isArray(messages)) {
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

  // Try message-shaped extraction first (content, parts, text, value)
  const messageText = extractMessageContentText(messages);
  if (messageText) return messageText;

  // Fall back to common JSON wrapper keys (input, question, query, etc.)
  if (typeof messages === "object" && messages !== null) {
    return extractTextFromPlainJson(messages as Record<string, unknown>);
  }

  return null;
}
