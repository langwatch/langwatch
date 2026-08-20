// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cursor-walk arithmetic for the source events table.
 *
 * The server (`activityMonitor.eventsForSource`) pages by timestamp
 * only: strictly-older-than `beforeIso`, newest first, sliced to
 * `limit`, no total and no id tiebreak on the wire. Walking it naively
 * — "next cursor = last row's timestamp" — permanently skips any event
 * that shares the boundary millisecond with the last row but fell off
 * the server's slice.
 *
 * So every next-page request overlaps the boundary by one millisecond
 * and names the rows already shown there, to be dropped from the
 * response. One sentinel row beyond the page size doubles as the
 * has-more signal. The recovery holds while a single tied millisecond
 * fits in one server fetch (`SERVER_MAX_LIMIT`); past that the walk
 * skips the remainder deterministically rather than looping.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (rule "The events table pages through everything the source
 *       ever ingested")
 */

/** The two fields the walk itself needs from an event. */
export type PagerRow = {
  eventId: string;
  eventTimestampIso: string;
};

export type PageRequest = {
  /** Absent on the first page: the server anchors at its own "now". */
  beforeIso: string | undefined;
  limit: number;
  /** Rows already displayed at the boundary millisecond, to discard. */
  dropIds: readonly string[];
};

/** `eventsForSource`'s input schema caps `limit` at 200. */
export const SERVER_MAX_LIMIT = 200;

const tsMs = (row: PagerRow) => Date.parse(row.eventTimestampIso);

/** All trailing displayed rows that share the last row's millisecond. */
const boundaryTies = (displayedRows: readonly PagerRow[]): PagerRow[] => {
  const last = displayedRows[displayedRows.length - 1];
  if (!last) return [];
  const boundaryMs = tsMs(last);
  const ties: PagerRow[] = [];
  for (let i = displayedRows.length - 1; i >= 0; i--) {
    if (tsMs(displayedRows[i]!) !== boundaryMs) break;
    ties.unshift(displayedRows[i]!);
  }
  return ties;
};

/**
 * The request for the page after `displayedRows` (empty → first page).
 * One extra row is always asked for: it is never displayed, its
 * presence is what proves another page exists.
 */
export function buildPageRequest({
  pageSize,
  displayedRows,
}: {
  pageSize: number;
  displayedRows: readonly PagerRow[];
}): PageRequest {
  const last = displayedRows[displayedRows.length - 1];
  if (!last) {
    return {
      beforeIso: undefined,
      limit: Math.min(pageSize + 1, SERVER_MAX_LIMIT),
      dropIds: [],
    };
  }
  const dropIds = boundaryTies(displayedRows).map((row) => row.eventId);
  return {
    // One millisecond PAST the boundary, so the strict `<` on the server
    // re-includes the boundary millisecond and its cut-off siblings.
    beforeIso: new Date(tsMs(last) + 1).toISOString(),
    limit: Math.min(pageSize + dropIds.length + 1, SERVER_MAX_LIMIT),
    dropIds,
  };
}

/**
 * When a full response contained nothing new (a tied millisecond wider
 * than one fetch), move strictly past the boundary. Ties still unseen
 * there are knowingly skipped — the alternative is re-fetching the same
 * window forever.
 */
export function stallSkipRequest({
  pageSize,
  displayedRows,
}: {
  pageSize: number;
  displayedRows: readonly PagerRow[];
}): PageRequest {
  const last = displayedRows[displayedRows.length - 1];
  return {
    beforeIso: last ? new Date(tsMs(last)).toISOString() : undefined,
    limit: Math.min(pageSize + 1, SERVER_MAX_LIMIT),
    dropIds: [],
  };
}

export function absorbFetch<R extends PagerRow>({
  pageSize,
  request,
  fetched,
}: {
  pageSize: number;
  request: PageRequest;
  fetched: readonly R[];
}): { rows: R[]; hasMore: boolean; stalled: boolean } {
  const drop = new Set(request.dropIds);
  const fresh = fetched.filter((row) => !drop.has(row.eventId));
  const fullResponse = fetched.length >= request.limit;
  return {
    rows: fresh.slice(0, pageSize),
    // The sentinel row proves more; a full response with the sentinel
    // eaten by drops can only assume it.
    hasMore: fresh.length > pageSize || fullResponse,
    stalled: fresh.length === 0 && fullResponse,
  };
}

/**
 * What the pagination bar may honestly claim without a server total:
 * the rows actually loaded, plus one sentinel row while more exist —
 * enough to keep a "next" page open without ever printing a total.
 */
export function paginationView({
  loadedCount,
  loadedPages,
  hasMore,
}: {
  loadedCount: number;
  loadedPages: number;
  hasMore: boolean;
}): {
  totalCount: number;
  canGoNext: boolean;
  maxReachablePage: number;
  isPageReachable: (page: number) => boolean;
} {
  const maxReachablePage = loadedPages + (hasMore ? 1 : 0);
  return {
    totalCount: loadedCount + (hasMore ? 1 : 0),
    canGoNext: hasMore,
    maxReachablePage,
    isPageReachable: (page) => page >= 1 && page <= maxReachablePage,
  };
}
