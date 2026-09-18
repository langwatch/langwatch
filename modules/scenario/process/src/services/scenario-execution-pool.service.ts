/**
 * In-process execution pool for scenario child processes. Manages concurrency: spawns immediately
 * if capacity available, buffers pending jobs when full, dequeues on completion.
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import type { ChildProcess } from "child_process";

import { createLogger } from "@langwatch/observability";
import type { ScenarioExecutionJob } from "@langwatch/scenario-contract";

import type { ScenarioExecutionRunner, ScenarioExecutionPool } from "../app/scenario.app.ts";
import type { VoiceConcurrencyGate } from "../voice-concurrency-gate.ts";

const logger = createLogger("langwatch:scenarios:execution-pool");

export type ExecutionJobData = ScenarioExecutionJob;

export class JobNotAcceptedByPoolError extends Error {
  constructor(readonly job: ExecutionJobData) {
    super(`Scenario execution pool does not accept target type ${job.target.type}`);
    this.name = "JobNotAcceptedByPoolError";
  }
}

type ActiveExecution = {
  job: ExecutionJobData;
  child?: ChildProcess;
};

export class ScenarioExecutionPoolService implements ScenarioExecutionPool {
  /**
   * In-flight job data keyed by scenarioRunId, tracked from the moment a job starts (before the
   * child is registered) so the spawn window — where the child exists but is not registered yet —
   * is still covered.
   */
  private readonly _active = new Map<string, ActiveExecution>();
  private readonly _pending: ExecutionJobData[] = [];
  private readonly _cancelled = new Set<string>();
  private readonly _concurrency: number;
  /**
   * Per-project cap for voice runs: a voice job is admitted only while its project is under it,
   * otherwise it waits in `_pending` like any full-pool job. Absent = no voice cap, so a pool built
   * without one behaves exactly as it did before the cap existed.
   */
  private readonly _voiceGate: VoiceConcurrencyGate | null;
  private readonly acceptJob: ((job: ExecutionJobData) => boolean) | undefined;
  private runner: ScenarioExecutionRunner | undefined = void 0;

  static create(options: {
    concurrency: number;
    voiceGate?: VoiceConcurrencyGate;
    acceptJob?: (job: ExecutionJobData) => boolean;
  }): ScenarioExecutionPoolService {
    return new ScenarioExecutionPoolService(options);
  }

  private constructor({
    concurrency,
    voiceGate,
    acceptJob,
  }: {
    concurrency: number;
    voiceGate?: VoiceConcurrencyGate;
    acceptJob?: (job: ExecutionJobData) => boolean;
  }) {
    this._concurrency = concurrency;
    this._voiceGate = voiceGate ?? null;
    this.acceptJob = acceptJob;
  }

  connect(runner: ScenarioExecutionRunner): void {
    this.runner = runner;
  }

  /**
   * The runner, or a throw naming the job that could not be served. `connect` is late —
   * `ScenarioProcessorService.create` calls it during worker boot, so a job submitted before that
   * lands on an unconnected pool.
   */
  private requireRunner(scenarioRunId: string): ScenarioExecutionRunner {
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
   * Job data for every run still in flight: those running (tracked from startJob, covering the pre-
   * registration spawn window) plus those buffered pending. Drained on worker shutdown so each run
   * reaches a terminal state instead of orphaning at QUEUED.
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
    // Release the voice slot BEFORE the dequeue, so a queued voice run for the same project can
    // take the freed slot in the very next dequeue pass.
    const finished = this._active.get(scenarioRunId);
    if (finished) {
      this.releaseVoiceSlot(finished.job);
    }
    this._active.delete(scenarioRunId);
    this.dequeueNext();
  }

  /**
   * Whether a job may start now: a global slot is free and, for a voice job, the project is under
   * its cap. Admission counts against `_active`, which a job enters at `startJob` — before its
   * child registers — so a submit in that window cannot admit past `_concurrency`.
   */
  private canStart(jobData: ExecutionJobData): boolean {
    if (this._active.size >= this._concurrency) {
      return false;
    }

    if (this._voiceGate && jobData.target.type === "voice") {
      return this._voiceGate.canAcquire(jobData.projectId);
    }

    return true;
  }

  /**
   * Submit a job for execution.
   * Starts immediately if capacity available, buffers if full.
   */
  submit(jobData: ExecutionJobData): void {
    if (this.acceptJob && !this.acceptJob(jobData)) {
      throw new JobNotAcceptedByPoolError(jobData);
    }
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

    if (this.canStart(jobData)) {
      this.startJob(jobData);
    } else {
      logger.info(
        {
          scenarioRunId: jobData.scenarioRunId,
          pendingCount: this._pending.length + 1,
          activeCount: this._active.size,
          targetType: jobData.target.type,
        },
        "Execution pool full or voice cap reached, buffering job",
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

    // Reserve the project's voice slot at the same moment, so the cap is exact across the spawn
    // window. Released in deregisterChild, or in settleUnregisteredJob when the executor never got
    // as far as a child.
    if (this._voiceGate && jobData.target.type === "voice") {
      this._voiceGate.acquire(jobData.projectId);
    }

    logger.info(
      {
        scenarioRunId: jobData.scenarioRunId,
        activeCount: this._active.size,
        pendingCount: this._pending.length,
      },
      "Starting scenario execution",
    );

    // Fire and forget — the spawn function handles the full lifecycle
    void runner.execute(jobData).then(
      () => this.settleUnregisteredJob(jobData.scenarioRunId),
      (error: unknown) => {
        logger.error(
          {
            scenarioRunId: jobData.scenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Scenario execution failed unexpectedly",
        );
        // Ensure we deregister even on unexpected errors
        this.settleUnregisteredJob(jobData.scenarioRunId);
      },
    );
  }

  /**
   * Release a job's slot when the executor settled without ever calling `deregisterChild` — an
   * early return before the child registers (prefetch failure, cancellation) would otherwise leak a
   * voice slot forever. Idempotent: a normal exit already dropped the `_active` entry.
   */
  private settleUnregisteredJob(scenarioRunId: string): void {
    const execution = this._active.get(scenarioRunId);
    if (!execution) {
      return;
    }

    this.releaseVoiceSlot(execution.job);
    this._active.delete(scenarioRunId);
    this.dequeueNext();
  }

  /** Release a voice job's reserved slot; a no-op for text jobs or no gate. */
  private releaseVoiceSlot(jobData: ExecutionJobData): void {
    if (this._voiceGate && jobData.target.type === "voice") {
      this._voiceGate.release(jobData.projectId);
    }
  }

  /**
   * Remove and settle the first cancelled job in the pending queue, wherever it sits. Returns true
   * when one was found (so the caller re-checks capacity), false when no cancelled job remains.
   */
  private skipNextCancelledPending(): boolean {
    const cancelledIdx = this._pending.findIndex((job) => this._cancelled.has(job.scenarioRunId));
    if (cancelledIdx === -1) {
      return false;
    }

    const cancelled = this._pending.splice(cancelledIdx, 1)[0];
    if (cancelled) {
      logger.info(
        { scenarioRunId: cancelled.scenarioRunId },
        "Skipping cancelled pending job, dispatching finished(CANCELLED)",
      );
      this.requireRunner(cancelled.scenarioRunId).skipCancelled(cancelled);
    }

    return true;
  }

  private dequeueNext(): void {
    while (this._pending.length > 0 && this._active.size < this._concurrency) {
      if (this.skipNextCancelledPending()) {
        continue;
      }

      // Start the first job that may start now. A voice job blocked by its project's cap is left in
      // place so a runnable job behind it is not starved; the blocked job starts on a later dequeue
      // once a slot frees.
      const startIdx = this._pending.findIndex((job) => this.canStart(job));
      if (startIdx === -1) {
        return; // Nothing admissible right now.
      }

      const next = this._pending.splice(startIdx, 1)[0];
      if (!next) {
        return;
      }

      logger.debug(
        {
          scenarioRunId: next.scenarioRunId,
          remainingPending: this._pending.length,
        },
        "Dequeuing pending job",
      );
      this.startJob(next);

      // One real start per dequeue: `_active` only rises once the job is recorded here, so starting
      // more would over-admit the global cap. The next completion drives the next dequeue.
      return;
    }
  }
}

/** Explicit non-worker capability; throwing lets the durable intent retry. */
export class UnavailableScenarioExecutionPoolService implements ScenarioExecutionPool {
  static create(): UnavailableScenarioExecutionPoolService {
    return new UnavailableScenarioExecutionPoolService();
  }

  private constructor() {}

  submit(input: ScenarioExecutionJob): void {
    throw new Error(
      `No execution pool on this pod; outbox will retry execute for scenarioRunId=${input.scenarioRunId}`,
    );
  }
}
