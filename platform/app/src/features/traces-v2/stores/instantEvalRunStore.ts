import { create } from "zustand";
import {
  type InstantEvalExplorerRun,
  isInstantEvalRunActive,
} from "~/server/app-layer/instant-evals/run/instant-eval-explorer";

/**
 * Where a run is, as the page shows it.
 *
 * A run does not stop the moment it is asked to, and its counters can still
 * move for a moment after its status turns terminal, because the page it held
 * when it was stopped lands its verdicts last. So the page keeps reading until
 * the counters hold still, and only then calls the numbers final:
 *
 *  - `judging`: the run is active.
 *  - `stopping`: the run is active and this page asked it to stop.
 *  - `settling`: the status is terminal, the counters may still move.
 *  - `settled`: terminal, the counters held still and the table read them.
 *  - `interrupted`: observed reporting impairment, independent of execution.
 *  - `unavailable`: a status read failed; last counters may be outdated.
 */
export type InstantEvalRunPhase =
  | "judging"
  | "stopping"
  | "settling"
  | "settled"
  | "interrupted"
  | "unavailable";

/**
 * A run read for the first time this long after it ended is taken as settled:
 * a reload or a shared link of a finished run has nothing left to wait for.
 */
export const INSTANT_EVAL_SETTLE_GRACE_MS = 15_000;

export function instantEvalRunPhase({
  run,
  isStopRequested,
  isSettled,
  isReadUnavailable = false,
}: {
  run: Pick<InstantEvalExplorerRun, "status" | "processingBlock">;
  isStopRequested: boolean;
  isSettled: boolean;
  isReadUnavailable?: boolean;
}): InstantEvalRunPhase {
  if (run.processingBlock) return "interrupted";
  if (isReadUnavailable) return "unavailable";
  if (isInstantEvalRunActive(run.status)) {
    return isStopRequested ? "stopping" : "judging";
  }
  return isSettled ? "settled" : "settling";
}

function hasSameCounters(
  a: InstantEvalExplorerRun,
  b: InstantEvalExplorerRun,
): boolean {
  return (
    a.status === b.status &&
    a.progress === b.progress &&
    a.matched === b.matched &&
    a.total === b.total
  );
}

/**
 * The counters of the Instant Eval runs behind the query's `eval` chips, as
 * the poll last read them. Written by `useInstantEvalRunWatch`, read by the
 * progress bar, the counts and the chip marks, so none of them polls on its
 * own and all of them read one snapshot.
 */
interface InstantEvalRunState {
  runs: Record<string, InstantEvalExplorerRun>;
  /** Runs the user stopped from this page, so a cancelled run reads as theirs. */
  stoppedByUser: Record<string, true>;
  /** Ended runs whose counters came back unchanged on a second read. */
  quiet: Record<string, true>;
  /** Quiet runs whose final numbers the table and the sidebar have read. */
  settled: Record<string, true>;
  readUnavailable: Record<string, true>;
  markReadUnavailable: (runId: string) => void;
  setRun: (run: InstantEvalExplorerRun, now?: number) => void;
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
  run: InstantEvalExplorerRun;
  now: number;
}): Partial<InstantEvalRunState> {
  const runs = { ...state.runs, [run.id]: run };
  const endedLongAgo =
    !run.processingBlock &&
    !isInstantEvalRunActive(run.status) &&
    run.finishedAtMs !== null &&
    now - run.finishedAtMs > INSTANT_EVAL_SETTLE_GRACE_MS;
  if (!endedLongAgo) return { runs };
  return {
    runs,
    quiet: { ...state.quiet, [run.id]: true },
    settled: { ...state.settled, [run.id]: true },
  };
}

function only<T>(
  record: Record<string, T>,
  keep: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([id]) => keep.has(id)),
  );
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== id),
  );
}

export const useInstantEvalRunStore = create<InstantEvalRunState>((set) => ({
  runs: {},
  stoppedByUser: {},
  quiet: {},
  settled: {},
  readUnavailable: {},
  markReadUnavailable: (runId) =>
    set((state) =>
      state.readUnavailable[runId]
        ? state
        : {
            readUnavailable: { ...state.readUnavailable, [runId]: true },
            quiet: without(state.quiet, runId),
            settled: without(state.settled, runId),
          },
    ),
  setRun: (incoming, now = Date.now()) =>
    set((state) => {
      const previous = state.runs[incoming.id];
      const run =
        previous?.processingBlock && !incoming.processingBlock
          ? { ...incoming, processingBlock: previous.processingBlock }
          : incoming;
      const readUnavailable = without(state.readUnavailable, run.id);
      if (run.processingBlock) {
        return {
          runs: { ...state.runs, [run.id]: run },
          quiet: without(state.quiet, run.id),
          settled: without(state.settled, run.id),
          readUnavailable,
        };
      }
      if (!previous)
        return { ...withFirstRead({ state, run, now }), readUnavailable };
      const isQuiet =
        !state.readUnavailable[run.id] &&
        hasSameCounters(previous, run) &&
        !isInstantEvalRunActive(run.status);
      return {
        runs: { ...state.runs, [run.id]: run },
        readUnavailable,
        ...(isQuiet ? { quiet: { ...state.quiet, [run.id]: true } } : {}),
      };
    }),
  markStopped: (runId) =>
    set((state) => ({
      stoppedByUser: { ...state.stoppedByUser, [runId]: true },
    })),
  markSettled: (runId) =>
    set((state) =>
      !state.runs[runId] ||
      state.runs[runId]?.processingBlock ||
      state.readUnavailable[runId] ||
      state.settled[runId]
        ? state
        : { settled: { ...state.settled, [runId]: true } },
    ),
  keepOnly: (runIds) =>
    set((state) => {
      const keep = new Set(runIds);
      const runs = only(state.runs, keep);
      if (
        Object.keys(runs).length === Object.keys(state.runs).length &&
        Object.keys(state.readUnavailable).every((id) => keep.has(id))
      ) {
        return state;
      }
      return {
        runs,
        readUnavailable: only(state.readUnavailable, keep),
        stoppedByUser: only(state.stoppedByUser, keep),
        quiet: only(state.quiet, keep),
        settled: only(state.settled, keep),
      };
    }),
}));

/** The phase of one run in the store, or null when the store has no such run. */
export function selectInstantEvalRunPhase(
  state: Pick<InstantEvalRunState, "runs" | "stoppedByUser" | "settled"> &
    Partial<Pick<InstantEvalRunState, "readUnavailable">>,
  runId: string,
): InstantEvalRunPhase | null {
  const run = state.runs[runId];
  if (!run) return state.readUnavailable?.[runId] ? "unavailable" : null;
  return instantEvalRunPhase({
    run,
    isStopRequested: state.stoppedByUser[runId] === true,
    isSettled: state.settled[runId] === true,
    isReadUnavailable: state.readUnavailable?.[runId] === true,
  });
}
