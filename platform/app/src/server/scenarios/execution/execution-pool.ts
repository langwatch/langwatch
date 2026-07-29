/**
 * Registry of the scenario child processes this worker is holding.
 *
 * It used to be a queue as well: jobs arrived fire-and-forget from a reactor,
 * ran up to a concurrency limit, and overflowed into a plain array field that a
 * hard kill lost. Dispatch is now a leased process-outbox message (ADR-073
 * step 2), so pending work is a Postgres row and concurrency is the
 * dispatcher's — what remains here is the one thing an in-process object is
 * actually the right home for: the map cancellation uses to find a live child
 * and signal it.
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

export class ScenarioExecutionPool {
  private readonly _running = new Map<string, ChildProcess>();
  private readonly _cancelled = new Set<string>();

  /** Number of currently running child processes. */
  get activeCount(): number {
    return this._running.size;
  }

  /** Access running children map (used by the cancel subscription). */
  get runningChildren(): Map<string, ChildProcess> {
    return this._running;
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
  registerChild(scenarioRunId: string, child: ChildProcess): void {
    this._running.set(scenarioRunId, child);
  }

  /** Deregister a child process (called when the child exits). */
  deregisterChild(scenarioRunId: string): void {
    this._running.delete(scenarioRunId);
  }

  /**
   * Kill every child this worker still holds.
   *
   * This is an OS-resource obligation on shutdown, not a durability mechanism.
   * It no longer emits terminal events for the runs it kills: their dispatch
   * messages are still leased, and their process instances still hold armed
   * deadlines, so the terminal state is written by whichever of those resolves
   * first rather than by a shutdown path racing the exit.
   */
  drain(): void {
    for (const [id, child] of this._running) {
      logger.info({ scenarioRunId: id }, "Draining: killing child process");
      child.kill("SIGTERM");
    }
  }
}
