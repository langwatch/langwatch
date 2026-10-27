import type { TraceEvalResult, TraceListItem } from "../types/trace.ts";
import { NO_TRACE_EVENTS } from "../types/trace.ts";

/**
 * Normalize the raw `traces.list` payload into `TraceListItem` rows: narrow each row's
 * evaluations to what a cell renders and default the optional counts. Evaluations are matched
 * by project and trace id on the server, so an aggregate's same-id rows never share them.
 */
export function mapTraceListPayload(
  data: { items: Omit<TraceListItem, "events">[] } | undefined,
): TraceListItem[] {
  if (!data) return [];
  return data.items.map((item) => ({
    ...item,
    spanCount: item.spanCount ?? 0,
    sizeBytes: item.sizeBytes ?? 0,
    evaluations: (item.evaluations ?? []).map((e): TraceEvalResult => ({
      evaluatorId: e.evaluatorId,
      evaluatorName: e.evaluatorName,
      status: e.status,
      score: e.score,
      passed: e.passed,
      label: e.label,
    })),
    events: NO_TRACE_EVENTS,
  }));
}
