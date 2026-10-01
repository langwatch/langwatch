import type { ExplorerResults } from "@langwatch/trace-browser-kit";
import { buildFacetStateLookup, type ExplorerState, parse } from "@langwatch/trace-contract";

/** One value the query filters on, as the sidebar would show it. */
export interface ActiveFacet {
  field: string;
  value: string;
  state: "include" | "exclude";
}

/** The counters of the Instant Eval run still judging behind the query. */
export interface InstantEvalProgress {
  runId: string;
  judged: number;
  total: number | null;
  matched: number;
}

/** What `explorer.getState` answers from an open page. */
export interface LiveExplorerRead {
  source: "live";
  query: string;
  timeRange: { from: number; to: number; presetId?: string; label?: string };
  lens: { id: string; name?: string };
  sort: ExplorerState["sort"];
  grouping: ExplorerState["grouping"];
  page: number;
  pageSize: number;
  /** The count the table header shows, or null before the first answer. */
  totalHits: number | null;
  /** The noun the count is of: traces, or conversations. */
  itemNoun: string;
  /** The trace ids on the page, in table order. */
  pageTraceIds: string[];
  activeFacets: ActiveFacet[];
  selection: { mode: "explicit" | "all-matching"; traceIds: string[] };
  expandedRows: string[];
  evalRuns: Record<string, string>;
  instantEvalProgress?: InstantEvalProgress;
}

/** Every `field:value` the query names, included or excluded. */
export function activeFacetsOf(queryText: string): ActiveFacet[] {
  const trimmed = queryText.trim();
  if (!trimmed) return [];
  let lookup: ReturnType<typeof buildFacetStateLookup>;
  try {
    lookup = buildFacetStateLookup(parse(trimmed));
  } catch {
    return [];
  }
  const facets: ActiveFacet[] = [];
  for (const [key, state] of lookup) {
    if (state === "neutral") continue;
    const separator = key.indexOf("|");
    facets.push({ field: key.slice(0, separator), value: key.slice(separator + 1), state });
  }
  return facets;
}

/**
 * The Explorer as the agent should read it from an open page: `source` mirrors
 * the away fallback's marker, and the count is the one the header shows, so an
 * answer that quotes it and the screen agree.
 */
export function readLiveExplorer({
  state,
  results,
  lensName,
  instantEvalProgress,
}: {
  state: ExplorerState;
  results: ExplorerResults;
  lensName?: string;
  instantEvalProgress?: InstantEvalProgress | null;
}): LiveExplorerRead {
  const { from, to, presetId, label } = state.timeRange;
  return {
    source: "live",
    query: state.queryText,
    timeRange: {
      from,
      to,
      ...(presetId ? { presetId } : {}),
      ...(label ? { label } : {}),
    },
    lens: { id: state.activeLensId, ...(lensName ? { name: lensName } : {}) },
    sort: state.sort,
    grouping: state.grouping,
    page: state.page,
    pageSize: state.pageSize,
    totalHits: results.totalHits,
    itemNoun: results.itemNoun,
    pageTraceIds: results.pageTraceIds,
    activeFacets: activeFacetsOf(state.queryText),
    selection: {
      mode: state.selection.mode,
      traceIds: Array.from(state.selection.traceIds),
    },
    expandedRows: Array.from(state.expandedRows),
    evalRuns: state.evalRuns,
    ...(instantEvalProgress ? { instantEvalProgress } : {}),
  };
}
