import { useEffect, useMemo } from "react";
import { isInstantEvalRunActive } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { useExplorerStore } from "../stores/explorerStore";
import { useInstantEvalRunStore } from "../stores/instantEvalRunStore";
import { useInstantEvalRuns } from "./useInstantEvalRuns";
import { useSessionGroups } from "./useSessionGroups";
import { useTraceListQuery } from "./useTraceListQuery";

/** The counters of the run still judging behind the query, when one is. */
export interface ActiveInstantEval {
  runId: string;
  judged: number;
  total: number | null;
  matched: number;
}

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
  /**
   * The Instant Eval run still judging behind the query, or null. While it
   * judges, `summary` reads its counters rather than the settled total.
   */
  instantEval: ActiveInstantEval | null;
  /** The one sentence every count on the page shows. */
  summary: string;
}

/** The totals copy: the run's counters while it judges, the plain count after. */
export function explorerCountSummary({
  totalHits,
  itemNoun,
  instantEval,
}: {
  totalHits: number;
  itemNoun: string;
  instantEval: ActiveInstantEval | null;
}): string {
  if (instantEval) {
    const judged = instantEval.judged.toLocaleString();
    const total =
      instantEval.total === null ? "?" : instantEval.total.toLocaleString();
    return `${instantEval.matched.toLocaleString()} matched so far · ${judged} of ${total} judged`;
  }
  return `${totalHits.toLocaleString()} ${itemNoun}`;
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
  const byConversation =
    useExplorerStore((s) => s.grouping) === "by-conversation";
  const pageTraceIds = useMemo(
    () => (byConversation ? [] : list.data.map((t) => t.traceId)),
    [byConversation, list.data],
  );
  const { chips } = useInstantEvalRuns();
  const runs = useInstantEvalRunStore((s) => s.runs);
  const instantEval = useMemo<ActiveInstantEval | null>(() => {
    for (const chip of chips) {
      const run = chip.runId ? runs[chip.runId] : undefined;
      if (run && isInstantEvalRunActive(run.status)) {
        return {
          runId: run.id,
          judged: run.progress,
          total: run.total,
          matched: run.matched ?? 0,
        };
      }
    }
    return null;
  }, [chips, runs]);

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
  // The store keeps the last answer so a reader of the page state (the
  // Langy `explorer.getState` action) sees the count the header shows.
  const setResults = useExplorerStore((s) => s.setResults);
  const { totalHits, itemNoun, isLoading } = counts;
  useEffect(() => {
    setResults({
      totalHits: isLoading ? null : totalHits,
      itemNoun,
      pageTraceIds,
    });
  }, [setResults, totalHits, itemNoun, isLoading, pageTraceIds]);

  return {
    ...counts,
    pageTraceIds,
    instantEval,
    summary: explorerCountSummary({ ...counts, instantEval }),
  };
}
