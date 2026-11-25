import { format, formatDistanceToNow, nowInstant } from "@langwatch/time";
import type { LLMModeTrace, Span, Trace } from "@langwatch/trace-contract";

/**
 * "3 minutes ago", or a date once that stops being useful. Stated here rather than imported: a
 * server module may not import the browser package carrying the same narrowing. Wording and
 * thresholds must stay identical to that copy — a customer reads both in the same sentence.
 */
const formatTimeAgo = (timestamp: number, dateFormat = "dd/MMM HH:mm", maxHours = 24) => {
  if (!timestamp) {
    return undefined;
  }

  const olderThanWindow = timestamp < nowInstant().epochMilliseconds - 1000 * 60 * 60 * maxHours;

  return olderThanWindow
    ? format(timestamp, dateFormat)
    : formatDistanceToNow(timestamp, { addSuffix: true });
};

type SpanWithChildren = Span & { children: SpanWithChildren[] };

/** Build a tree structure from a flat list of spans using parent_id references. */
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

const SUMMARY_TRUNCATE_LENGTH = 200;

/** Truncates a string to the given length, appending "..." if truncated. */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength) + "...";
}

/**
 * Generate an ASCII tree representation from a list of spans, e.g. `.` / `└── llm: chat
 * (gpt-4)` / `    ├── rag: retrieve` / `    └── tool: search`.
 */
export function generateAsciiTree(spans: Span[]): string {
  const tree = buildTree(spans);
  const spanIds = new Set(spans.map((span) => span.span_id));
  const rootSpans = spans.filter((span) => !span.parent_id || !spanIds.has(span.parent_id));

  let result = ".\n";

  const buildAsciiTree = (span: SpanWithChildren, prefix: string, isLast: boolean): void => {
    const connector = isLast ? "└── " : "├── ";
    const displayName = `${span.type || "unknown"}${span.name ? `: ${span.name}` : ""}${
      span.type === "llm" && "model" in span ? ` (${span.model})` : ""
    }`;
    result += `${prefix}${connector}${displayName}\n`;

    const childPrefix = prefix + (isLast ? "    " : "│   ");

    span.children.forEach((child, index) => {
      buildAsciiTree(child, childPrefix, index === span.children.length - 1);
    });
  };

  rootSpans.forEach((rootSpan, index) => {
    const span = tree[rootSpan.span_id];
    if (span) {
      buildAsciiTree(span, "", index === rootSpans.length - 1);
    }
  });

  return result;
}

/** Formats a compact digest from trace summary data without requiring span data. */
export function formatTraceSummaryDigest(trace: {
  input?: { value: string } | null;
  output?: { value: string } | null;
}): string {
  const inputStr = trace.input?.value
    ? truncate(String(trace.input.value), SUMMARY_TRUNCATE_LENGTH)
    : "N/A";
  const outputStr = trace.output?.value
    ? truncate(String(trace.output.value), SUMMARY_TRUNCATE_LENGTH)
    : "N/A";

  return `Input: ${inputStr}\nOutput: ${outputStr}`;
}

/** Converts a trace to an LLM-friendly format with human-readable timestamps. */
export function toLLMModeTrace(trace: Trace, asciiTree?: string): LLMModeTrace {
  return {
    ...trace,
    ascii_tree: asciiTree ?? generateAsciiTree(trace.spans),
    timestamps: {
      started_at: formatTimeAgo(trace.timestamps?.started_at ?? NaN) ?? "",
      inserted_at: formatTimeAgo(trace.timestamps?.inserted_at ?? NaN) ?? "",
      updated_at: formatTimeAgo(trace.timestamps?.updated_at ?? NaN) ?? "",
    },
  };
}
