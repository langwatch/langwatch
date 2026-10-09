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
import type { RunParameterValues } from "../parameters";
import type { RunSecretCiphertext } from "../run-secret-values";
import type { VoiceConcurrencyGate } from "./voice-concurrency-gate";

const logger = createLogger("langwatch:scenarios:execution-pool");

/** Minimal job data needed by the pool to spawn a child. */
export interface ExecutionJobData {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  scenarioName?: string;
  target: {
    type: "prompt" | "http" | "code" | "workflow" | "connected" | "voice";
    referenceId: string;
  };
  /**
   * The values the run resolved for this scenario, carried from the queued
   * event. Absent for a run that resolved none, and for any event queued
   * before parameters existed.
   */
  parameters?: RunParameterValues;
  /**
   * The run's secret parameter values, still encrypted. The prefetch decrypts
   * them once and merges them over the project's own secrets.
   */
  secretParameters?: RunSecretCiphertext;
}

/** Function that spawns a child process for a scenario job. Returns when child exits. */
export type SpawnFunction = (jobData: ExecutionJobData) => Promise<void>;

/** Called when the pool skips a cancelled job. Responsible for writing the terminal event. */
export type OnSkipCancelledFn = (jobData: ExecutionJobData) => void;

export class ScenarioExecutionPool {
  private readonly _running = new Map<string, ChildProcess>();
  /**
   * In-flight job data keyed by scenarioRunId, tracked from the moment a job
   * starts (before the child is registered) so the spawn window — where the
   * child exists but isn't yet in `_running` — is still covered. Used by
   * `inFlightJobs` so a draining worker can emit a terminal failure for every
   * run it owns and none orphan at QUEUED.
   */
  private readonly _runningJobs = new Map<string, ExecutionJobData>();
  private readonly _pending: ExecutionJobData[] = [];
  private readonly _cancelled = new Set<string>();
  private readonly _concurrency: number;
  /**
   * Per-project cap for voice runs. When set, a voice job is admitted only
   * while its project is under the cap; otherwise it waits in `_pending` like
   * any full-pool job. Absent = no voice-specific cap (voice runs compete for
   * the global slots like every other run), which keeps the existing pool tests
   * unchanged.
   */
  private readonly _voiceGate: VoiceConcurrencyGate | null;
  private _spawnFn: SpawnFunction | null = null;
  private _onSkipCancelled: OnSkipCancelledFn | null = null;

  constructor({
    concurrency,
    voiceGate,
  }: {
    concurrency: number;
    voiceGate?: VoiceConcurrencyGate;
  }) {
    this._concurrency = concurrency;
    this._voiceGate = voiceGate ?? null;
  }

  /** Set the spawn function. Called once during wiring (after deps are available). */
  setSpawnFunction(fn: SpawnFunction): void {
    this._spawnFn = fn;
  }

