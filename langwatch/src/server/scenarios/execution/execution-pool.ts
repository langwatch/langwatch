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
  target: { type: "prompt" | "http" | "code" | "workflow"; referenceId: string };
}

/** Function that spawns a child process for a scenario job. Returns when child exits. */
export type SpawnFunction = (jobData: ExecutionJobData) => Promise<void>;

/** Called when the pool skips a cancelled job. Responsible for writing the terminal event. */
export type OnSkipCancelledFn = (jobData: ExecutionJobData) => void;

/**
 * Called once per running and pending job during drain (worker shutdown /
 * maxRuntime restart). Responsible for writing the terminal failure event so
 * the run does not orphan at QUEUED/STARTING. See #3195 / #3365.
 */
export type OnDrainFn = (
  jobData: ExecutionJobData,
  reason: "worker_drain",
) => void;

export class ScenarioExecutionPool {
  private readonly _running = new Map<string, ChildProcess>();
  /**
   * Mirror of _running keyed by scenarioRunId but holding job metadata
   * (projectId, scenarioId, …) so drain() can emit terminal failure events
   * without touching the child process handle.
   */
  private readonly _runningJobs = new Map<string, ExecutionJobData>();
  private readonly _pending: ExecutionJobData[] = [];
  private readonly _cancelled = new Set<string>();
  private readonly _concurrency: number;
  private _spawnFn: SpawnFunction | null = null;
  private _onSkipCancelled: OnSkipCancelledFn | null = null;
  private _onDrain: OnDrainFn | null = null;

  constructor({ concurrency }: { concurrency: number }) {
    this._concurrency = concurrency;
  }

  /** Set the spawn function. Called once during wiring (after deps are available). */
  setSpawnFunction(fn: SpawnFunction): void {
    this._spawnFn = fn;
  }

  /** Set the callback for when a cancelled job is skipped. Writes finished(CANCELLED). */
  setOnSkipCancelled(fn: OnSkipCancelledFn): void {
    this._onSkipCancelled = fn;
  }

  /**
   * Set the callback invoked during drain() for each running + pending job.
   * Responsible for emitting a terminal failure event so the run leaves
   * QUEUED/STARTING when the worker restarts (#3195, #3365).
   */
  setOnDrain(fn: OnDrainFn): void {
    this._onDrain = fn;
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
   * Mark a scenario as cancelled. Called when the cancel subscription receives
   * a message and kills the child. The close handler checks this to distinguish
   * cancellation from crashes.
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
  registerChild(scenarioRunId: string, child: ChildProcess): void {
    this._running.set(scenarioRunId, child);
  }

  /**
   * Deregister a child process (called when child exits).
   * Triggers dequeue of next pending job if any.
   */
  deregisterChild(scenarioRunId: string): void {
    this._running.delete(scenarioRunId);
    this._runningJobs.delete(scenarioRunId);
    this.dequeueNext();
  }

  /**
   * Submit a job for execution.
   * Starts immediately if capacity available, buffers if full.
   */
  submit(jobData: ExecutionJobData): void {
    // Skip if already cancelled before we even start
    if (this._cancelled.has(jobData.scenarioRunId)) {
      logger.info({ scenarioRunId: jobData.scenarioRunId }, "Skipping cancelled job, dispatching finished(CANCELLED)");
      this._onSkipCancelled?.(jobData);
      return;
    }
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

  /**
   * Kill all running children and clear the pending queue.
   *
   * For every in-flight job — both jobs whose child was already spawned and
   * jobs still buffered in `_pending` — the onDrain callback is invoked so a
   * terminal failed event is emitted. Without this, worker restarts
   * (maxRuntime, deploy, OOM) leave runs orphaned at QUEUED/STARTING with no
   * way to recover (#3195, #3365).
   *
   * Iteration uses `_runningJobs` (the metadata mirror) rather than `_running`
   * so jobs that started but never reached registerChild() are still surfaced
   * — `_running` is keyed off the actual child process and lags startJob().
   */
  drain(): void {
    for (const [id, jobData] of this._runningJobs) {
      const child = this._running.get(id);
      if (child) {
        logger.info({ scenarioRunId: id }, "Draining: killing child process");
        child.kill("SIGTERM");
      } else {
        logger.info(
          { scenarioRunId: id },
          "Draining: job in flight but child not yet spawned",
        );
      }
      this.invokeDrainCallback(jobData);
    }
    for (const jobData of this._pending) {
      this.invokeDrainCallback(jobData);
    }
    this._pending.length = 0;
    this._runningJobs.clear();
  }

  private invokeDrainCallback(jobData: ExecutionJobData): void {
    if (!this._onDrain) return;
    try {
      this._onDrain(jobData, "worker_drain");
    } catch (err) {
      logger.error(
        {
          scenarioRunId: jobData.scenarioRunId,
          err: err instanceof Error ? err.message : String(err),
        },
        "onDrain callback threw",
      );
    }
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

    // Record the job metadata so drain() can emit failure events even before
    // the child process has been registered via registerChild() (#3195).
    this._runningJobs.set(jobData.scenarioRunId, jobData);

    // Fire and forget — the spawn function handles the full lifecycle
    void this._spawnFn(jobData).catch((error) => {
      logger.error(
        { scenarioRunId: jobData.scenarioRunId, error: error instanceof Error ? error.message : String(error) },
        "Scenario execution failed unexpectedly",
      );
      // Ensure we deregister even on unexpected errors
      this._running.delete(jobData.scenarioRunId);
      this._runningJobs.delete(jobData.scenarioRunId);
      this.dequeueNext();
    });
  }

  private dequeueNext(): void {
    while (this._pending.length > 0 && this._running.size < this._concurrency) {
      const next = this._pending.shift()!;

      // Skip cancelled jobs in the pending queue
      if (this._cancelled.has(next.scenarioRunId)) {
        logger.info({ scenarioRunId: next.scenarioRunId }, "Skipping cancelled pending job, dispatching finished(CANCELLED)");
        this._onSkipCancelled?.(next);
        continue;
      }

      logger.debug(
        { scenarioRunId: next.scenarioRunId, remainingPending: this._pending.length },
        "Dequeuing pending job",
      );
      this.startJob(next);
      return; // One at a time — next dequeue happens when this job completes
    }
  }
}
