import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import type { DerivedSpan, SortDirection, SortField } from "./types";

export const ROW_HEIGHT = 32;

export function deriveSpan(span: SpanTreeNode, rootStart: number): DerivedSpan {
  return {
    span,
    duration: span.durationMs,
    startOffset: span.startTimeMs - rootStart,
  };
}

export function formatOffset(ms: number): string {
  if (ms === 0) return "+0ms";
  if (ms < 1_000) return `+${Math.round(ms)}ms`;
  return `+${(ms / 1_000).toFixed(1)}s`;
}

export function compareDerived(
  a: DerivedSpan,
  b: DerivedSpan,
  field: SortField,
  direction: SortDirection,
): number {
  const mul = direction === "asc" ? 1 : -1;
  switch (field) {
    case "name":
      return mul * a.span.name.localeCompare(b.span.name);
    case "type":
      return mul * (a.span.type ?? "span").localeCompare(b.span.type ?? "span");
    case "duration":
      return mul * (a.duration - b.duration);
    case "model":
      return mul * (a.span.model ?? "").localeCompare(b.span.model ?? "");
    case "status": {
      const sa = a.span.status === "error" ? 0 : 1;
      const sb = b.span.status === "error" ? 0 : 1;
      return mul * (sa - sb);
    }
    case "start":
      return mul * (a.startOffset - b.startOffset);
    default:
      return 0;
  }
}
