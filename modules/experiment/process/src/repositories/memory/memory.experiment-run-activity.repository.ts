import { ExperimentRunActivityRepository } from "../experiment-run-activity.repository.ts";

/** The active runs in this process's memory, for tests and a deployment without Redis. */
export class MemoryExperimentRunActivityRepository extends ExperimentRunActivityRepository {
  static create(): MemoryExperimentRunActivityRepository {
    return new MemoryExperimentRunActivityRepository();
  }

  /** Run key (`<projectId>:<runId>`) to the instant it stops counting, with its project. */
  private readonly runs = new Map<string, { projectId: string; expiresAt: number }>();

  private constructor() {
    super();
  }

  markActive(input: { projectId: string; runId: string; expiresAt: number }): Promise<void> {
    this.runs.set(`${input.projectId}:${input.runId}`, {
      projectId: input.projectId,
      expiresAt: input.expiresAt,
    });
    return Promise.resolve();
  }

  /** Synchronous end to end, so claims made at once cannot interleave. */
  claim(input: {
    projectId: string;
    runId: string;
    now: number;
    expiresAt: number;
  }): Promise<{ project: number; global: number }> {
    const key = `${input.projectId}:${input.runId}`;
    this.runs.delete(key);
    const others = this.#count(input);
    this.runs.set(key, { projectId: input.projectId, expiresAt: input.expiresAt });
    return Promise.resolve(others);
  }

  markInactive(input: { projectId: string; runId: string }): Promise<void> {
    this.runs.delete(`${input.projectId}:${input.runId}`);
    return Promise.resolve();
  }

  #count(input: { projectId: string; now: number }): { project: number; global: number } {
    let project = 0;
    for (const [key, run] of this.runs) {
      if (run.expiresAt <= input.now) {
        this.runs.delete(key);
        continue;
      }
      if (run.projectId === input.projectId) project += 1;
    }
    return { project, global: this.runs.size };
  }
}
