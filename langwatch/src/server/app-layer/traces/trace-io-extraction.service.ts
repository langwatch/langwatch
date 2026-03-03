import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "./canonicalisation/extractors/_messages";
import type { NormalizedSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/spans";

const logger = createLogger("langwatch:trace-processing:io-extraction-service");

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

        // Debug: log what we're looking at
        logger.debug(
          {
            spanCount: spans.length,
            orderedSpanCount: orderedSpans.length,
            orderedSpanIds: orderedSpans.map((s) => s.spanId),
            orderedSpanNames: orderedSpans.map((s) => s.name),
          },
          "Extracting first input - ordered spans",
        );

        // Filter to spans with valid inputs
        const spansWithInput = orderedSpans.filter((span) => {
          if (shouldExcludeSpan(span)) {
            logger.debug(
              { spanId: span.spanId, spanType: getSpanType(span) },
              "Excluding span from input extraction",
            );
            return false;
          }
          const input = this.extractRichIOFromSpan(span, "input");
          const hasInput = input !== null;
          logger.debug(
            {
              spanId: span.spanId,
              spanName: span.name,
              hasInput,
              hasGenAiInput:
                span.spanAttributes[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !==
                undefined,
              hasLangwatchInput:
                span.spanAttributes[ATTR_KEYS.LANGWATCH_INPUT] !== undefined,
              genAiInputValue:
                span.spanAttributes[ATTR_KEYS.GEN_AI_INPUT_MESSAGES],
            },
            "Checking span for input",
          );
          return hasInput;
        });

        logger.debug(
          {
            spansWithInputCount: spansWithInput.length,
            spansWithInputIds: spansWithInput.map((s) => s.spanId),
          },
          "Spans with valid input",
        );

        const firstSpan = spansWithInput[0];

        if (!firstSpan) {
          otelSpan.setAttributes({
            "input.found": false,
            "fallback.used": true,
          });
          logger.debug("No spans with input found, using fallback");
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
  extractRichIOFromSpan(
    span: NormalizedSpan,
    type: "input" | "output",
  ): ExtractedIO | null {
    const attrs = span.spanAttributes;

    if (type === "input") {
      // Priority 1: GenAI input messages
      const genAiInput = attrs[ATTR_KEYS.GEN_AI_INPUT_MESSAGES];
      if (genAiInput !== undefined && genAiInput !== null) {
        const text = messagesToText(genAiInput, "input");
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "gen_ai.input.messages" },
            "Extracted input from GenAI messages",
          );
          return { raw: genAiInput, text, source: "gen_ai" };
        }
      }

      // Priority 2: LangWatch input
      const langwatchInput = attrs[ATTR_KEYS.LANGWATCH_INPUT];
      if (langwatchInput !== undefined && langwatchInput !== null) {
        const text =
          typeof langwatchInput === "string"
            ? langwatchInput
            : messagesToText(langwatchInput, "input");
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "langwatch.input" },
            "Extracted input from LangWatch attribute",
          );
          return { raw: langwatchInput, text, source: "langwatch" };
        }
      }
    } else {
      // Priority 1: GenAI output messages
      const genAiOutput = attrs[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES];
      if (genAiOutput !== undefined && genAiOutput !== null) {
        const text = messagesToText(genAiOutput, "output");
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "gen_ai.output.messages" },
            "Extracted output from GenAI messages",
          );
          return { raw: genAiOutput, text, source: "gen_ai" };
        }
      }

      // Priority 2: LangWatch output
      const langwatchOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
      if (langwatchOutput !== undefined && langwatchOutput !== null) {
        const text =
          typeof langwatchOutput === "string"
            ? langwatchOutput
            : messagesToText(langwatchOutput, "output");
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "langwatch.output" },
            "Extracted output from LangWatch attribute",
          );
          return { raw: langwatchOutput, text, source: "langwatch" };
        }
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

export const traceIOExtractionService = new TraceIOExtractionService();

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
  /** The raw JSON value (parsed if it was a string) */
  raw: unknown;
  /** A text representation for display/search */
  text: string;
  /** Which attribute the value was extracted from */
  source: "langwatch" | "gen_ai";
}

const getSpanType = (span: NormalizedSpan): string => {
  const type = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
  return typeof type === "string" ? type : "unknown";
};

const shouldExcludeSpan = (span: NormalizedSpan): boolean => {
  const type = getSpanType(span);
  return type === "evaluation" || type === "guardrail";
};

/**
 * Converts a message object/array to a readable text representation.
 *
 * @param messages - The raw message data to convert
 * @param mode - "input" extracts only last user message, "output" concatenates all
 */
const messagesToText = (
  messages: unknown,
  mode: "input" | "output" = "output",
): string | null => {
  if (!messages) return null;

  // If it's a plain string, return it
  if (typeof messages === "string") {
    return messages;
  }

  // If it's an array of messages
  if (Array.isArray(messages)) {
    // For input mode, extract only the last user message
    if (mode === "input") {
      const lastUserText = extractLastUserMessageText(messages);
      if (lastUserText) return lastUserText;
    }

    // Default: concatenate all messages
    const texts: string[] = [];
    for (const msg of messages) {
      const text = extractMessageContentText(msg);
      if (text) texts.push(text);
    }
    return texts.length > 0 ? texts.join("\n") : null;
  }

  // If it's a single message object
  const text = extractMessageContentText(messages);
  return text;
};
