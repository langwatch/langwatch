import type fastq from "fastq";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { Logger } from "pino";
import {
  gqActiveGroups,
  gqFastqActive,
  gqFastqPending,
  gqPendingGroups,
  gqOldestPendingAgeMilliseconds,
} from "./metrics";
import type { DispatchResult, GroupStagingScripts } from "./scripts";

/**
 * Periodically collects metrics from the group queue processing and staging layers.
 */
export class GroupQueueMetricsCollector {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly params: {
      scripts: GroupStagingScripts;
      processingQueue: fastq.queueAsPromised<DispatchResult, void>;
      redisConnection: IORedis | Cluster;
      queueName: string;
      activeJobCountFn: () => number;
      metricsIntervalMs: number;
      logger: Logger;
    },
  ) {}

  start(): void {
    void this.collect();
    this.interval = setInterval(() => {
      void this.collect();
    }, this.params.metricsIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async collect(): Promise<void> {
    try {
      gqFastqPending.set(
        { queue_name: this.params.queueName },
        this.params.processingQueue.length(),
      );
      gqFastqActive.set(
        { queue_name: this.params.queueName },
        this.params.activeJobCountFn(),
      );

      const keyPrefix = this.params.scripts.getKeyPrefix();
      const readyKey = `${keyPrefix}ready`;

      const pendingGroupCount = await this.params.redisConnection.zcard(
        readyKey,
      );

      gqPendingGroups.set(
        { queue_name: this.params.queueName },
        pendingGroupCount,
      );
      gqActiveGroups.set(
        { queue_name: this.params.queueName },
        this.params.activeJobCountFn(),
      );

      // Oldest pending age: query minimum score from the ready sorted set
      const oldestEntry = await this.params.redisConnection.zrange(
        readyKey,
        0,
        0,
        "WITHSCORES",
      );
      if (oldestEntry.length >= 2) {
        const oldestScore = Number(oldestEntry[1]);
        const age = Date.now() - oldestScore;
        gqOldestPendingAgeMilliseconds.set(
          { queue_name: this.params.queueName },
          Math.max(0, age),
        );
      } else {
        gqOldestPendingAgeMilliseconds.set(
          { queue_name: this.params.queueName },
          0,
        );
      }
    } catch (error) {
      this.params.logger.debug(
        {
          queueName: this.params.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to collect group queue metrics",
      );
    }
  }
}
