/**
 * The stop signal for a running workbench execution, where every replica sees it. Abort is
 * authorised against the run's progress fold, not here.
 */
export abstract class ExperimentRunAbortRepository {
  /** Asks the run to stop. */
  abstract requestAbort(runId: string): Promise<void>;
  /** Whether a stop was asked for. Answers false where nothing recorded one. */
  abstract isAborted(runId: string): Promise<boolean>;
}
