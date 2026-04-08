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

      // Oldest pending age: readyKey scores are constant (1), so we need to
      // check per-group job sets for the actual dispatchAfterMs timestamps.
      // Sample up to 10 groups to avoid scanning all groups every collection.
      const sampleGroups = await this.params.redisConnection.zrange(
        readyKey,
        0,
        9,
      );
      let minDispatchAfterMs = Infinity;
      for (const groupId of sampleGroups) {
        const groupJobsKey = `${keyPrefix}group:${groupId}:jobs`;
        const oldest = await this.params.redisConnection.zrange(
          groupJobsKey,
          0,
          0,
          "WITHSCORES",
        );
        if (oldest.length >= 2) {
          const score = Number(oldest[1]);
          if (score > 0 && score < minDispatchAfterMs) {
            minDispatchAfterMs = score;
          }
        }
      }
      const age = minDispatchAfterMs === Infinity ? 0 : Math.max(0, Date.now() - minDispatchAfterMs);
      gqOldestPendingAgeMilliseconds.set(
        { queue_name: this.params.queueName },
        age,
      );
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
