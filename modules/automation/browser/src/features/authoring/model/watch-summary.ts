/**
 * What an automation watches, in one line (ADR-093 §1). The list's "Watches"
 * column, the wizard's step rail and the review overview all say it from here,
 * so the list and the composer never drift into two vocabularies.
 */
export interface WatchSummary {
  /** The primary phrase: "Trace filter" or "Graph · <name>". */
  label: string;
  /** The specific thing being watched, when there is one to name. */
  detail: string | null;
}

/** Names what an automation watches: a graph by name, or a trace filter with its query. */
export function watchSummary({
  isWatchingGraph,
  graphName,
  filterQuery,
  hasStructuredFilters = false,
}: {
  isWatchingGraph: boolean;
  /** The watched graph's name, once its row has loaded. */
  graphName?: string | null;
  filterQuery?: string | null;
  /** A legacy automation authored with structured filters instead of a query. */
  hasStructuredFilters?: boolean;
}): WatchSummary {
  if (isWatchingGraph) {
    const name = graphName?.trim();
    return { label: name ? `Graph · ${name}` : "Graph", detail: null };
  }
  const query = filterQuery?.trim();
  if (query) return { label: "Trace filter", detail: query };
  return { label: "Trace filter", detail: hasStructuredFilters ? "Structured filters" : null };
}

/** The same summary as a single line, for a rail item or a table cell. */
export function watchSummaryLine(summary: WatchSummary): string {
  return summary.detail ? `${summary.label} · ${summary.detail}` : summary.label;
}
