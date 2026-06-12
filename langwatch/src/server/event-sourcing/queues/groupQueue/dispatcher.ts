import type fastq from "fastq";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { Logger } from "pino";
import { gqJobsDispatchedTotal } from "./metrics";
import type { DispatchResult, GroupStagingScripts } from "./scripts";

/** Max jobs to dispatch per Lua call to bound script execution time. */
const MAX_BATCH_SIZE = 200;

/**
 * Dispatcher loop: waits for signals on the Redis signal list and dispatches
 * jobs from the staging layer into the fastq processing queue.
 */
export class GroupQueueDispatcher {
  private shutdownRequested = false;
  private running = false;

  constructor(
    private readonly params: {
      scripts: GroupStagingScripts;
      processingQueue: fastq.queueAsPromised<DispatchResult, void>;
      blockingConnection: IORedis | Cluster;
      queueName: string;
      globalConcurrency: number;
      activeTtlSec: number;
      signalTimeoutSec: number;
      logger: Logger;
    },
  ) {}

  start(): void {
    this.running = true;

    const run = async () => {
      while (!this.shutdownRequested) {
        try {
          await this.waitForSignal();

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
        } catch (error) {
          if (this.shutdownRequested) break;

          const errorMessage =
            error instanceof Error ? error.message : String(error);

          if (errorMessage.includes("Connection is closed")) {
            this.params.logger.debug(
              { queueName: this.params.queueName },
              "Redis connection closed, stopping dispatcher",
            );
            this.shutdownRequested = true;
            break;
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
      }

      this.running = false;
      this.params.logger.debug(
        { queueName: this.params.queueName },
        "Dispatcher loop stopped",
      );
    };

    void run();
  }

  requestShutdown(): void {
    this.shutdownRequested = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  async waitUntilStopped(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async waitForSignal(): Promise<void> {
    const signalKey = this.params.scripts.getSignalKey();
    await this.params.blockingConnection.brpop(
      signalKey,
      await this.nextSignalTimeoutSec(),
    );
    // Drain remaining buffered signals — the upcoming dispatchBatch
    // handles multiple jobs in one Lua call, so N signals = 1 cycle.
    await this.params.blockingConnection.del(signalKey);
  }

  /**
   * Backstop poll cadence when the ready HEAD is already past due. We only
   * reach waitForSignal after dispatchBatch returned 0, so everything
   * dispatchable was just dispatched — a past-due head here is either
   * UNDISPATCHABLE (a job-level paused pipeline that skips in place, a group
   * mid-transition, or any case nobody has enumerated yet) or a job that
   * became due/dispatchable in the race since that scan (e.g. a completion
   * signal destroyed by the post-dispatch signal DEL). Polling such a head at
   * a tight floor would busy-poll Redis for as long as the condition lasts
   * (a paused pipeline = the whole mitigation window); waiting the full
   * heartbeat would re-introduce the 5s latency for the race case. 1s bounds
   * EVERY due-but-undispatchable case to ~1 cycle/sec without enumerating
   * them, and recovers the race case 5x faster than the heartbeat.
   */
  private static readonly PAST_DUE_POLL_SEC = 1;

  /**
   * BRPOP timeout for the next wait: the heartbeat (signalTimeoutSec), but
   * capped at the time until the earliest FUTURE-due job. A delayed/future-
   * scored job's signal fires at stage time (before it is due) and is drained,
   * so without this cap the dispatcher would sleep the full heartbeat and pick
   * the job up to signalTimeoutSec late (#4742). A past-due head polls at the
   * PAST_DUE_POLL_SEC backstop (see above). Falls back to the full heartbeat
   * on any peek error — never blocks forever, never misses a wakeup (a fresh
   * stage still pushes a signal that wakes BRPOP immediately).
   */
  private async nextSignalTimeoutSec(): Promise<number> {
    // Saturated: every worker slot is in use (same check dispatchBatch uses), so
    // there is nothing to dispatch into regardless of how overdue ready jobs are.
    // A completion LPUSHes a signal when a slot frees, so wait the full heartbeat
    // rather than poll.
    const inFlight =
      this.params.processingQueue.length() +
      this.params.processingQueue.running();
    if (inFlight >= this.params.globalConcurrency) {
      return this.params.signalTimeoutSec;
    }
    let earliest: number | null;
    try {
      earliest = await this.params.scripts.peekEarliestReadyScore();
    } catch {
      return this.params.signalTimeoutSec;
    }
    if (earliest === null) return this.params.signalTimeoutSec;
    const waitSec = (earliest - Date.now()) / 1000;
    if (waitSec <= 0) return GroupQueueDispatcher.PAST_DUE_POLL_SEC;
    return Math.min(this.params.signalTimeoutSec, Math.max(0.05, waitSec));
  }

  private async dispatchBatch(): Promise<number> {
    const availableSlots =
      this.params.globalConcurrency -
      this.params.processingQueue.length() -
      this.params.processingQueue.running();
    if (availableSlots <= 0) {
      return 0;
    }

    const maxJobs = Math.min(availableSlots, MAX_BATCH_SIZE);
    const results = await this.params.scripts.dispatchBatch({
      nowMs: Date.now(),
      activeTtlSec: this.params.activeTtlSec,
      maxJobs,
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
