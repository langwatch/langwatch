/**
 * The stop signal and the owner record for a running workbench execution.
 *
 * A run is a long loop over cells on one process, and the request to stop it
 * arrives on another, so both facts have to live somewhere every replica sees.
 * The owner is part of the same port rather than a second one because the
 * interactive workbench never creates a polling run-state record, so the
 * project recorded at the start is the only thing an abort can be authorized
 * against.
 */
export abstract class ExperimentRunAbortPort {
  /** Asks the run to stop. */
  abstract requestAbort(runId: string): Promise<void>;
  /** Whether a stop was asked for. Answers false where nothing recorded one. */
  abstract isAborted(runId: string): Promise<boolean>;
  /** Drops the flag once the run has finished with it. */
  abstract clearAbort(runId: string): Promise<void>;
  /** Records which project owns an in-flight run. */
  abstract setRunning(input: { runId: string; projectId: string }): Promise<void>;
  /** The project that owns an in-flight run, or null when none is running. */
  abstract getRunningProjectId(runId: string): Promise<string | null>;
  /** Drops the owner record once the run has finished. */
  abstract clearRunning(runId: string): Promise<void>;
}
