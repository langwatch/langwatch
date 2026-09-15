/**
 * The stop signal and owner record for a running workbench execution. Both live in one place
 * so every replica sees them; abort authorization is tied to the project recorded at start.
 */
export abstract class ExperimentRunAbortRepository {
  /** Asks the run to stop. */
  abstract requestAbort(runId: string): Promise<void>;
  /** Whether a stop was asked for. Answers false where nothing recorded one. */
  abstract isAborted(runId: string): Promise<boolean>;
  /** Drops the flag once the run has finished with it. */
  abstract clearAbort(runId: string): Promise<void>;
  /** Records which project owns an in-flight run. */
  abstract setRunning(input: { runId: string; projectId: string }): Promise<void>;
  /** The project that owns an in-flight run, or null when none is running. */
  abstract findRunningProjectId(runId: string): Promise<string | null>;
  /** Drops the owner record once the run has finished. */
  abstract clearRunning(runId: string): Promise<void>;
}
