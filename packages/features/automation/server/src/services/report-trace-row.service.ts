import { type ReportTraceRow, reportSnippet } from "@langwatch/automation-contract";
import type { TraceListItem } from "@langwatch/trace-contract";

export class ReportTraceRowService {
  static create(): ReportTraceRowService {
    return new ReportTraceRowService();
  }

  /**
   * Map a trace-list item onto the report template context's typed trace row.
   */
  static toReportTraceRow({
    item,
    projectUrl,
  }: {
    item: TraceListItem;
    projectUrl: string;
  }): ReportTraceRow {
    return {
      traceId: item.traceId,
      url: `${projectUrl}/traces/${item.traceId}`,
      timestamp: new Date(item.timestamp).toISOString(),
      input: reportSnippet(item.input),
      output: reportSnippet(item.output),
      model: (item.models ?? []).join(", "),
      status: item.status,
      costUsd: item.totalCost ?? 0,
      durationMs: item.durationMs ?? 0,
    };
  }
}
