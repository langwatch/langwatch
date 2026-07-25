import type fastq from "fastq";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { Logger } from "@langwatch/observability";
import {
  gqActiveGroups,
  gqBlockedGroups,
  gqFastqActive,
  gqFastqPending,
  gqParkedGroups,
  gqPendingGroups,
  gqOldestPendingAgeMilliseconds,
} from "./metrics";
import type { DispatchResult, GroupStagingScripts } from "./scripts";

/**
 * Ready-score written by UNBLOCK_LUA (app-layer/ops/repositories/
 * queue.redis.repository.ts) to force a just-unblocked group to dispatch
 * promptly. It is a sentinel (epoch 1ms), not a real eligibility time, so the
 * oldest-pending-age gauge excludes it — see the computation in collect().
 */
const READY_UNBLOCK_SENTINEL_SCORE = 1;

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
      const blockedKey = `${keyPrefix}blocked`;
      const parkedTenantsKey = `${keyPrefix}parked-tenants`;

      const pendingGroupCount = await this.params.redisConnection.zcard(
        readyKey,
      );
      const blockedGroupCount =
        await this.params.redisConnection.scard(blockedKey);

      // Parked depth = sum of every over-cap tenant's parked zset. The registry
      // set is tiny (one entry per over-cap tenant) and empty in the cap=0
      // steady state, so this is effectively free when nothing is parked.
      let parkedGroupCount = 0;
      const parkedTenants =
        await this.params.redisConnection.smembers(parkedTenantsKey);
      for (const tenantId of parkedTenants) {
        parkedGroupCount += await this.params.redisConnection.zcard(
          `${keyPrefix}parked:${tenantId}`,
        );
      }

      gqPendingGroups.set(
        { queue_name: this.params.queueName },
        pendingGroupCount,
      );
      gqBlockedGroups.set(
        { queue_name: this.params.queueName },
        blockedGroupCount,
      );
      gqParkedGroups.set(
        { queue_name: this.params.queueName },
        parkedGroupCount,
      );
      gqActiveGroups.set(
        { queue_name: this.params.queueName },
        this.params.activeJobCountFn(),
      );

      // Oldest eligible-waiting age. A group's readyKey score is its
      // dispatch-eligibility time, and every not-yet-dispatchable state is
      // future-scored:
      //   - genuinely eligible & waiting     → score <= now   (counted)
      //   - in-flight (re-scored to activeUntil), backoff-pending retry,
      //     and not-yet-due delayed stage    → score > now    (excluded)
      // So the oldest eligible-waiting group is simply the smallest score in
      // (sentinel, now]. STAGE writes the score with ZADD LT (keep-if-smaller)
      // and COMPLETE rewrites it to the next remaining job, so the readyKey
      // score already tracks the group's oldest still-pending job.
      //
      // This replaces the previous "min dispatchAfterMs over the first 10 ready
      // groups" scan, which had two independent defects:
      //   1. Sampling bias — zrange(readyKey, 0, 9) returns the 10 MOST
      //      dispatch-eligible groups, not the oldest, so a real backlog sitting
      //      past index 10 was never inspected and the gauge under-reported.
      //   2. Wrong clock origin — it read the per-group jobs zset, whose scores
      //      are PRESERVED across a block/park, so a just-unblocked group
      //      reported its entire blocked duration as backlog age (0 -> hours in
      //      one tick).
      //
      // Exclude the unblock sentinel: UNBLOCK_LUA (app-layer/ops/repositories/
      // queue.redis.repository.ts) re-adds a group to ready with the constant
      // score 1 (epoch 1ms) to force prompt dispatch — not a real eligibility
      // time, so a just-unblocked group must not read as ~56 years. The
      // exclusive `(1` lower bound drops it; any real timestamp is far larger.
      //
      // Known residual: unpark restores a group's preserved (pre-park) ready
      // score, so a long-parked group briefly over-reports on unpark until it is
      // dispatched (one scan cycle). Closing that needs an unpark re-score
      // decision (queue-fairness change), tracked separately.
      const nowMs = Date.now();
      const oldestEligible =
        await this.params.redisConnection.zrangebyscore(
          readyKey,
          `(${READY_UNBLOCK_SENTINEL_SCORE}`,
          nowMs,
          "WITHSCORES",
          "LIMIT",
          0,
          1,
        );
      const age =
        oldestEligible.length >= 2
          ? Math.max(0, nowMs - Number(oldestEligible[1]))
          : 0;
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
