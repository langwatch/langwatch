import type { SpanData, TraceProjectionData } from "../types";

/**
 * Represents a node in the span tree.
 */
export interface SpanTreeNode {
  span: SpanData;
  children: SpanTreeNode[];
}

export interface ProjectionHeuristicResult
  extends Partial<TraceProjectionData> {
  computedMetadata?: Record<string, string>;
}

const INPUT_ATTRIBUTE_KEYS = [
  "llm.prompt",
  "gen_ai.prompt",
  "gen_ai.input",
  "request.body",
  "langwatch.prompt",
];

const OUTPUT_ATTRIBUTE_KEYS = [
  "llm.completion",
  "gen_ai.output",
  "response.body",
  "langwatch.response",
];

const MODEL_ATTRIBUTE_KEYS = [
  "llm.model",
  "gen_ai.model",
  "openai.model",
  "model.name",
];

const PROMPT_TOKEN_KEYS = [
  "llm.prompt_tokens",
  "gen_ai.prompt_tokens",
  "usage.prompt_tokens",
];

const COMPLETION_TOKEN_KEYS = [
  "llm.completion_tokens",
  "gen_ai.completion_tokens",
  "usage.completion_tokens",
];

const FIRST_TOKEN_REGEX = /first[_\s-]?token/i;
const LAST_TOKEN_REGEX = /last[_\s-]?token/i;

/**
 * Service for building trace projections from span data.
 */
export class TraceProjectionService {
  /**
   * Builds a trace projection from span data.
   */
  buildTraceProjection(
    tenantId: string,
    traceId: string,
    spans: readonly SpanData[],
  ): TraceProjectionData {
    if (spans.length === 0) {
      throw new Error("Cannot build projection from empty spans");
    }

    const spanForest = this.buildSpanTree(spans);
    const now = Date.now();

    const baseProjection: TraceProjectionData = {
      tenantId,
      traceId,
      computedInput: null,
      computedOutput: null,
      computedMetadata: {
        root_span_count: String(spanForest.length),
      },
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      totalDurationMs: 0,
      tokensPerSecond: null,
      spanCount: spans.length,
      containsErrorStatus: false,
      containsOKStatus: false,
      models: null,
      topicId: null,
      subTopicId: null,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      hasAnnotation: null,
      createdAt: now,
      lastUpdatedAt: now,
    };

    const heuristicsResults = [
      this.detectInputOutput(spans),
      this.computeTimingMetrics(spans),
      this.deriveStatusFlags(spans),
      this.deriveModelInfo(spans),
      this.aggregateTokenMetrics(spans),
    ];

    const withHeuristics = this.mergeHeuristics(
      baseProjection,
      ...heuristicsResults,
    );
    const tokensPerSecondResult = this.deriveTokensPerSecond(withHeuristics);

    return this.mergeHeuristics(withHeuristics, tokensPerSecondResult);
  }

  /**
   * Builds a tree structure from span data.
   * Spans without parents are placed at the root level.
   */
  buildSpanTree(spans: readonly SpanData[]): SpanTreeNode[] {
    const spanMap = new Map<string, SpanTreeNode>();
    const rootNodes: SpanTreeNode[] = [];

    // Create nodes for all spans
    for (const span of spans) {
      const node: SpanTreeNode = {
        span,
        children: [],
      };
      spanMap.set(span.spanId, node);
    }

    // Build the tree
    for (const span of spans) {
      const node = spanMap.get(span.spanId)!;

      if (span.parentSpanId) {
        // Try to find parent
        const parentNode = spanMap.get(span.parentSpanId);
        if (parentNode) {
          parentNode.children.push(node);
        } else {
          // Parent not found, put at root
          rootNodes.push(node);
        }
      } else {
        // No parent, put at root
        rootNodes.push(node);
      }
    }

    return rootNodes;
  }

  private detectInputOutput(
    spans: readonly SpanData[],
  ): ProjectionHeuristicResult {
    const computedInput = this.findFirstAttribute(spans, INPUT_ATTRIBUTE_KEYS);
    const computedOutput = this.findFirstAttribute(
      spans,
      OUTPUT_ATTRIBUTE_KEYS,
    );

    return {
      computedInput,
      computedOutput,
      computedMetadata: {
        ...(computedInput ? { detected_input_source: "attributes" } : {}),
        ...(computedOutput ? { detected_output_source: "attributes" } : {}),
      },
    };
  }

