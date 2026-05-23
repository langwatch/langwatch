import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

export interface ErrorSpanRanked {
  span: SpanTreeNode;
  depth: number;
}

/**
 * Return every span whose status is `"error"`, ranked deepest-first
 * (the leaf that actually threw leads), then by start time as a
 * stable tiebreaker. Matches the ordering the trace-summary
 * Exceptions accordion uses so the header chip's tooltip and the
 * full accordion list can't drift apart.
 *
 * Returns an empty array when there are no error spans — caller code
 * should treat that as "fall back to trace-level error message only".
 */
export function rankedErrorSpans(spans: SpanTreeNode[]): ErrorSpanRanked[] {
  if (spans.length === 0) return [];
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = (spanId: string): number => {
    let depth = 0;
    let cur: SpanTreeNode | undefined = byId.get(spanId);
    // Track visited ids so a malformed graph with cyclic parent links
    // (e.g. an OTel exporter that mis-attributes parents) bails out
    // instead of hanging the ranker.
    const visited = new Set<string>();
    while (cur?.parentSpanId) {
      if (visited.has(cur.spanId)) break;
      visited.add(cur.spanId);
      const parent = byId.get(cur.parentSpanId);
      if (!parent) break;
      depth += 1;
      cur = parent;
    }
    return depth;
  };
  return spans
    .filter((s) => s.status === "error")
    .map((s) => ({ span: s, depth: depthOf(s.spanId) }))
    .sort((a, b) => {
      if (a.depth !== b.depth) return b.depth - a.depth;
      return a.span.startTimeMs - b.span.startTimeMs;
    });
}
