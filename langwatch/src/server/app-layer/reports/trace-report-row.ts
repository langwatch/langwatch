import type { TraceListItem } from "~/server/app-layer/traces/trace-list.service";

/** Max chars of the input snippet carried into a single report-row line. */
const ROW_SNIPPET_MAX = 120;

/**
 * Render a trace-list item as one compact report-row line
 * (`<traceId> — <input snippet>`). The snippet is whitespace-collapsed and
 * length-capped so a report stays scannable; the report template pipes every
 * row through `mrkdwn_escape`, so this function deliberately does no escaping
 * of its own. Falls back to the bare trace id when the trace carries no input
 * preview (e.g. teaser-redacted by the visibility window).
 */
export function formatTraceReportRow(item: TraceListItem): string {
  const snippet = (item.input ?? "").replace(/\s+/g, " ").trim();
  if (!snippet) return item.traceId;
  const capped =
    snippet.length > ROW_SNIPPET_MAX
      ? `${snippet.slice(0, ROW_SNIPPET_MAX - 1)}…`
      : snippet;
  return `${item.traceId} — ${capped}`;
}
