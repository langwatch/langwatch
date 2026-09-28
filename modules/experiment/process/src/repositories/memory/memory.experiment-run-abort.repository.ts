import { ExperimentRunAbortRepository } from "../experiment-run-abort.repository.ts";

/** The stop signal in this process's memory, for tests and a deployment without Redis. */
export class MemoryExperimentRunAbortRepository extends ExperimentRunAbortRepository {
  static create(): MemoryExperimentRunAbortRepository {
    return new MemoryExperimentRunAbortRepository();
  }

  private readonly aborted = new Set<string>();
  private readonly running = new Map<string, string>();

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

  clearAbort(runId: string): Promise<void> {
    this.aborted.delete(runId);
    return Promise.resolve();
  }

  setRunning({ runId, projectId }: { runId: string; projectId: string }): Promise<void> {
    this.running.set(runId, projectId);
    return Promise.resolve();
  }

  findRunningProjectId(runId: string): Promise<string | null> {
    return Promise.resolve(this.running.get(runId) ?? null);
  }

  clearRunning(runId: string): Promise<void> {
    this.running.delete(runId);
    return Promise.resolve();
  }
}
