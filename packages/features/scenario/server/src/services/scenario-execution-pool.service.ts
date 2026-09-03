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

import { createLogger } from "@langwatch/observability";
import type { ChildProcess } from "child_process";
import type { ScenarioExecutionJob } from "@langwatch/scenario-contract";
import type { ScenarioExecutionRunnerPort } from "../ports/scenario-execution-runner.port";
import { ScenarioExecutionPoolPort } from "../ports/scenario-execution-pool.port";

const logger = createLogger("langwatch:scenarios:execution-pool");

export type ExecutionJobData = ScenarioExecutionJob;

type ActiveExecution = {
  job: ExecutionJobData;
  child?: ChildProcess;
};

export class ScenarioExecutionPoolService extends ScenarioExecutionPoolPort {
  /**
   * In-flight job data keyed by scenarioRunId, tracked from the moment a job
   * starts (before the child is registered) so the spawn window — where the
   * child exists but is not registered yet — is still covered. Used by
   * `inFlightJobs` so a draining worker can emit a terminal failure for every
   * run it owns and none orphan at QUEUED.
   */
  private readonly _active = new Map<string, ActiveExecution>();
  private readonly _pending: ExecutionJobData[] = [];
  private readonly _cancelled = new Set<string>();
  private readonly _concurrency: number;
  private runner: ScenarioExecutionRunnerPort | undefined = void 0;

  static create(options: { concurrency: number }): ScenarioExecutionPoolService {
    return new ScenarioExecutionPoolService(options);
  }

  private constructor({ concurrency }: { concurrency: number }) {
    super();
    this._concurrency = concurrency;
  }

  connect(runner: ScenarioExecutionRunnerPort): void {
    this.runner = runner;
  }

  /**
   * The runner, or a throw naming the job that could not be served.
   *
   * `connect` is late — `ScenarioProcessorService.create` calls it during
   * worker boot, so a job submitted before that lands on an unconnected pool.
   * `startJob` has always thrown there on purpose: the execute intent's outbox
   * retries, which is what `startWorkers.ts` relies on. The two CANCELLED
   * branches used `this.runner?.skipCancelled(...)` and then returned, so the
   * same window silently dropped the terminal event and left the run at QUEUED
   * — the exact outcome `inFlightJobs` exists to prevent. One field, one
   * policy, and it is the loud one.
   */
  private requireRunner(scenarioRunId: string): ScenarioExecutionRunnerPort {
    if (!this.runner) {
      throw new Error(
        `Scenario execution pool is not connected for scenarioRunId=${scenarioRunId}`,
      );
    }
    return this.runner;
  }

  /** Number of active jobs, including the child-registration window. */
  get activeCount(): number {
    return this._active.size;
  }

  /** Number of jobs waiting for a slot. */
  get pendingCount(): number {
    return this._pending.length;
  }

  /** Access running children map (used by cancel subscription). */
  get runningChildren(): Map<string, ChildProcess> {
    return new Map(
      [...this._active].flatMap(([scenarioRunId, execution]) =>
        execution.child ? [[scenarioRunId, execution.child]] : [],
      ),
    );
  }

  /**
   * Job data for every run still in flight: those running (tracked from
   * startJob, covering the pre-registration spawn window) plus those buffered
   * pending. Drained on worker shutdown so each run reaches a terminal state
   * instead of orphaning at QUEUED.
   */
  get inFlightJobs(): ExecutionJobData[] {
    return [...[...this._active.values()].map((execution) => execution.job), ...this._pending];
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
    const execution = this._active.get(scenarioRunId);
    if (!execution) {
      throw new Error(`Cannot register a child for inactive scenarioRunId=${scenarioRunId}`);
    }

    execution.child = child;
  }

  /**
   * Deregister a child process (called when child exits).
   * Triggers dequeue of next pending job if any.
   */
  deregisterChild(scenarioRunId: string): void {
    this._active.delete(scenarioRunId);
    this.dequeueNext();
  }

  /**
   * Submit a job for execution.
   * Starts immediately if capacity available, buffers if full.
   */
  submit(jobData: ExecutionJobData): void {
    if (
      this._active.has(jobData.scenarioRunId) ||
      this._pending.some((pending) => pending.scenarioRunId === jobData.scenarioRunId)
    ) {
      logger.debug(
        { scenarioRunId: jobData.scenarioRunId },
        "Ignoring duplicate scenario execution submission",
      );
      return;
    }
    // Skip if already cancelled before we even start
    if (this._cancelled.has(jobData.scenarioRunId)) {
      logger.info(
        { scenarioRunId: jobData.scenarioRunId },
        "Skipping cancelled job, dispatching finished(CANCELLED)",
      );
      this.requireRunner(jobData.scenarioRunId).skipCancelled(jobData);
      return;
    }
    if (this._active.size < this._concurrency) {
      this.startJob(jobData);
    } else {
      logger.info(
        {
          scenarioRunId: jobData.scenarioRunId,
          pendingCount: this._pending.length + 1,
          activeCount: this._active.size,
        },
        "Execution pool full, buffering job",
      );
      this._pending.push(jobData);
    }
  }

  /** Kill all running children and clear pending queue. */
  drain(): void {
    for (const [id, execution] of this._active) {
      const child = execution.child;
      if (!child) {
        continue;
      }

      logger.info({ scenarioRunId: id }, "Draining: killing child process");
      child.kill("SIGTERM");
    }
    this._pending.length = 0;
  }

  private startJob(jobData: ExecutionJobData): void {
    // Track in-flight job data immediately — before the child is registered —
    // so a draining worker can emit a terminal failure even if shutdown lands
    // in the spawn window (child exists but is not registered yet).
    const runner = this.requireRunner(jobData.scenarioRunId);
    this._active.set(jobData.scenarioRunId, { job: jobData });

    logger.info(
      {
        scenarioRunId: jobData.scenarioRunId,
        activeCount: this._active.size,
        pendingCount: this._pending.length,
      },
      "Starting scenario execution",
    );

    // Fire and forget — the spawn function handles the full lifecycle
    void runner.execute(jobData).catch((error) => {
      logger.error(
        {
          scenarioRunId: jobData.scenarioRunId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Scenario execution failed unexpectedly",
      );
      // Ensure we deregister even on unexpected errors
      this._active.delete(jobData.scenarioRunId);
      this.dequeueNext();
    });
  }

  private dequeueNext(): void {
    while (this._pending.length > 0 && this._active.size < this._concurrency) {
      const next = this._pending.shift()!;

      // Skip cancelled jobs in the pending queue
      if (this._cancelled.has(next.scenarioRunId)) {
        logger.info(
          { scenarioRunId: next.scenarioRunId },
          "Skipping cancelled pending job, dispatching finished(CANCELLED)",
        );
        this.requireRunner(next.scenarioRunId).skipCancelled(next);
        continue;
      }

      logger.debug(
        {
          scenarioRunId: next.scenarioRunId,
          remainingPending: this._pending.length,
        },
        "Dequeuing pending job",
      );
      this.startJob(next);
      return; // One at a time — next dequeue happens when this job completes
    }
  }
}

/** Explicit non-worker capability; throwing lets the durable intent retry. */
export class UnavailableScenarioExecutionPoolService extends ScenarioExecutionPoolPort {
  static create(): UnavailableScenarioExecutionPoolService {
    return new UnavailableScenarioExecutionPoolService();
  }

  private constructor() {
    super();
  }

  submit(input: ScenarioExecutionJob): void {
    throw new Error(
      `No execution pool on this pod; outbox will retry execute for scenarioRunId=${input.scenarioRunId}`,
    );
  }
}
