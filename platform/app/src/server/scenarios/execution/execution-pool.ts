/**
 * Registry of the scenario child processes this worker is holding.
 *
 * It used to be a queue as well: jobs arrived fire-and-forget from a reactor,
 * ran up to a concurrency limit, and overflowed into a plain array field that a
 * hard kill lost. Dispatch is now a leased process-outbox message (ADR-073
 * step 2), so pending work is a Postgres row and concurrency is the
 * dispatcher's — what remains here is the one thing an in-process object is
 * actually the right home for: the map of live children, which cancellation
 * uses to find and signal one, and which shutdown uses to know which runs it is
 * about to abandon.
 *
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import { createLogger } from "@langwatch/observability";
import type { ChildProcess } from "child_process";

const logger = createLogger("langwatch:scenarios:execution-pool");

/** Minimal job data needed to spawn a child. */
export interface ExecutionJobData {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  target: {
    type: "prompt" | "http" | "code" | "workflow";
    referenceId: string;
  };
}

/** A live child, and the job it is running. */
export interface RunningChild {
  job: ExecutionJobData;
  child: ChildProcess;
}

export class ScenarioExecutionPool {
  private readonly _running = new Map<string, RunningChild>();
  private readonly _cancelled = new Set<string>();

  /** Number of currently running child processes. */
  get activeCount(): number {
    return this._running.size;
  }

  /**
   * The job behind every child this worker still holds.
   *
   * A snapshot, not a view: shutdown reads it before signalling the children,
   * and each child's exit removes itself from the registry while that is in
   * progress.
   */
  get inFlightJobs(): ExecutionJobData[] {
    return [...this._running.values()].map((entry) => entry.job);
  }

  /** The live child for a run, if this worker is the one holding it. */
  findChild(scenarioRunId: string): ChildProcess | undefined {
    return this._running.get(scenarioRunId)?.child;
  }

  /**
   * Mark a scenario as cancelled. Called when the cancel subscription receives
   * a message and kills the child. The close handler checks this to distinguish
   * cancellation from crashes, and the dispatcher checks it before spawning at
   * all.
   */
  markCancelled(scenarioRunId: string): void {
    this._cancelled.add(scenarioRunId);
  }

  /** Check if a scenario was cancelled via the cancel subscription. */
  wasCancelled(scenarioRunId: string): boolean {
    return this._cancelled.has(scenarioRunId);
  }

  /**
   * Register a child process as running.
   * Called by the spawn function after the child is created.
   */
  registerChild({ job, child }: RunningChild): void {
    this._running.set(job.scenarioRunId, { job, child });
  }

  /** Deregister a child process (called when the child exits). */
  deregisterChild(scenarioRunId: string): void {
    this._running.delete(scenarioRunId);
  }

  /**
   * Kill every child this worker still holds.
   *
   * This is an OS-resource obligation, and on its own it is not a durability
   * mechanism: it signals the children and returns, so whether a terminal event
   * follows is a race with the process exiting. The shutdown path therefore
   * pairs it with an awaited terminal write per run
   * (`settleInFlightRuns` in `scenario.processor.ts`), and the process
   * manager's armed deadline remains the backstop for everything neither of
   * those reaches — a hard kill, most of all.
   */
  drain(): void {
    for (const [id, entry] of this._running) {
      logger.info({ scenarioRunId: id }, "Draining: killing child process");
      entry.child.kill("SIGTERM");
    }
  }
}
