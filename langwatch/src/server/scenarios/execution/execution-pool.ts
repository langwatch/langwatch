/**
 * In-process execution pool for scenario child processes.
 *
 * Manages concurrency: spawns immediately if capacity available, buffers
 * pending jobs when full, dequeues on completion. Each worker pod has its
 * own pool instance (concurrency=3 by default → 6 pods × 3 = 18 total).
 *
 * The pool tracks running children by scenarioRunId so the cancel
 * subscription can find and SIGTERM the right child.
 *
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import type { ChildProcess } from "child_process";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:scenarios:execution-pool");

/** Minimal job data needed by the pool to spawn a child. */
export interface ExecutionJobData {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  scenarioName?: string;
  target: { type: string; referenceId: string };
}

/** Function that spawns a child process for a scenario job. Returns when child exits. */
export type SpawnFunction = (jobData: ExecutionJobData) => Promise<void>;

export class ScenarioExecutionPool {
  private readonly _running = new Map<string, ChildProcess>();
  private readonly _pending: ExecutionJobData[] = [];
  private readonly _concurrency: number;
  private _spawnFn: SpawnFunction | null = null;

  constructor({ concurrency }: { concurrency: number }) {
    this._concurrency = concurrency;
  }

  /** Set the spawn function. Called once during wiring (after deps are available). */
  setSpawnFunction(fn: SpawnFunction): void {
    this._spawnFn = fn;
  }

  /** Number of currently running child processes. */
  get activeCount(): number {
    return this._running.size;
  }

  /** Number of jobs waiting for a slot. */
  get pendingCount(): number {
    return this._pending.length;
  }

  /** Access running children map (used by cancel subscription). */
  get runningChildren(): Map<string, ChildProcess> {
    return this._running;
  }

  /**
   * Register a child process as running.
   * Called by the spawn function after the child is created.
   */
  registerChild(scenarioRunId: string, child: ChildProcess): void {
    this._running.set(scenarioRunId, child);
  }

  /**
   * Deregister a child process (called when child exits).
   * Triggers dequeue of next pending job if any.
   */
  deregisterChild(scenarioRunId: string): void {
    this._running.delete(scenarioRunId);
    this.dequeueNext();
  }

  /**
   * Submit a job for execution.
   * Starts immediately if capacity available, buffers if full.
   */
  submit(jobData: ExecutionJobData): void {
    if (this._running.size < this._concurrency) {
      this.startJob(jobData);
    } else {
      logger.info(
        { scenarioRunId: jobData.scenarioRunId, pendingCount: this._pending.length + 1, activeCount: this._running.size },
        "Execution pool full, buffering job",
      );
      this._pending.push(jobData);
    }
  }

  /** Kill all running children and clear pending queue. */
  drain(): void {
    for (const [id, child] of this._running) {
      logger.info({ scenarioRunId: id }, "Draining: killing child process");
      child.kill("SIGTERM");
    }
    this._pending.length = 0;
  }

  private startJob(jobData: ExecutionJobData): void {
    if (!this._spawnFn) {
      logger.error({ scenarioRunId: jobData.scenarioRunId }, "Spawn function not set on execution pool");
      return;
    }

    logger.info(
      { scenarioRunId: jobData.scenarioRunId, activeCount: this._running.size + 1, pendingCount: this._pending.length },
      "Starting scenario execution",
    );

    // Fire and forget — the spawn function handles the full lifecycle
    void this._spawnFn(jobData).catch((error) => {
      logger.error(
        { scenarioRunId: jobData.scenarioRunId, error: error instanceof Error ? error.message : String(error) },
        "Scenario execution failed unexpectedly",
      );
      // Ensure we deregister even on unexpected errors
      this._running.delete(jobData.scenarioRunId);
      this.dequeueNext();
    });
  }

  private dequeueNext(): void {
    if (this._pending.length === 0) return;
    if (this._running.size >= this._concurrency) return;

    const next = this._pending.shift()!;
    logger.debug(
      { scenarioRunId: next.scenarioRunId, remainingPending: this._pending.length },
      "Dequeuing pending job",
    );
    this.startJob(next);
  }
}
