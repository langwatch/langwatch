import type { ExperimentRunProgressState } from "../repositories/experiment-run-progress.repository.ts";

/**
 * A requested evaluation runs only while its registered record is untouched, so a redelivered
 * request never runs the same cells twice. A record that expired or never landed is not ours.
 */
export function requestedRunIsUntouched(state: ExperimentRunProgressState | null): boolean {
  if (!state) return false;

  return state.status === "running" && state.progress === 0 && !state.recentEvents?.length;
}
