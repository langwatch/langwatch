import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type fastq from "fastq";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  gqActiveGroups,
  gqBlockedGroups,
  gqFastqActive,
  gqFastqPending,
  gqGroupStagingDepthMax,
  gqGroupsOverStagingDepth,
  gqOldestBacklogAgeMilliseconds,
  gqOldestPendingAgeMilliseconds,
  gqParkedGroups,
  gqPendingGroups,
  STAGING_DEPTH_REPORT_FLOOR,
} from "./metrics.ts";
import { isPlausibleReadyScore, MIN_PLAUSIBLE_EPOCH_MS } from "./readyScore.ts";
import { type DispatchResult, type GroupStagingScripts, pendingGroupsKey } from "./scripts.ts";

/**
 * Sample size for backlog-age gauge; samples nearest deferred groups. Bounded
 * to keep collect cycle O(sample) whatever the backlog size.
 */
const OLDEST_BACKLOG_SAMPLE_GROUPS = 50;

/**
 * Groups whose staging depth one collect cycle reads. A cap, not a sample:
 * the cursor survives across cycles, so successive cycles read the next
 * page and every group is reached within one rotation, whatever the count.
 */
const STAGING_DEPTH_GROUPS_PER_CYCLE = 1000;

/**
 * Periodically collects metrics from the group queue processing and staging layers.
 */
export class GroupQueueMetricsCollector {
  private interval: ReturnType<typeof setInterval> | null = null;

  /**
   * Whether a cycle is running; guards against overlapping cycles that would
   * skip pages in the rotation (timer doesn't await collect).
   */
  private isCollecting = false;

