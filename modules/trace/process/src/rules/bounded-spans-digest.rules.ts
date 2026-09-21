import type { Span } from "@langwatch/trace-contract";

/**
 * The order spans are worth expanding in: what failed, then what the model
 * did, then what took the longest. Ties keep the trace's own order, so two
 * identical traces produce identical output.
 */
export function rankSpansForExpansion(spans: Span[]): Span[] {
  return spans
    .map((span, index) => ({ span, index }))
    .toSorted((a, b) => {
      const priority = spanPriority(a.span) - spanPriority(b.span);
      if (priority !== 0) return priority;
      const duration = spanDurationMs(b.span) - spanDurationMs(a.span);
      if (duration !== 0) return duration;
      return a.index - b.index;
    })
    .map(({ span }) => span);
}

function spanPriority(span: Span): number {
  if (span.error) return 0;
  if (span.type === "llm") return 1;
  return 2;
}

function spanDurationMs(span: Span): number {
  return span.timestamps.finished_at - span.timestamps.started_at;
}
