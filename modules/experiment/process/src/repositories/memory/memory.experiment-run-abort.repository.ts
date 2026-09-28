import { ExperimentRunAbortRepository } from "../experiment-run-abort.repository.ts";

/** The stop signal in this process's memory, for tests and a deployment without Redis. */
export class MemoryExperimentRunAbortRepository extends ExperimentRunAbortRepository {
  static create(): MemoryExperimentRunAbortRepository {
    return new MemoryExperimentRunAbortRepository();
  }

  private readonly aborted = new Set<string>();

  private constructor() {
    super();
  }

  requestAbort(runId: string): Promise<void> {
    this.aborted.add(runId);
    return Promise.resolve();
  }

  isAborted(runId: string): Promise<boolean> {
    return Promise.resolve(this.aborted.has(runId));
  }
}