  /** SSCAN cursor for the staging-depth rotation; "0" starts a new rotation. */
  private stagingCursor = "0";
  /** Deepest group seen so far in the rotation in progress. */
  private stagingDepthMax = 0;
  /**
   * Over-threshold groups in rotation, by id (not count, because SSCAN may
   * return members across rehashes; set stays empty in steady state).
   */
  private stagingOverThreshold = new Set<string>();

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
    if (this.isCollecting) return;
    this.isCollecting = true;
    try {
      gqFastqPending.set(
        { queue_name: this.params.queueName },
        this.params.processingQueue.length(),
      );
      gqFastqActive.set({ queue_name: this.params.queueName }, this.params.activeJobCountFn());

      const keyPrefix = this.params.scripts.getKeyPrefix();
      const readyKey = `${keyPrefix}ready`;
      const blockedKey = `${keyPrefix}blocked`;
      const parkedTenantsKey = `${keyPrefix}parked-tenants`;

      const pendingGroupCount = await this.params.redisConnection.zcard(readyKey);
      const blockedGroupCount = await this.params.redisConnection.scard(blockedKey);

      // Parked depth = sum of every over-cap tenant's parked zset. The registry
      // set is tiny (one entry per over-cap tenant) and empty in the cap=0
      // steady state, so this is effectively free when nothing is parked.
      let parkedGroupCount = 0;
      const parkedTenants = await this.params.redisConnection.smembers(parkedTenantsKey);
      for (const tenantId of parkedTenants) {
        parkedGroupCount += await this.params.redisConnection.zcard(
          `${keyPrefix}parked:${tenantId}`,
        );
      }

      gqPendingGroups.set({ queue_name: this.params.queueName }, pendingGroupCount);
      gqBlockedGroups.set({ queue_name: this.params.queueName }, blockedGroupCount);
      gqParkedGroups.set({ queue_name: this.params.queueName }, parkedGroupCount);
      gqActiveGroups.set({ queue_name: this.params.queueName }, this.params.activeJobCountFn());

      await this.collectOldestAges({ readyKey, keyPrefix });
      await this.sweepStagingDepth({ keyPrefix });
    } catch (error) {
      this.params.logger.debug(
        {
          queueName: this.params.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to collect group queue metrics",
      );
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * Collects two age gauges: eligible-waiting (min readyKey score) and
   * backlog-regardless-of-eligibility (nearest-deferred groups + eligible head).
   * Replaces flawed "top-10 groups" scan; validates scores against MIN_PLAUSIBLE_EPOCH_MS.
   */
  private async collectOldestAges({
    readyKey,
    keyPrefix,
  }: {
    readyKey: string;
    keyPrefix: string;
  }): Promise<void> {
    const nowMs = nowInstant().epochMilliseconds;
    const oldestEligible = await this.params.redisConnection.zrangebyscore(
      readyKey,
      MIN_PLAUSIBLE_EPOCH_MS,
      nowMs,
      "WITHSCORES",
      "LIMIT",
      0,
      1,
    );
    const eligibleDueMs = oldestEligible.length >= 2 ? Number(oldestEligible[1]) : null;
    gqOldestPendingAgeMilliseconds.set(
      { queue_name: this.params.queueName },
      eligibleDueMs === null ? 0 : Math.max(0, nowMs - eligibleDueMs),
    );

    const oldestDueMs = await this.foldDeferredHeads({
      readyKey,
      keyPrefix,
      nowMs,
      seed: eligibleDueMs,
    });
    gqOldestBacklogAgeMilliseconds.set(
      { queue_name: this.params.queueName },
      oldestDueMs === null ? 0 : Math.max(0, nowMs - oldestDueMs),
    );
  }

  /**
   * Samples the nearest-deferred ready groups and folds their head-job scores
   * into the oldest due time, seeded with the eligible head so an old eligible
   * group past the sample bound still registers.
   */
  private async foldDeferredHeads({
    readyKey,
    keyPrefix,
    nowMs,
    seed,
  }: {
    readyKey: string;
    keyPrefix: string;
    nowMs: number;
    seed: number | null;
  }): Promise<number | null> {
    const deferredGroups = await this.params.redisConnection.zrangebyscore(
      readyKey,
      `(${nowMs}`,
      "+inf",
      "LIMIT",
      0,
      OLDEST_BACKLOG_SAMPLE_GROUPS,
    );
    if (deferredGroups.length === 0) return seed;

    const headPipeline = this.params.redisConnection.pipeline();
    for (const groupId of deferredGroups) {
      headPipeline.zrange(`${keyPrefix}group:${groupId}:jobs`, 0, 0, "WITHSCORES");
    }
    const headResults = (await headPipeline.exec()) ?? [];
    return minDueMs(seed, headResults, nowMs);
  }

  /**
   * Rotates through all groups' staging depth (one page per cycle) over
   * pending-groups (not ready—lifecycle transitions can hide hot groups).
   * Guarantees finding outliers; resets running max on cursor wrap to detect drained groups.
   */
  private async sweepStagingDepth({ keyPrefix }: { keyPrefix: string }): Promise<void> {
    const [nextCursor, groupIds] = await this.params.redisConnection.sscan(
      pendingGroupsKey(keyPrefix),
      this.stagingCursor,
      "COUNT",
      STAGING_DEPTH_GROUPS_PER_CYCLE,
    );

    for (const { groupId, depth } of await this.readStagingDepths({
      groupIds,
      keyPrefix,
    })) {
      if (depth > this.stagingDepthMax) {
        this.stagingDepthMax = depth;
      }
      if (depth >= STAGING_DEPTH_REPORT_FLOOR) {
        this.stagingOverThreshold.add(groupId);
      }
    }

    gqGroupStagingDepthMax.set({ queue_name: this.params.queueName }, this.stagingDepthMax);
    gqGroupsOverStagingDepth.set(
      { queue_name: this.params.queueName },
      this.stagingOverThreshold.size,
    );

    this.stagingCursor = nextCursor;
    if (nextCursor === "0") {
      this.stagingDepthMax = 0;
      this.stagingOverThreshold.clear();
    }
  }

  /**
   * Reads staging-hash sizes for one page. Missing keys and errors both read
   * as zero/NaN and filter identically (not observable in gauges).
   */
  private async readStagingDepths({
    groupIds,
    keyPrefix,
  }: {
    groupIds: string[];
    keyPrefix: string;
  }): Promise<{ groupId: string; depth: number }[]> {
    if (groupIds.length === 0) return [];

    const pipeline = this.params.redisConnection.pipeline();
    for (const groupId of groupIds) {
      pipeline.hlen(`${keyPrefix}group:${groupId}:data`);
    }
    const results = (await pipeline.exec()) ?? [];

    const depths = results
      .map((result, index) => ({
        groupId: groupIds[index] ?? "",
        depth: Number(result?.[1]),
      }))
      .filter(({ depth }) => Number.isFinite(depth));

    // Say so when replies were dropped. Silence here reads as a healthy zero:
    // if every reply in a page failed, both gauges would publish 0 and look
    // exactly like a queue with nothing accumulating in it.
    const dropped = groupIds.length - depths.length;
    if (dropped > 0) {
      this.params.logger.debug(
        {
          queueName: this.params.queueName,
          dropped,
          ofGroups: groupIds.length,
        },
        "Staging-depth sweep dropped replies that carried no depth",
      );
    }

    return depths;
  }
}

/**
 * Extracts minimum due time from head-job scores; only counts genuinely due jobs,
 * skipping future-scheduled and invalid scores (not counted again at staging).
 */
function minDueMs(
  seed: number | null,
  headResults: [unknown, unknown][],
  nowMs: number,
): number | null {
  return headResults
    .map(([err, value]) => (err ? [] : (value as string[])))
    .filter((arr) => arr.length >= 2)
    .map((arr) => Number(arr[1]))
    .filter((dueMs) => isPlausibleReadyScore(dueMs) && dueMs <= nowMs)
    .reduce<number | null>((acc, dueMs) => (acc === null || dueMs < acc ? dueMs : acc), seed);
}
