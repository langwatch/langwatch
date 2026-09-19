import { create } from "zustand";
import type { InstantEvalExplorerRun } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";

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
  setRun: (run: InstantEvalExplorerRun) => void;
  markStopped: (runId: string) => void;
  /** Drop runs the query no longer names. */
  keepOnly: (runIds: readonly string[]) => void;
}

export const useInstantEvalRunStore = create<InstantEvalRunState>((set) => ({
  runs: {},
  stoppedByUser: {},
  setRun: (run) =>
    set((state) => {
      const previous = state.runs[run.id];
      if (
        previous &&
        previous.status === run.status &&
        previous.progress === run.progress &&
        previous.matched === run.matched &&
        previous.total === run.total
      ) {
        return state;
      }
      return { runs: { ...state.runs, [run.id]: run } };
    }),
  markStopped: (runId) =>
    set((state) => ({
      stoppedByUser: { ...state.stoppedByUser, [runId]: true },
    })),
  keepOnly: (runIds) =>
    set((state) => {
      const keep = new Set(runIds);
      const runs = Object.fromEntries(
        Object.entries(state.runs).filter(([id]) => keep.has(id)),
      );
      return Object.keys(runs).length === Object.keys(state.runs).length
        ? state
        : { runs };
    }),
}));
