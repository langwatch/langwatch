import type { ExperimentRunProgressState } from "../repositories/experiment-run-fold.repository.ts";

/**
 * A run awaits its start until `started` numbers its first frame: a requested evaluation is
 * stored running before that, as main registered it, and a refusal before it is stored failed.
 */
export function runAwaitsStart(state: ExperimentRunProgressState): boolean {
  return state.status === "pending" || (state.status === "running" && state.seq === 0);
}

/**
 * A requested evaluation runs unless its start is already folded. A fold that has not caught up
 * reads as untouched: a second StartExperimentRun is dropped by its idempotency key.
 */
export function requestedRunIsUntouched({
  state,
  experimentId,
}: {
  state: ExperimentRunProgressState | undefined;
  experimentId: string;
}): boolean {
  if (!state || state.experimentId !== experimentId) return true;

  return runAwaitsStart(state);
}
