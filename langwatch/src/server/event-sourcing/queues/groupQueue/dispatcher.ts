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
          } while (dispatched > 0 && !this.shutdownRequested);
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
      this.params.signalTimeoutSec,
    );
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
