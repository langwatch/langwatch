import type { LLMModeTrace, Span, Trace } from "~/server/tracer/types";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type SpanWithChildren = Span & { children: SpanWithChildren[] };

/**
 * Build a tree structure from a flat list of spans using parent_id references.
 */
const buildTree = (spans: Span[]): Record<string, SpanWithChildren> => {
  const lookup: Record<string, SpanWithChildren> = {};

  spans.forEach((span) => {
    lookup[span.span_id] = { ...span, children: [] };
  });

  spans.forEach((span) => {
    const lookupSpan = lookup[span.span_id];
    if (span.parent_id && lookup[span.parent_id] && lookupSpan) {
      lookup[span.parent_id]?.children.push?.(lookupSpan);
    }
  });

  return lookup;
};

/**
 * Generate an ASCII tree representation from a list of spans.
 *
 * Produces output like:
 * ```
 * .
 * └── llm: chat (gpt-4)
 *     ├── rag: retrieve
 *     └── tool: search
 * ```
 */
export const generateAsciiTree = (spans: Span[]): string => {
  const tree = buildTree(spans);

  // Find root spans (spans without parents or with parents not in the spans list)
  const spansById = spans.reduce(
    (acc, span) => {
      acc[span.span_id] = span;
      return acc;
    },
    {} as Record<string, Span>,
  );

  const rootSpans = spans.filter(
    (s) => !s.parent_id || !spansById[s.parent_id],
  );

  let result = ".\n";

  // Recursively build the tree
  const buildAsciiTree = (
    span: SpanWithChildren,
    prefix: string,
    isLast: boolean,
  ): void => {
    // Add current span to result
    const connector = isLast ? "└── " : "├── ";
    const displayName = `${span.type || "unknown"}${
      span.name ? `: ${span.name}` : ""
    }${span.type === "llm" && "model" in span ? ` (${span.model})` : ""}`;
    result += `${prefix}${connector}${displayName}\n`;

    // Prepare prefix for children
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    // Add children
    span.children.forEach((child, index) => {
      buildAsciiTree(child, childPrefix, index === span.children.length - 1);
    });
  };

  // Process each root span
  rootSpans.forEach((rootSpan, index) => {
    const span = tree[rootSpan.span_id];
    if (span) {
      buildAsciiTree(span, "", index === rootSpans.length - 1);
    }
  });

  return result;
};

/**
 * Convert a Trace to an LLM-friendly format with human-readable timestamps
 * and an ASCII tree representation.
 */
export const toLLMModeTrace = (
  trace: Trace,
  asciiTree?: string,
): LLMModeTrace => {
  return {
    ...trace,
    ascii_tree: asciiTree ?? generateAsciiTree(trace.spans),
    timestamps: {
      started_at:
        formatTimeAgo(new Date(trace.timestamps?.started_at).getTime()) ?? "",
      inserted_at:
        formatTimeAgo(new Date(trace.timestamps?.inserted_at).getTime()) ?? "",
      updated_at:
        formatTimeAgo(new Date(trace.timestamps?.updated_at).getTime()) ?? "",
    },
  };
};
