/**
 * In-process worker pool for Langy turns (ADR-044 part 1).
 *
 * A direct analog of `ScenarioExecutionPool`, with one difference: it does NOT
 * spawn a child process. Its spawn function calls the Go langyagent manager
 * (`POST {OPENCODE_AGENT_URL}/chat`) and bridges the response. The HARD capacity
 * gate stays the manager's `ErrMaxWorkers` → "at-capacity"; this pool's
 * concurrency only bounds how many manager calls one control-plane worker makes
 * concurrently, and provides in-flight tracking + drain + reconcile hooks.
 *
 * @see src/server/scenarios/execution/execution-pool.ts (the pattern copied)
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import type { LangyTurnHandoff } from "../streaming/langyTurnHandoff";

const logger = createLogger("langwatch:langy:worker-pool");

/**
 * Everything the spawn function needs for one turn. Carries the non-durable
 * handoff inputs (credentials, prompt, system) alongside the identifiers — the
 * durable event only had `{ conversationId, turnId }`.
 */
export type LangyTurnJobData = LangyTurnHandoff;

/** Function that runs one turn end-to-end. Resolves when the turn finishes. */
export type LangySpawnFunction = (job: LangyTurnJobData) => Promise<void>;

/**
 * Called when the pool drains an in-flight turn on shutdown. Responsible for
 * writing the turn's terminal `agent_turn_failed` so it never orphans in-flight.
 */
export type OnDrainTurnFn = (job: LangyTurnJobData) => Promise<void>;

export class LangyWorkerPool {
  /**
   * In-flight job data keyed by turnId, tracked from the moment a turn starts
   * (before any manager call) so the whole window is covered for `drain`.
   */
  private readonly _running = new Map<string, LangyTurnJobData>();
  private readonly _pending: LangyTurnJobData[] = [];
  private readonly _concurrency: number;
  private _spawnFn: LangySpawnFunction | null = null;

  constructor({ concurrency }: { concurrency: number }) {
    this._concurrency = concurrency;
  }

  /** Set the spawn function. Called once during wiring (after deps exist). */
  setSpawnFunction(fn: LangySpawnFunction): void {
    this._spawnFn = fn;
  }

  /** Number of turns currently in flight. */
  get activeCount(): number {
    return this._running.size;
  }

  /** Number of turns waiting for a slot. */
  get pendingCount(): number {
    return this._pending.length;
  }

  /**
   * Job data for every turn still in flight (running + buffered pending).
   * Drained on worker shutdown so each turn reaches a terminal state instead of
   * hanging in-flight forever (mirror of `inFlightJobs`).
   */
  get inFlightJobs(): LangyTurnJobData[] {
    return [...this._running.values(), ...this._pending];
  }

  /**
   * Submit a turn. Starts immediately if capacity is available, buffers if the
   * local concurrency bound is reached. The manager's own capacity gate still
   * applies inside the spawn function.
   */
  submit(job: LangyTurnJobData): void {
    if (this._running.size < this._concurrency) {
      this.startJob(job);
    } else {
      logger.info(
        {
          turnId: job.turnId,
          conversationId: job.conversationId,
          pendingCount: this._pending.length + 1,
          activeCount: this._running.size,
        },
        "Langy worker pool full, buffering turn",
      );
      this._pending.push(job);
    }
  }

  private startJob(job: LangyTurnJobData): void {
    this._running.set(job.turnId, job);

    if (!this._spawnFn) {
      logger.error({ turnId: job.turnId }, "Spawn function not set on langy pool");
      this._running.delete(job.turnId);
      return;
    }

    logger.info(
      {
        turnId: job.turnId,
        conversationId: job.conversationId,
        activeCount: this._running.size,
      },
      "Starting langy turn",
    );

    // Fire-and-forget: the spawn function owns the full turn lifecycle so the
    // GroupQueue keeps draining later events for the same aggregate.
    void this._spawnFn(job)
      .catch((error) => {
        logger.error(
          {
            turnId: job.turnId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Langy turn failed unexpectedly",
        );
      })
      .finally(() => {
        this._running.delete(job.turnId);
        this.dequeueNext();
      });
  }

  private dequeueNext(): void {
    while (this._pending.length > 0 && this._running.size < this._concurrency) {
      const next = this._pending.shift()!;
      this.startJob(next);
      return; // one at a time — next dequeue happens when this turn completes
    }
  }

  /**
   * Emit a terminal failure for every in-flight turn, then clear the pool.
   * Called on processor shutdown so a deploy mid-turn does not orphan turns
   * in-flight. Each emission is isolated so one failure can't block the rest.
   */
  async drain(onDrain: OnDrainTurnFn): Promise<void> {
    const inFlight = this.inFlightJobs;
    if (inFlight.length > 0) {
      logger.info(
        { count: inFlight.length },
        "Draining: emitting terminal failure for in-flight langy turns before shutdown",
      );
      await Promise.all(
        inFlight.map(async (job) => {
          try {
            await onDrain(job);
          } catch (err) {
            logger.warn(
              { err, turnId: job.turnId },
              "Failed to emit terminal failure for in-flight turn during drain",
            );
          }
        }),
      );
    }
    this._running.clear();
    this._pending.length = 0;
  }
}
