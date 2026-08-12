/**
 * What an automation watches, in one line (ADR-093 §1).
 *
 * The merged flow has exactly two answers — a trace filter or a graph — and
 * three surfaces have to say the same thing about them: the unified list's
 * "Watches" column, the wizard's step rail, and the review overview. Keeping
 * the wording here means the list and the composer can never drift into two
 * vocabularies again, which is the defect class the merge exists to close.
 */
export interface WatchSummary {
  /** The primary phrase — "Trace filter" or "Graph · <name>". */
  label: string;
  /** The specific thing being watched, when there is one to name. */
  detail: string | null;
}

export function watchSummary({
  watchesGraph,
  graphName,
  filterQuery,
  hasStructuredFilters = false,
}: {
  watchesGraph: boolean;
  /** The watched graph's name, once its row has loaded. */
  graphName?: string | null;
  filterQuery?: string | null;
  /** A legacy automation authored with structured filters instead of a query. */
  hasStructuredFilters?: boolean;
}): WatchSummary {
  if (watchesGraph) {
    const name = graphName?.trim();
    return { label: name ? `Graph · ${name}` : "Graph", detail: null };
  }
  const query = filterQuery?.trim();
  return {
    label: "Trace filter",
    detail: query ? query : hasStructuredFilters ? "Structured filters" : null,
  };
}

/** The same summary as a single line, for a rail item or a table cell. */
export function watchSummaryLine(summary: WatchSummary): string {
  return summary.detail
    ? `${summary.label} · ${summary.detail}`
    : summary.label;
}
