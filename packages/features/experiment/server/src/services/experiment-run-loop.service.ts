/**
 * The run's two execution phases: the target cells, then the comparison cells that need their
 * outputs. It owns the counters a run reports on — completed, failed, cost, whether a user stopped
 * it — and the concurrency limit both phases share, so progress stays honest across the two.
 */

import { createLogger } from "@langwatch/observability";
import type { EvaluationV3Event, ExecutionCell } from "@langwatch/experiment-contract";
import { createSemaphore } from "../processes/experiment-run-semaphore.process";

const logger = createLogger("langwatch:experiment:run-loop");

/** One phase-2 plan: the comparison cells to run and the rows that could not produce one. */
export interface PhaseTwoPlan {
  cells: ExecutionCell[];
  skipEvents: EvaluationV3Event[];
  backfillEvents: EvaluationV3Event[];
}

export interface RunLoopDependencies {
  runId: string;
  cells: ExecutionCell[];
  concurrency: number;
  isAborted: () => Promise<boolean>;
  /** The events one cell produces, chosen by the orchestrator from the cell's target. */
  cellEvents: (cell: ExecutionCell) => AsyncGenerator<EvaluationV3Event>;
  pushEvent: (event: EvaluationV3Event) => void;
  recordEvent: (event: EvaluationV3Event) => Promise<void>;
  /** Planned only once phase 1 has finished, since each comparison needs its variants' outputs. */
  planPhaseTwo: () => Promise<PhaseTwoPlan | null>;
}

export class ExperimentRunLoopService {
  private readonly semaphore: ReturnType<typeof createSemaphore>;
  private readonly activeCells = new Set<Promise<void>>();
  private abortedFlag = false;
  private completed = 0;
  private failed = 0;
  private succeeded = 0;
  private cost = 0;
  private total: number;

  private constructor(private readonly deps: RunLoopDependencies) {
    this.semaphore = createSemaphore(deps.concurrency);
    this.total = deps.cells.length;
  }

  static create(deps: RunLoopDependencies): ExperimentRunLoopService {
    return new ExperimentRunLoopService(deps);
  }

  get aborted(): boolean {
    return this.abortedFlag;
  }

  get totalCells(): number {
    return this.total;
  }

  get completedCells(): number {
    return this.succeeded;
  }

  get failedCells(): number {
    return this.failed;
  }

  get totalCost(): number {
    return this.cost;
  }

  /** Runs both phases to completion, or until the user stops the run. */
  async run(): Promise<void> {
    await this.runPhase(this.deps.cells);
    if (this.abortedFlag) {
      return;
    }

    const plan = await this.deps.planPhaseTwo();
    if (!plan) {
      return;
    }

    // Fold phase-2 cells into the run total now that we know how many there
    // are, so progress and the final summary stay consistent.
    this.total += plan.cells.length;
    for (const skipEvent of plan.skipEvents) {
      // Respect a user-triggered abort mid-loop; otherwise a long skip burst
      // would keep writing after the run was meant to stop.
      if (await this.checkAborted()) {
        return;
      }

      this.deps.pushEvent(skipEvent);
      await this.deps.recordEvent(skipEvent);
    }

    for (const backfillEvent of plan.backfillEvents) {
      await this.deps.recordEvent(backfillEvent);
    }

    if (plan.cells.length > 0) {
      logger.info(
        { runId: this.deps.runId, comparison: plan.cells.length },
        "Starting Phase 2 (comparison) cells",
      );
    }

    await this.runPhase(plan.cells);
  }

  /** One phase's cells, started up to the concurrency limit and awaited as a whole. */
  private async runPhase(cells: ExecutionCell[]): Promise<void> {
    for (const cell of cells) {
      if (await this.checkAborted()) {
        logger.info({ runId: this.deps.runId }, "Execution aborted by user");
        break;
      }

      await this.semaphore.acquire();
      const cellPromise = this.runCell(cell);
      this.activeCells.add(cellPromise);
      void cellPromise.finally(() => this.activeCells.delete(cellPromise));
    }

    await Promise.all(this.activeCells);
  }

  /** One cell: its events pushed and recorded, then the progress event it produced. */
  private async runCell(cell: ExecutionCell): Promise<void> {
    try {
      // Re-checked after the semaphore slot, since the wait itself can span an
      // abort.
      if (await this.deps.isAborted()) {
        return;
      }

      let cellFailed = false;
      for await (const event of this.deps.cellEvents(cell)) {
        if (await this.checkAborted()) {
          break;
        }

        this.deps.pushEvent(event);
        await this.deps.recordEvent(event);
        if (event.type === "error" || (event.type === "target_result" && event.error)) {
          cellFailed = true;
        }

        if (event.type === "target_result" && event.cost) {
          this.cost += event.cost;
        }
      }

      this.completed++;
      if (cellFailed) {
        this.failed++;
      } else {
        this.succeeded++;
      }

      const progressEvent: EvaluationV3Event = {
        type: "progress",
        completed: this.completed,
        total: this.total,
      };
      this.deps.pushEvent(progressEvent);
      await this.deps.recordEvent(progressEvent);
    } finally {
      this.semaphore.release();
    }
  }

  private async checkAborted(): Promise<boolean> {
    if (await this.deps.isAborted()) {
      this.abortedFlag = true;
    }

    return this.abortedFlag;
  }
}
