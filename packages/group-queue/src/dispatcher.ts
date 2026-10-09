import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type fastq from "fastq";

import { gqJobsDispatchedTotal } from "./metrics.ts";
import type { DispatchResult, GroupStagingScripts } from "./scripts.ts";

/** Max jobs to dispatch per Lua call to bound script execution time. */
const MAX_BATCH_SIZE = 200;

/** The dedicated connection the dispatcher blocks on; an IORedis or a Cluster. */
interface BlockingConnection {
  brpop(key: string, timeout: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

/**
 * Dispatcher loop: waits for signals on the Redis signal list and dispatches
 * jobs from the staging layer into the fastq processing queue.
 */
export class GroupQueueDispatcher {
  private shutdownRequested = false;
  private running = false;
  private paused = false;
  /** Ends the loop's wait for a resume; set only while the loop is paused. */
  private wake: (() => void) | null = null;

  constructor(
    private readonly params: {
      scripts: Pick<
        GroupStagingScripts,
        "getSignalKey" | "getEarliestReadyScore" | "dispatchBatch"
      >;
      processingQueue: fastq.queueAsPromised<DispatchResult, void>;
      blockingConnection: BlockingConnection;
      queueName: string;
      globalConcurrency: number;
      activeTtlSec: number;
      signalTimeoutSec: number;
      logger: Logger;
      dispatchGroupAllowListKey?: string;
    },
  ) {}

  private async handleLoopError(error: unknown): Promise<void> {
    if (this.shutdownRequested) return;

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("Connection is closed")) {
      this.params.logger.debug(
        { queueName: this.params.queueName },
        "Redis connection closed, stopping dispatcher",
      );
      this.shutdownRequested = true;
      return;
    }

    this.params.logger.error(
      {
        queueName: this.params.queueName,
        error: errorMessage,
      },
      "Dispatcher loop error",
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  start(): void {
    this.running = true;
    void this.run();
  }

  private async run(): Promise<void> {
    // A resume dispatches at once: signals that arrived while paused were drained unclaimed.
    let dispatchNow = false;
    while (!this.shutdownRequested) {
      try {
        if (this.paused) {
          await this.untilWoken();
          dispatchNow = true;
          continue;
        }
        if (!dispatchNow) await this.waitForSignal();
        dispatchNow = false;
        await this.dispatchUntilEmpty();
      } catch (error) {
        await this.handleLoopError(error);
      }
    }

    this.running = false;
    this.params.logger.debug({ queueName: this.params.queueName }, "Dispatcher loop stopped");
  }

  private async dispatchUntilEmpty(): Promise<void> {
    let dispatched: number;
    do {
      dispatched = await this.dispatchBatch();
      if (dispatched > 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } while (dispatched > 0 && !this.shutdownRequested);

    // Drain signals that arrived during dispatch to prevent
    // immediate re-wake from stale notifications
    const signalKey = this.params.scripts.getSignalKey();
    await this.params.blockingConnection.del(signalKey);
  }

  requestShutdown(): void {
    this.shutdownRequested = true;
    this.wake?.();
  }

  /** Claims no further batch; a claim already issued still hands its jobs over. Idempotent. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.params.logger.info({ queueName: this.params.queueName }, "Dispatcher paused");
  }

  /** Claims again from where the pause stopped. Idempotent. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.params.logger.info({ queueName: this.params.queueName }, "Dispatcher resumed");
    this.wake?.();
  }

  private untilWoken(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = null;
        resolve();
      };
    });
  }

  async waitUntilStopped(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async waitForSignal(): Promise<void> {
    const signalKey = this.params.scripts.getSignalKey();
    await this.params.blockingConnection.brpop(signalKey, await this.nextWakeTimeoutSec());
    // Drain remaining buffered signals — the upcoming dispatchBatch
    // handles multiple jobs in one Lua call, so N signals = 1 cycle.
    await this.params.blockingConnection.del(signalKey);
  }

  /**
   * Clamps BRPOP timeout to the earliest due group, handling delayed jobs
   * and signal-loss edge cases; falls back to fixed interval when saturated.
   */
  private async nextWakeTimeoutSec(): Promise<number> {
    const saturated =
      this.params.processingQueue.length() + this.params.processingQueue.running() >=
      this.params.globalConcurrency;
    if (saturated) return this.params.signalTimeoutSec;
    try {
      const earliest = await this.params.scripts.getEarliestReadyScore();
      if (earliest === null) return this.params.signalTimeoutSec;
      const untilDueSec = (earliest - nowInstant().epochMilliseconds) / 1000;
      return Math.min(this.params.signalTimeoutSec, Math.max(untilDueSec, 0.05));
    } catch {
      // Peek is best-effort; fall back to the fixed interval.
      return this.params.signalTimeoutSec;
    }
  }

  private async dispatchBatch(): Promise<number> {
    if (this.paused) return 0;
    const availableSlots =
      this.params.globalConcurrency -
      this.params.processingQueue.length() -
      this.params.processingQueue.running();
    if (availableSlots <= 0) {
      return 0;
    }

    const maxJobs = Math.min(availableSlots, MAX_BATCH_SIZE);
    const results = await this.params.scripts.dispatchBatch({
      nowMs: nowInstant().epochMilliseconds,
      activeTtlSec: this.params.activeTtlSec,
      maxJobs,
      allowedGroupsKey: this.params.dispatchGroupAllowListKey,
    });

    for (const result of results) {
      this.params.processingQueue.push(result).catch((err) => {
        this.params.logger.debug(
          {
            queueName: this.params.queueName,
            groupId: result.groupId,
            stagedJobId: result.stagedJobId,
            error: err instanceof Error ? err.message : String(err),
          },
          "fastq push error (already handled in processWithRetries)",
        );
      });

      gqJobsDispatchedTotal.inc({ queue_name: this.params.queueName });
    }

    if (results.length > 0) {
      this.params.logger.debug(
        {
          queueName: this.params.queueName,
          count: results.length,
        },
        "Batch dispatched jobs from staging to fastq",
      );
    }

    return results.length;
  }
}
