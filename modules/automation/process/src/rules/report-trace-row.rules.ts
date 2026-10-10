import { type ReportTraceRow, reportSnippet } from "@langwatch/automation-contract";
import { Temporal } from "@langwatch/time";
import type { TraceListItem } from "@langwatch/trace-contract";

import { tracePath } from "./automation-platform-url.rules.ts";

/** Map a trace-list item onto the report template context's typed trace row. */
export function toReportTraceRow({
  item,
  projectUrl,
}: {
  item: TraceListItem;
  projectUrl: string;
}): ReportTraceRow {
  return {
    traceId: item.traceId,
    url: `${projectUrl}${tracePath({ traceId: item.traceId, occurredAtMs: item.timestamp })}`,
    timestamp: Temporal.Instant.fromEpochMilliseconds(item.timestamp).toString({
      smallestUnit: "millisecond",
    }),
    input: reportSnippet(item.input),
    output: reportSnippet(item.output),
    model: (item.models ?? []).join(", "),
    status: item.status,
    costUsd: item.totalCost ?? 0,
    durationMs: item.durationMs ?? 0,
  };
}
