import { useMemo } from "react";
import { useViewStore } from "../stores/viewStore";
import { useSessionGroups } from "./useSessionGroups";
import { useTraceListQuery } from "./useTraceListQuery";

export interface ExplorerCounts {
  /**
   * Rows matching the active query in the exact window, with the hidden
   * origins left out: the count `tracesV2.list` (or `tracesV2.sessions` on
   * the Conversations lens) returns with the page.
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
}

/**
 * The one number every count on the Explorer reads: the selection header,
 * the pagination line and the sidebar total. It is the count the list read
 * already returned, so there is no second count query for the same filter,
 * and no two surfaces can disagree.
 */
export function useExplorerCounts(): ExplorerCounts {
  const list = useTraceListQuery();
  const sessions = useSessionGroups();
  const byConversation = useViewStore((s) => s.grouping) === "by-conversation";
  const pageTraceIds = useMemo(
    () => (byConversation ? [] : list.data.map((t) => t.traceId)),
    [byConversation, list.data],
  );

  if (byConversation) {
    return {
      totalHits: sessions.totalHits,
      itemNoun: "conversations",
      pageTraceIds,
      isLoading: sessions.isLoading,
      isFetching: sessions.isFetching,
      isPlaceholderData: sessions.isPlaceholderData,
    };
  }
  return {
    totalHits: list.totalHits,
    itemNoun: "traces",
    pageTraceIds,
    isLoading: list.isLoading,
    isFetching: list.isFetching,
    isPlaceholderData: list.isPlaceholderData,
  };
}
