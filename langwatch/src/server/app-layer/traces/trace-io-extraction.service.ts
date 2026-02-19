import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
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
          return fallback ? { raw: fallback, text: fallback } : null;
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
          return fallback ? { raw: fallback, text: fallback } : null;
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
        const raw = parseJsonIfString(genAiInput);
        const text = messagesToText(genAiInput);
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "gen_ai.input.messages" },
            "Extracted input from GenAI messages",
          );
          return { raw, text };
        }
      }

      // Priority 2: LangWatch input
      const langwatchInput = attrs[ATTR_KEYS.LANGWATCH_INPUT];
      if (langwatchInput !== undefined && langwatchInput !== null) {
        const raw = parseJsonIfString(langwatchInput);
        const text =
          typeof langwatchInput === "string"
            ? langwatchInput
            : messagesToText(langwatchInput);
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "langwatch.input" },
            "Extracted input from LangWatch attribute",
          );
          return { raw, text };
        }
      }
    } else {
      // Priority 1: GenAI output messages
      const genAiOutput = attrs[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES];
      if (genAiOutput !== undefined && genAiOutput !== null) {
        const raw = parseJsonIfString(genAiOutput);
        const text = messagesToText(genAiOutput);
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "gen_ai.output.messages" },
            "Extracted output from GenAI messages",
          );
          return { raw, text };
        }
      }

      // Priority 2: LangWatch output
      const langwatchOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
      if (langwatchOutput !== undefined && langwatchOutput !== null) {
        const raw = parseJsonIfString(langwatchOutput);
        const text =
          typeof langwatchOutput === "string"
            ? langwatchOutput
            : messagesToText(langwatchOutput);
        if (text) {
          logger.debug(
            { spanId: span.spanId, source: "langwatch.output" },
            "Extracted output from LangWatch attribute",
          );
          return { raw, text };
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
 * Parses a value that might be a JSON string into its actual value.
 */
const parseJsonIfString = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

/**
 * Converts a message object/array to a readable text representation.
 */
const messagesToText = (messages: unknown): string | null => {
  if (!messages) return null;

  // Parse JSON string if needed
  const parsed = parseJsonIfString(messages);

  // If it's a plain string after parsing, return it
  if (typeof parsed === "string") {
    return parsed;
  }

  // If it's an array of messages
  if (Array.isArray(parsed)) {
    const texts: string[] = [];
    for (const msg of parsed) {
      const text = extractMessageContent(msg);
      if (text) texts.push(text);
    }
    return texts.length > 0 ? texts.join("\n") : null;
  }

  // If it's a single message object
  const text = extractMessageContent(parsed);
  return text;
};

/**
 * Extracts text content from a message object.
 * Handles various message formats: OpenAI, Anthropic, Strands, generic.
 */
const extractMessageContent = (message: unknown): string | null => {
  if (!message || typeof message !== "object") {
    return typeof message === "string" ? message : null;
  }

  const msg = message as Record<string, unknown>;

  // Check for content field (most common)
  if ("content" in msg) {
    const content = msg.content;

    // Content can be a string
    if (typeof content === "string") {
      return content;
    }

    // Content can be an array (OpenAI/Strands format with text/image parts)
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
        } else if (part && typeof part === "object") {
          const partObj = part as Record<string, unknown>;
          // Handle OpenAI format: { type: "text", text: "..." }
          if (partObj.type === "text" && typeof partObj.text === "string") {
            texts.push(partObj.text);
          }
          // Handle Strands/Anthropic format: { text: "..." } (no type field)
          else if (typeof partObj.text === "string" && !("type" in partObj)) {
            texts.push(partObj.text);
          }
          // Handle image_url format - skip but don't break
          else if (partObj.type === "image_url") {
            // Skip image parts
          }
        }
      }
      return texts.length > 0 ? texts.join("\n") : null;
    }
  }

  // Check for text field (some formats)
  if ("text" in msg && typeof msg.text === "string") {
    return msg.text;
  }

  // Check for value field (LangWatch format)
  if ("value" in msg && typeof msg.value === "string") {
    return msg.value;
  }

  return null;
};
