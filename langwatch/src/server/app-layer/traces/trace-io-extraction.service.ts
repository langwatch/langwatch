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

  static create(): TraceIOExtractionService {
    return new TraceIOExtractionService();
  }

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

        if (!firstSpan) {
          otelSpan.setAttributes({
            "input.found": false,
            "fallback.used": true,
          });
          const fallback = this.getHttpFallback(orderedSpans);
          return fallback ? { raw: fallback, text: fallback, source: "langwatch" as const } : null;
        }

        const input = this.extractRichIOFromSpan(firstSpan, "input");
        otelSpan.setAttributes({
          "input.found": true,
          "span.type": getSpanType(firstSpan),
          "input.length": input?.text.length ?? 0,
        });

        return input;
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

        if (!lastSpan) {
          otelSpan.setAttributes({
            "output.found": false,
            "fallback.used": true,
          });
          const fallback = this.getHttpStatusFallback(tree);
          return fallback ? { raw: fallback, text: fallback, source: "langwatch" as const } : null;
        }

        const output = this.extractRichIOFromSpan(lastSpan, "output");

        otelSpan.setAttributes({
          "output.found": true,
          "span.type": getSpanType(lastSpan),
          "output.source": "last_finishing",
          "output.length": output?.text.length ?? 0,
        });

        return output;
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

    // Priority 2: LangWatch attribute
    const langwatchValue = attrs[keys.langwatch];
    if (langwatchValue !== undefined && langwatchValue !== null) {
      const text =
        typeof langwatchValue === "string"
          ? langwatchValue
          : messagesToText(langwatchValue, type);
      if (text) {
        return { raw: langwatchValue, text, source: "langwatch" };
      }
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

  return extractMessageContentText(messages);
}
