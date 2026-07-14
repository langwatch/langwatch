import type { TraceListItem } from "~/server/app-layer/traces/trace-list.service";
import {
  type ReportTraceRow,
  reportSnippet,
} from "@langwatch/automations/templating/templateContext";

/**
 * Map a trace-list item onto the report template context's typed trace row.
 *
 * Cost and duration stay NUMBERS here rather than being formatted into a
 * string: a Block Kit table renders them as numeric cells (which Slack aligns
 * and formats), and an email template can present them however it likes.
 * Input/output are snipped so a report stays scannable; the templates pipe
 * every string through `mrkdwn_escape`, so this does no escaping of its own.
 * An input-less trace (e.g. teaser-redacted by the visibility window) yields an
 * empty snippet, and the legacy `rows` line falls back to the bare trace id.
 */
export function toReportTraceRow({
  item,
  projectUrl,
}: {
  item: TraceListItem;
  projectUrl: string;
}): ReportTraceRow {
  return {
    traceId: item.traceId,
    url: `${projectUrl}/messages/${item.traceId}`,
    timestamp: new Date(item.timestamp).toISOString(),
    input: reportSnippet(item.input),
    output: reportSnippet(item.output),
    model: (item.models ?? []).join(", "),
    status: item.status,
    costUsd: item.totalCost ?? 0,
    durationMs: item.durationMs ?? 0,
  };
}
