import type { TraceEvalResult, TraceListItem } from "../types/trace.ts";
import { NO_TRACE_EVENTS } from "../types/trace.ts";

/**
 * Normalize the raw `traces.list` payload into `TraceListItem` rows: narrow each row's
 * evaluations to what a cell renders and default the optional spanCount field. Each row
 * carries its own evaluations, matched by project and trace id on the server, so two rows
 * with the same trace id (an aggregate's members) never share them.
 */
export function mapTraceListPayload(data: { items: TraceListItem[] } | undefined): TraceListItem[] {
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