  /** Set the callback for when a cancelled job is skipped. Writes finished(CANCELLED). */
  setOnSkipCancelled(fn: OnSkipCancelledFn): void {
    this._onSkipCancelled = fn;
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
   * Job data for every run still in flight: those running (tracked from
   * startJob, covering the pre-registration spawn window) plus those buffered
   * pending. Drained on worker shutdown so each run reaches a terminal state
   * instead of orphaning at QUEUED.
   */
  get inFlightJobs(): ExecutionJobData[] {
    return [...this._runningJobs.values(), ...this._pending];
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
    // Release the voice slot BEFORE dequeue, so a queued voice run for the same
    // project can take the freed slot in the very next dequeue pass.
    const finished = this._runningJobs.get(scenarioRunId);
    if (finished && this._voiceGate && finished.target.type === "voice") {
      this._voiceGate.release(finished.projectId);
    }
    this._runningJobs.delete(scenarioRunId);
    this.dequeueNext();
  }

  /**
   * Whether a job may start now: a global slot is free AND, for a voice job, the
   * project is under its voice cap. The voice cap holds extra voice runs in the
   * queue without blocking a text run behind them.
   *
   * Admission counts against `_runningJobs`, not `_running`: a job is admitted
   * (and its slot spoken for) the moment `startJob` records it, before its
   * child ever registers — an async prefetch can take a while, and counting
   * `_running` instead would let a second `submit`/dequeue see a free slot
   * during that window and admit past `_concurrency` (#27).
   */
  private canStart(jobData: ExecutionJobData): boolean {
    if (this._runningJobs.size >= this._concurrency) return false;
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
    // Skip if already cancelled before we even start
    if (this._cancelled.has(jobData.scenarioRunId)) {
      logger.info(
        { scenarioRunId: jobData.scenarioRunId },
        "Skipping cancelled job, dispatching finished(CANCELLED)",
      );
      this._onSkipCancelled?.(jobData);
      return;
    }
    if (this.canStart(jobData)) {
      this.startJob(jobData);
    } else {
      logger.info(
        {
          scenarioRunId: jobData.scenarioRunId,
          pendingCount: this._pending.length + 1,
          activeCount: this._running.size,
          targetType: jobData.target.type,
        },
        "Execution pool full or voice cap reached, buffering job",
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
    // Track in-flight job data immediately — before the child is registered —
    // so a draining worker can emit a terminal failure even if shutdown lands
    // in the spawn window (child exists but not yet in `_running`).
    this._runningJobs.set(jobData.scenarioRunId, jobData);

    // Reserve the project's voice slot at the same moment, so the cap is exact
    // across the spawn window. Released in deregisterChild / the failure path.
    if (this._voiceGate && jobData.target.type === "voice") {
      this._voiceGate.acquire(jobData.projectId);
    }

    if (!this._spawnFn) {
      logger.error(
        { scenarioRunId: jobData.scenarioRunId },
        "Spawn function not set on execution pool",
      );
      this.releaseVoiceSlot(jobData);
      this._runningJobs.delete(jobData.scenarioRunId);
      return;
    }

    logger.info(
      {
        scenarioRunId: jobData.scenarioRunId,
        activeCount: this._running.size + 1,
        pendingCount: this._pending.length,
      },
      "Starting scenario execution",
    );

    // Fire and forget — the spawn function handles the full lifecycle
    void this._spawnFn(jobData).then(
      () => this.settleUnregisteredJob(jobData.scenarioRunId),
      (error) => {
        logger.error(
          {
            scenarioRunId: jobData.scenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Scenario execution failed unexpectedly",
        );
        this.settleUnregisteredJob(jobData.scenarioRunId);
      },
    );
  }

  /**
   * Release a job's slot when the spawn function settled (resolved or
   * rejected) without ever calling `deregisterChild` — an early return before
   * the child registers (e.g. a prefetch failure, or cancellation during
   * prefetch) otherwise leaks a voice slot forever, since only
   * `deregisterChild` releases it. Idempotent: `_runningJobs` no longer holds
   * the entry once `deregisterChild` already ran, so a normal exit is a no-op
   * here.
   */
  private settleUnregisteredJob(scenarioRunId: string): void {
    const jobData = this._runningJobs.get(scenarioRunId);
    if (!jobData) return;
    this._running.delete(scenarioRunId);
    this.releaseVoiceSlot(jobData);
    this._runningJobs.delete(scenarioRunId);
    this.dequeueNext();
  }

  /** Release a voice job's reserved slot; a no-op for text jobs or no gate. */
  private releaseVoiceSlot(jobData: ExecutionJobData): void {
    if (this._voiceGate && jobData.target.type === "voice") {
      this._voiceGate.release(jobData.projectId);
    }
  }

  /**
   * Remove and settle the first cancelled job in the pending queue, wherever it
   * sits. Returns true when one was found (so the caller re-checks capacity),
   * false when no cancelled job remains.
   */
  private skipNextCancelledPending(): boolean {
    const cancelledIdx = this._pending.findIndex((job) =>
      this._cancelled.has(job.scenarioRunId),
    );
    if (cancelledIdx === -1) return false;
    const cancelled = this._pending.splice(cancelledIdx, 1)[0];
    if (cancelled) {
      logger.info(
        { scenarioRunId: cancelled.scenarioRunId },
        "Skipping cancelled pending job, dispatching finished(CANCELLED)",
      );
      this._onSkipCancelled?.(cancelled);
    }
    return true;
  }

  private dequeueNext(): void {
    while (
      this._pending.length > 0 &&
      this._runningJobs.size < this._concurrency
    ) {
      if (this.skipNextCancelledPending()) continue;

      // Start the first job that may start now. A voice job blocked by its
      // project's cap is left in place so a runnable job behind it is not
      // starved; the blocked job starts on a later dequeue once a slot frees.
      const startIdx = this._pending.findIndex((job) => this.canStart(job));
      if (startIdx === -1) return; // Nothing admissible right now.

      const next = this._pending.splice(startIdx, 1)[0];
      if (!next) return;
      logger.debug(
        {
          scenarioRunId: next.scenarioRunId,
          remainingPending: this._pending.length,
        },
        "Dequeuing pending job",
      );
      this.startJob(next);
      // One real start per dequeue: `_running.size` only rises once the child
      // registers (after an async prefetch), so starting more here would
      // over-admit the global cap. The next completion drives the next dequeue.
      return;
    }
  }
}
