/**
 * FROZEN TWIN of `platform/app/src/server/app-layer/traces/trace-io-extraction.service.ts`. The
 * application keeps its copy while both graphs ingest; edit neither without editing the other.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { ATTR_KEYS, type TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  type ExtractedIO,
  type FlattenMode,
  getSpanType,
  messagesToText,
  normalizeChatPayload,
  shouldExcludeSpan,
  type SpanTreeNode,
  stringifyForText,
} from "../rules/trace-io-text.rules.ts";

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

        const semantic = this.trySemanticOutput(spans, otelSpan);
        if (semantic) {
          return semantic;
        }

        // No semantic match on any span, so the stringified payload of the last-finishing span is
        // tried. As on the input side, a fallback never shadows a semantic match.
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

        otelSpan.setAttributes({ "output.found": false, "fallback.used": true });
        const httpFallback = this.getHttpStatusFallback(this.organizeSpansIntoTree(spans));

        return httpFallback
          ? { raw: httpFallback, text: httpFallback, source: "langwatch" as const }
          : null;
      },
    );
  }

  /**
   * The output a span states in so many words: a single top-level node's, when the tree has just
   * one, and otherwise the last-finishing span's. Null when no span states one at all.
   */
  private trySemanticOutput(
    spans: NormalizedSpan[],
    otelSpan: { setAttributes: (attributes: Record<string, string | number | boolean>) => void },
  ): ExtractedIO | null {
    const hasValidOutput = (span: NormalizedSpan): boolean =>
      !shouldExcludeSpan(span) && this.tryExtractRichIOFromSpan(span, "output") !== null;

    const topLevelWithOutput = this.flattenSpanTree(this.organizeSpansIntoTree(spans), "inside-out")
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

    const lastSpan = spans
      .filter(hasValidOutput)
      .sort((a, b) => b.endTimeUnixMs - a.endTimeUnixMs)[0];
    if (!lastSpan) {
      return null;
    }

    const output = this.tryExtractRichIOFromSpan(lastSpan, "output");
    otelSpan.setAttributes({
      "output.found": true,
      "span.type": getSpanType(lastSpan),
      "output.source": "last_finishing",
      "output.length": output?.text.length ?? 0,
    });

    return output;
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
