/**
 * In-process execution pool for scenario child processes. Weighted-slot admission: each run costs
 * its runtime class's weight, spawns at once if it fits, buffers if not, dequeues on completion.
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import type { ChildProcess } from "child_process";

import { createLogger } from "@langwatch/observability";
import {
  SCENARIO_RESOURCE_CLASSES,
  type ScenarioExecutionJob,
  type ScenarioResourceClass,
  TARGET_RESOURCE_CLASS,
  TARGET_STOP_SIGNAL,
} from "@langwatch/scenario-contract";

import type { ScenarioExecutionRunner, ScenarioExecutionPool } from "../app/scenario.app.ts";

const logger = createLogger("langwatch:scenarios:execution-pool");

export type ExecutionJobData = ScenarioExecutionJob;

export class JobNotAcceptedByPoolError extends Error {
  constructor(readonly job: ExecutionJobData) {
    super(`Scenario execution pool does not accept target type ${job.target.type}`);
    this.name = "JobNotAcceptedByPoolError";
  }
}

/** Per-project slot budget for a resource class; a class absent here has no per-project cap. */
type ProjectSlotBudgets = Partial<Record<ScenarioResourceClass, number>>;

function resourceClassOf(job: ExecutionJobData): ScenarioResourceClass {
  return TARGET_RESOURCE_CLASS[job.target.type];
}

function weightOf(job: ExecutionJobData): number {
  return SCENARIO_RESOURCE_CLASSES[resourceClassOf(job)].weight;
}

/** A run fits when the budget has room, or nothing is running, so a heavy run is never starved. */
function fits({ used, weight, budget }: { used: number; weight: number; budget: number }): boolean {
  return used === 0 || used + weight <= budget;
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
  /** The slot budget; a light run weighs 1, so with only light runs it is a plain run count. */
  private readonly _concurrency: number;
  private readonly _projectSlots: ProjectSlotBudgets;
  private readonly acceptJob: ((job: ExecutionJobData) => boolean) | undefined;
  private runner: ScenarioExecutionRunner | undefined = void 0;

  static create(options: {
    concurrency: number;
    projectSlots?: ProjectSlotBudgets;
    acceptJob?: (job: ExecutionJobData) => boolean;
  }): ScenarioExecutionPoolService {
    return new ScenarioExecutionPoolService(options);
  }

  private constructor({
    concurrency,
    projectSlots,
    acceptJob,
  }: {
    concurrency: number;
    projectSlots?: ProjectSlotBudgets;
    acceptJob?: (job: ExecutionJobData) => boolean;
  }) {
    this._concurrency = concurrency;
    this._projectSlots = projectSlots ?? {};
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
    this._active.delete(scenarioRunId);
    this.dequeueNext();
  }

  /** Slots held by the active runs matching `include`, from `_active` alone: nothing to release. */
  private slotsHeld(include: (job: ExecutionJobData) => boolean): number {
    return [...this._active.values()].reduce(
      (held, { job }) => (include(job) ? held + weightOf(job) : held),
      0,
    );
  }

  /**
   * Whether a job may start now: its weight fits the global budget and its class's per-project
   * budget. Admission counts `_active`, which a job enters at `startJob` — before its child
   * registers — so a submit in that window cannot admit past the budget.
   */
  private canStart(jobData: ExecutionJobData): boolean {
    const weight = weightOf(jobData);
    const used = this.slotsHeld(() => true);
    if (!fits({ used, weight, budget: this._concurrency })) {
      return false;
    }

    const resourceClass = resourceClassOf(jobData);
    const projectBudget = this._projectSlots[resourceClass];
    if (projectBudget === undefined) {
      return true;
    }
    const projectUsed = this.slotsHeld(
      (job) => job.projectId === jobData.projectId && resourceClassOf(job) === resourceClass,
    );

    return fits({ used: projectUsed, weight, budget: projectBudget });
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
        "Execution pool slots or project class budget exhausted, buffering job",
      );
      this._pending.push(jobData);
    }
  }

  /** Stop a run's child with its runtime's declared signal; false when it has no child yet. */
  stop(scenarioRunId: string): boolean {
    const execution = this._active.get(scenarioRunId);
    if (!execution?.child) {
      return false;
    }

    execution.child.kill(TARGET_STOP_SIGNAL[execution.job.target.type]);

    return true;
  }

  /** Stop all running children by their runtimes' declared signals and clear the pending queue. */
  drain(): void {
    for (const id of this._active.keys()) {
      logger.info({ scenarioRunId: id }, "Draining: stopping child process");
      this.stop(id);
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
   * Release a job's slots when the executor settled without ever calling `deregisterChild` — an
   * early return before the child registers (prefetch failure, cancellation) would otherwise leak
   * them forever. Idempotent: a normal exit already dropped the `_active` entry.
   */
  private settleUnregisteredJob(scenarioRunId: string): void {
    const execution = this._active.get(scenarioRunId);
    if (!execution) {
      return;
    }

    this._active.delete(scenarioRunId);
    this.dequeueNext();
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
    while (this._pending.length > 0) {
      if (this.skipNextCancelledPending()) {
        continue;
      }

      // Start the first job that fits now. A job blocked by its budget stays in place so a job
      // behind it that fits is not starved; it starts on a later dequeue once slots free.
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
      // `startJob` records the run in `_active` synchronously, so the next pass sees its weight
      // and a freed heavy run admits every waiting run that now fits.
      this.startJob(next);
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
