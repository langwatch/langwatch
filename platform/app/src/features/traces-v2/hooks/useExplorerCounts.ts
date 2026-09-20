import { useEffect, useMemo } from "react";
import type { InstantEvalExplorerRun } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { useExplorerStore } from "../stores/explorerStore";
import {
  type InstantEvalRunPhase,
  instantEvalRunPhase,
  useInstantEvalRunStore,
} from "../stores/instantEvalRunStore";
import { useInstantEvalRuns } from "./useInstantEvalRuns";
import { useSessionGroups } from "./useSessionGroups";
import { useTraceListQuery } from "./useTraceListQuery";

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
   * The Instant Eval run behind the query that has not settled, or null.
   * Until it settles, `summary` reads its counters rather than the list's
   * total, so a Stop never leaves a total the next read replaces.
   */
  instantEval: ActiveInstantEval | null;
  /** The one sentence every count on the page shows. */
  summary: string;
}

/** One run's counters while it has not settled, or null once it has. */
function unsettledInstantEval({
  run,
  isStopRequested,
  isSettled,
}: {
  run: InstantEvalExplorerRun;
  isStopRequested: boolean;
  isSettled: boolean;
}): ActiveInstantEval | null {
  const phase = instantEvalRunPhase({ run, isStopRequested, isSettled });
  if (phase === "settled") return null;
  return {
    runId: run.id,
    judged: run.progress,
    total: run.total,
    matched: run.matched ?? 0,
    phase,
  };
}

/** The first run behind the query's chips that has not settled, or null. */
function firstUnsettledInstantEval({
  chips,
  runs,
  stoppedByUser,
  settled,
}: {
  chips: readonly { runId: string | null }[];
  runs: Readonly<Record<string, InstantEvalExplorerRun>>;
  stoppedByUser: Readonly<Record<string, true>>;
  settled: Readonly<Record<string, true>>;
}): ActiveInstantEval | null {
  for (const { runId } of chips) {
    const run = runId === null ? undefined : runs[runId];
    if (!run) continue;
    const unsettled = unsettledInstantEval({
      run,
      isStopRequested: stoppedByUser[run.id] === true,
      isSettled: settled[run.id] === true,
    });
    if (unsettled) return unsettled;
  }
  return null;
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
  const stoppedByUser = useInstantEvalRunStore((s) => s.stoppedByUser);
  const settled = useInstantEvalRunStore((s) => s.settled);
  const instantEval = useMemo(
    () => firstUnsettledInstantEval({ chips, runs, stoppedByUser, settled }),
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
  // The store keeps the last answer so a reader of the page state (the
  // Langy `explorer.getState` action) sees the count the header shows.
  const setResults = useExplorerStore((s) => s.setResults);
  const { totalHits, itemNoun, isLoading, isFetching, isPlaceholderData } =
    counts;
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
