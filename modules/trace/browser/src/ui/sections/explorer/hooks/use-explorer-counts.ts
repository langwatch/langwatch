import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { useEffect, useMemo } from "react";

import { explorerCountSummary } from "../../../../model/explorer/explorer-count-summary.ts";
import { useSessionGroups } from "./use-session-groups.ts";
import { useTraceListQuery } from "./use-trace-list-query.ts";

/** The counters of the run behind the query that has not settled yet. */
export interface ActiveInstantEval {
  runId: string;
  judged: number;
  total: number | null;
  matched: number;
}

export interface ExplorerCounts {
  /**
   * Rows matching the active query in the exact window, with the hidden
   * origins left out: the count the list read returns with the page.
   */
  totalHits: number;
  /** What one row is, for the totals copy. */
  itemNoun: "traces" | "conversations";
  /** The trace ids on the page shown now; empty on the Conversations lens. */
  pageTraceIds: string[];
  isLoading: boolean;
  isFetching: boolean;
  /** The numbers shown belong to the previous input while the new one loads. */
  isPlaceholderData: boolean;
  /**
   * The Instant Eval run behind the query that has not settled, or null.
   * Until it settles, `summary` reads its counters rather than the list's
   * total, so a Stop never leaves a total the next read replaces.
   */
  instantEval: ActiveInstantEval | null;
  /** The one sentence every count on the page shows. */
  summary: string;
}

/**
 * The one number every count on the Explorer reads: the selection header, the
 * pagination line and the sidebar total. It is the count the list read already
 * answered, so no two surfaces can disagree and no second count is run.
 * @see specs/traces-v2/search.feature
 */
export function useExplorerCounts(): ExplorerCounts {
  const list = useTraceListQuery();
  const sessions = useSessionGroups();
  const byConversation = useExplorerStore((s) => s.grouping) === "by-conversation";
  const pageTraceIds = useMemo(
    () => (byConversation ? [] : list.data.map((trace) => trace.traceId)),
    [byConversation, list.data],
  );
  // The counters of a run still judging arrive with the Instant Eval browser
  // half, which this tree does not install yet; until then nothing on the page
  // reports progress and the summary is the plain count.
  const instantEval: ActiveInstantEval | null = null;

  const counts = byConversation
    ? {
        totalHits: sessions.totalHits,
        itemNoun: "conversations" as const,
        isLoading: sessions.isLoading,
        isFetching: sessions.isFetching,
        isPlaceholderData: sessions.isPlaceholderData,
      }
    : {
        totalHits: list.totalHits,
        itemNoun: "traces" as const,
        isLoading: list.isLoading,
        isFetching: list.isFetching,
        isPlaceholderData: list.isPlaceholderData,
      };

  // The store keeps the last answer so a reader of the page state (Langy's
  // `explorer.getState`) sees the count the page shows.
  const setResults = useExplorerStore((s) => s.setResults);
  const { totalHits, itemNoun, isLoading, isFetching, isPlaceholderData } = counts;
  const isSettled = !isLoading && !isFetching && !isPlaceholderData;
  useEffect(() => {
    setResults({
      totalHits: isLoading ? null : totalHits,
      itemNoun,
      pageTraceIds,
      isSettled,
    });
  }, [setResults, totalHits, itemNoun, isLoading, isSettled, pageTraceIds]);

  return {
    ...counts,
    pageTraceIds,
    instantEval,
    summary: explorerCountSummary({ ...counts, instantEval }),
  };
}
