/**
 * The counters of the runs behind the query's `eval` chips, as the poll last
 * read them: written by `useInstantEvalRunWatch`, read by the bar and the
 * chips, so all of them read one snapshot.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { nowInstant } from "@langwatch/time";
import {
  type ExplorerInstantEvalProgress,
  isExplorerInstantEvalRunActive,
} from "@langwatch/trace-contract";
import { create } from "zustand";

/**
 * Where a run is, as the page shows it. Counters can still move after the
 * status turns terminal, so the page reads until they hold still.
 */
export type InstantEvalRunPhase = "judging" | "stopping" | "settling" | "settled";

/**
 * A run read for the first time this long after it ended is taken as settled:
 * a reload or a shared link of a finished run has nothing left to wait for.
 */
export const INSTANT_EVAL_SETTLE_GRACE_MS = 15_000;

export function instantEvalRunPhase({
  run,
  isStopRequested,
  isSettled,
}: {
  run: Pick<ExplorerInstantEvalProgress, "status">;
  isStopRequested: boolean;
  isSettled: boolean;
}): InstantEvalRunPhase {
  if (isExplorerInstantEvalRunActive(run.status)) {
    return isStopRequested ? "stopping" : "judging";
  }
  return isSettled ? "settled" : "settling";
}

function hasSameCounters(a: ExplorerInstantEvalProgress, b: ExplorerInstantEvalProgress): boolean {
  return (
    a.status === b.status &&
    a.progress === b.progress &&
    a.matched === b.matched &&
    a.total === b.total
  );
}

interface InstantEvalRunState {
  runs: Record<string, ExplorerInstantEvalProgress>;
  /** Runs the reader stopped from this page, so a cancelled run reads as theirs. */
  stoppedByUser: Record<string, true>;
  /** Ended runs whose counters came back unchanged on a second read. */
  quiet: Record<string, true>;
  /** Quiet runs whose final numbers the table and the sidebar have read. */
  settled: Record<string, true>;
  setRun: (run: ExplorerInstantEvalProgress, now?: number) => void;
  markStopped: (runId: string) => void;
  markSettled: (runId: string) => void;
  /** Drop runs the query no longer names. */
  keepOnly: (runIds: readonly string[]) => void;
}

/** A run read for the first time: stored, and settled if it ended long ago. */
function withFirstRead({
  state,
  run,
  now,
}: {
  state: InstantEvalRunState;
  run: ExplorerInstantEvalProgress;
  now: number;
}): Partial<InstantEvalRunState> {
  const runs = { ...state.runs, [run.id]: run };
  const endedLongAgo =
    !isExplorerInstantEvalRunActive(run.status) &&
    run.finishedAtMs !== null &&
    now - run.finishedAtMs > INSTANT_EVAL_SETTLE_GRACE_MS;
  if (!endedLongAgo) return { runs };
  return {
    runs,
    quiet: { ...state.quiet, [run.id]: true },
    settled: { ...state.settled, [run.id]: true },
  };
}

/** A run read again: a moved counter is stored, a still one ends the run. */
function withRead({
  state,
  run,
  now,
}: {
  state: InstantEvalRunState;
  run: ExplorerInstantEvalProgress;
  now: number;
}): Partial<InstantEvalRunState> {
  const previous = state.runs[run.id];
  if (!previous) return withFirstRead({ state, run, now });
  if (!hasSameCounters(previous, run)) return { runs: { ...state.runs, [run.id]: run } };
  if (isExplorerInstantEvalRunActive(run.status) || state.quiet[run.id]) return state;
  return { quiet: { ...state.quiet, [run.id]: true } };
}

function only<T>(record: Record<string, T>, keep: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => keep.has(id)));
}

export const useInstantEvalRunStore = create<InstantEvalRunState>((set) => ({
  runs: {},
  stoppedByUser: {},
  quiet: {},
  settled: {},
  setRun: (run, now = nowInstant().epochMilliseconds) =>
    set((state) => withRead({ state, run, now })),
  markStopped: (runId) =>
    set((state) => ({ stoppedByUser: { ...state.stoppedByUser, [runId]: true } })),
  markSettled: (runId) =>
    set((state) =>
      state.settled[runId] ? state : { settled: { ...state.settled, [runId]: true } },
    ),
  keepOnly: (runIds) =>
    set((state) => {
      const keep = new Set(runIds);
      const runs = only(state.runs, keep);
      if (Object.keys(runs).length === Object.keys(state.runs).length) return state;
      return {
        runs,
        stoppedByUser: only(state.stoppedByUser, keep),
        quiet: only(state.quiet, keep),
        settled: only(state.settled, keep),
      };
    }),
}));

/** The phase of one run in the store, or null when the store has no such run. */
export function selectInstantEvalRunPhase(
  state: Pick<InstantEvalRunState, "runs" | "stoppedByUser" | "settled">,
  runId: string,
): InstantEvalRunPhase | null {
  const run = state.runs[runId];
  if (!run) return null;
  return instantEvalRunPhase({
    run,
    isStopRequested: state.stoppedByUser[runId] === true,
    isSettled: state.settled[runId] === true,
  });
}
