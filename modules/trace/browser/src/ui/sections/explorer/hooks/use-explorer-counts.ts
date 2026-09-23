import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { useEffect, useMemo } from "react";

import {
  type InstantEvalRunPhase,
  selectInstantEvalRunPhase,
  useInstantEvalRunStore,
} from "../../../../behavior/instant-eval-run.store.ts";
import { explorerCountSummary } from "../../../../model/explorer/explorer-count-summary.ts";
import { useInstantEvalRuns } from "./use-instant-eval-runs.ts";
import { useSessionGroups } from "./use-session-groups.ts";
import { useTraceListQuery } from "./use-trace-list-query.ts";

/** The counters of the run behind the query that has not settled yet. */
export interface ActiveInstantEval {
  runId: string;
  judged: number;
  total: number | null;
  matched: number;
  /** Judging, asked to stop, or ended with its last verdicts still landing. */
  phase: Exclude<InstantEvalRunPhase, "settled">;
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
  const { chips } = useInstantEvalRuns();
  const runs = useInstantEvalRunStore((s) => s.runs);
  const stoppedByUser = useInstantEvalRunStore((s) => s.stoppedByUser);
  const settled = useInstantEvalRunStore((s) => s.settled);
  const instantEval = useMemo(
    () => firstUnsettledInstantEval({ chips, state: { runs, stoppedByUser, settled } }),
    [chips, runs, stoppedByUser, settled],
  );

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

/** The first run behind the query's chips that has not settled, or null. */
function firstUnsettledInstantEval({
  chips,
  state,
}: {
  chips: readonly { runId: string | null }[];
  state: Parameters<typeof selectInstantEvalRunPhase>[0];
}): ActiveInstantEval | null {
  for (const { runId } of chips) {
    const run = runId === null ? undefined : state.runs[runId];
    if (!run) continue;
    const phase = selectInstantEvalRunPhase(state, run.id);
    if (phase === null || phase === "settled") continue;
    return {
      runId: run.id,
      judged: run.progress,
      total: run.total,
      matched: run.matched ?? 0,
      phase,
    };
  }
  return null;
}
