import type { ExperimentRunStateData } from "../eventing/experiment-run-state.projection.ts";

/**
 * Whether the run folded anything besides its completion. A run refused before its start folds
 * only `completed`, and main stored no run row for it.
 */
export function hasRunActivity(state: ExperimentRunStateData): boolean {
  return (
    state.StartedAt !== null ||
    state.Progress > 0 ||
    state.ScoreCount > 0 ||
    state.GradedCount > 0 ||
    state.Targets !== "[]" ||
    Object.keys(state.TraceMetrics).length > 0
  );
}