  private computeTimingMetrics(
    spans: readonly SpanData[],
  ): ProjectionHeuristicResult {
    if (spans.length === 0) {
      return {
        totalDurationMs: 0,
        timeToFirstTokenMs: null,
        timeToLastTokenMs: null,
      };
    }

    const startTimes = spans.map((span) => span.startTimeUnixMs);
    const endTimes = spans.map((span) => span.endTimeUnixMs);
    const earliestStart = Math.min(...startTimes);
    const latestEnd = Math.max(...endTimes);

    const firstTokenEvent = this.findEventByRegex(spans, FIRST_TOKEN_REGEX);
    const lastTokenEvent = this.findEventByRegex(spans, LAST_TOKEN_REGEX);

    return {
      totalDurationMs: Math.max(0, latestEnd - earliestStart),
      timeToFirstTokenMs: firstTokenEvent
        ? Math.max(0, firstTokenEvent.timeUnixMs - earliestStart)
        : null,
      timeToLastTokenMs: lastTokenEvent
        ? Math.max(0, lastTokenEvent.timeUnixMs - earliestStart)
        : null,
    };
  }

  private deriveStatusFlags(
    spans: readonly SpanData[],
  ): ProjectionHeuristicResult {
    const hasError = spans.some((span) => span.status.code === 2);
    const hasOk = spans.some((span) => span.status.code === 1);

    return {
      containsErrorStatus: hasError,
      containsOKStatus: hasOk,
    };
  }

  private deriveModelInfo(
    spans: readonly SpanData[],
  ): ProjectionHeuristicResult {
    const models = this.collectUniqueAttributeValues(
      spans,
      MODEL_ATTRIBUTE_KEYS,
    );
    return {
      models: models.length ? models.join(",") : null,
    };
  }

  private aggregateTokenMetrics(
    spans: readonly SpanData[],
  ): ProjectionHeuristicResult {
    const totalPromptTokenCount = this.sumAttributes(spans, PROMPT_TOKEN_KEYS);
    const totalCompletionTokenCount = this.sumAttributes(
      spans,
      COMPLETION_TOKEN_KEYS,
    );

    return {
      totalPromptTokenCount: totalPromptTokenCount ?? null,
      totalCompletionTokenCount: totalCompletionTokenCount ?? null,
    };
  }

  private deriveTokensPerSecond(
    metrics: ProjectionHeuristicResult,
  ): ProjectionHeuristicResult {
    if (
      metrics.totalCompletionTokenCount === null ||
      metrics.totalCompletionTokenCount === void 0 ||
      !metrics.totalDurationMs ||
      metrics.totalDurationMs <= 0
    ) {
      return { tokensPerSecond: null };
    }

    const seconds = metrics.totalDurationMs / 1000;
    const rate =
      seconds > 0 ? metrics.totalCompletionTokenCount / seconds : null;
    return {
      tokensPerSecond: rate ? Math.round(rate) : null,
    };
  }

  private mergeHeuristics(
    base: TraceProjectionData,
    ...partials: ProjectionHeuristicResult[]
  ): TraceProjectionData {
    return partials.reduce<TraceProjectionData>(
      (acc, partial) => ({
        ...acc,
        ...partial,
        computedMetadata: {
          ...acc.computedMetadata,
          ...partial.computedMetadata,
        },
      }),
      base,
    );
  }

  private findFirstAttribute(
    spans: readonly SpanData[],
    keys: readonly string[],
  ): string | null {
    for (const span of spans) {
      for (const key of keys) {
        const value = span.attributes?.[key];
        if (typeof value === "string" && value.length > 0) {
          return value;
        }
      }
    }
    return null;
  }

  private collectUniqueAttributeValues(
    spans: readonly SpanData[],
    keys: readonly string[],
  ): string[] {
    const values = new Set<string>();
    for (const span of spans) {
      for (const key of keys) {
        const value = span.attributes?.[key];
        if (typeof value === "string" && value.length > 0) {
          values.add(value);
        }
      }
    }
    return [...values];
  }

  private sumAttributes(
    spans: readonly SpanData[],
    keys: readonly string[],
  ): number | undefined {
    let total: number | undefined;
    for (const span of spans) {
      for (const key of keys) {
        const raw = span.attributes?.[key];
        const parsed = typeof raw === "string" ? Number(raw) : raw;
        if (typeof parsed === "number" && !Number.isNaN(parsed)) {
          total = (total ?? 0) + parsed;
        }
      }
    }
    return total;
  }

  private findEventByRegex(spans: readonly SpanData[], regex: RegExp) {
    for (const span of spans) {
      const event = span.events.find((eventItem) => regex.test(eventItem.name));
      if (event) {
        return event;
      }
    }
    return null;
  }
}

// Export singleton instance for convenience
export const traceProjectionService = new TraceProjectionService();

// Export convenience function for backward compatibility
export function buildTraceProjection(
  tenantId: string,
  traceId: string,
  spans: readonly SpanData[],
): TraceProjectionData {
  return traceProjectionService.buildTraceProjection(tenantId, traceId, spans);
}
