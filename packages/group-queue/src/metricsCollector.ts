import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type fastq from "fastq";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import { CachedLuaScript } from "./cachedLuaScript.ts";
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
import {
  type DispatchResult,
  type GroupStagingScripts,
  pendingGroupsKey,
  ROUTING_META_HELPER_LUA,
} from "./scripts.ts";

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
 * Blocked groups broken down by pipeline/job per cycle; any beyond read as
 * "unknown". The blocked set is thousands at worst, so this rarely binds.
 */
const BLOCKED_LABEL_LIMIT = 10_000;

/** Groups one label-resolving script call reads, so no call holds Redis long. */
const LABEL_RESOLVE_BATCH = 500;

/** The labels a group's head job carries: the same values the job counters use. */
type GroupLabels = { pipeline_name: string; job_type: string; job_name: string };

const UNKNOWN_LABELS: GroupLabels = {
  pipeline_name: "unknown",
  job_type: "unknown",
  job_name: "unknown",
};

/**
 * Reads each group's head job routing header (p/t/n) on Redis, so the payload
 * never crosses the wire. KEYS[1] only routes the call to the queue's slot.
 */
const groupRoutingLabelsScript = new CachedLuaScript(`${ROUTING_META_HELPER_LUA}
local keyPrefix = ARGV[1]
local out = {}
for index = 2, #ARGV do
  local groupId = ARGV[index]
  local p, t, n = "", "", ""
  local head = redis.call("ZRANGE", keyPrefix .. "group:" .. groupId .. ":jobs", 0, 0)
  if head[1] then
    local value = redis.call("HGET", keyPrefix .. "group:" .. groupId .. ":data", head[1])
    if value then
      local rp, rt, rn = gqRoutingMeta(value)
      if type(rp) == "string" then p = rp end
      if type(rt) == "string" then t = rt end
      if type(rn) == "string" then n = rn end
    end
  end
  out[#out + 1] = p
  out[#out + 1] = t
  out[#out + 1] = n
end
return out
`);

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

  /** Resolved labels per blocked group; a blocked group's head job does not change. */
  private blockedGroupLabels = new Map<string, GroupLabels>();
  /** Blocked-gauge series published last cycle, so a cleared one is set back to 0. */
  private blockedSeries = new Map<string, GroupLabels>();
  /** The oldest-pending series published last cycle, zeroed when another group takes over. */
  private oldestPendingSeries: GroupLabels | null = null;
  /** Parked group count per tenant last cycle, to log when a tenant starts or stops being parked. */
  private parkedTenantCounts: Map<string, number> | null = null;

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
      gqFastqPending.set(this.params.processingQueue.length(), {
        queue_name: this.params.queueName,
      });
      gqFastqActive.set(this.params.activeJobCountFn(), { queue_name: this.params.queueName });

      const keyPrefix = this.params.scripts.getKeyPrefix();
      const readyKey = `${keyPrefix}ready`;
      const blockedKey = `${keyPrefix}blocked`;
      const parkedTenantsKey = `${keyPrefix}parked-tenants`;

      const pendingGroupCount = await this.params.redisConnection.zcard(readyKey);
      await this.collectBlockedGroups({ keyPrefix, blockedKey });

      // Parked depth = sum of every over-cap tenant's parked zset. The registry
      // set is tiny (one entry per over-cap tenant) and empty in the cap=0
      // steady state, so this is effectively free when nothing is parked.
      let parkedGroupCount = 0;
      const parkedByTenant = new Map<string, number>();
      const parkedTenants = await this.params.redisConnection.smembers(parkedTenantsKey);
      for (const tenantId of parkedTenants) {
        const count = await this.params.redisConnection.zcard(`${keyPrefix}parked:${tenantId}`);
        parkedGroupCount += count;
        if (count > 0) parkedByTenant.set(tenantId, count);
      }
      this.logParkTransitions(parkedByTenant);

      gqPendingGroups.set(pendingGroupCount, { queue_name: this.params.queueName });
      gqParkedGroups.set(parkedGroupCount, { queue_name: this.params.queueName });
      gqActiveGroups.set(this.params.activeJobCountFn(), { queue_name: this.params.queueName });

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
    await this.publishOldestPending({
      keyPrefix,
      groupId: eligibleDueMs === null ? null : (oldestEligible[0] ?? null),
      ageMs: eligibleDueMs === null ? 0 : Math.max(0, nowMs - eligibleDueMs),
    });

    const oldestDueMs = await this.foldDeferredHeads({
      readyKey,
      keyPrefix,
      nowMs,
      seed: eligibleDueMs,
    });
    gqOldestBacklogAgeMilliseconds.set(
      oldestDueMs === null ? 0 : Math.max(0, nowMs - oldestDueMs),
      { queue_name: this.params.queueName },
    );
  }

  /**
   * Publishes the oldest eligible group's age under its pipeline/job, zeroing
   * the previous holder's series; with nothing eligible, 0 under the queue alone.
   */
  private async publishOldestPending({
    keyPrefix,
    groupId,
    ageMs,
  }: {
    keyPrefix: string;
    groupId: string | null;
    ageMs: number;
  }): Promise<void> {
    const queue_name = this.params.queueName;
    const labels =
      groupId === null
        ? null
        : ((await this.resolveGroupLabels({ keyPrefix, groupIds: [groupId] })).get(groupId) ??
          UNKNOWN_LABELS);
    const previous = this.oldestPendingSeries;
    if (previous && (labels === null || seriesKey(previous) !== seriesKey(labels))) {
      gqOldestPendingAgeMilliseconds.set(0, { queue_name, ...previous });
    }
    gqOldestPendingAgeMilliseconds.set(ageMs, labels ? { queue_name, ...labels } : { queue_name });
    this.oldestPendingSeries = labels;
  }

  /**
   * Blocked groups per pipeline/job. SCARD stays the total; members are read
   * (bounded) only when there are any, and labels resolve once per group.
   * Series that emptied since last cycle are set to 0, not left at their last value.
   */
  private async collectBlockedGroups({
    keyPrefix,
    blockedKey,
  }: {
    keyPrefix: string;
    blockedKey: string;
  }): Promise<void> {
    const total = await this.params.redisConnection.scard(blockedKey);
    const members = total > 0 ? await this.scanBlockedMembers(blockedKey) : [];

    const unseen = members.filter((groupId) => !this.blockedGroupLabels.has(groupId));
    for (const [groupId, labels] of await this.resolveGroupLabels({
      keyPrefix,
      groupIds: unseen,
    })) {
      this.blockedGroupLabels.set(groupId, labels);
    }
    const memberSet = new Set(members);
    for (const groupId of this.blockedGroupLabels.keys()) {
      if (!memberSet.has(groupId)) this.blockedGroupLabels.delete(groupId);
    }

    const counts = new Map<string, { labels: GroupLabels; count: number }>();
    const add = (labels: GroupLabels, count: number) => {
      const key = seriesKey(labels);
      counts.set(key, { labels, count: (counts.get(key)?.count ?? 0) + count });
    };
    for (const groupId of members) add(this.blockedGroupLabels.get(groupId) ?? UNKNOWN_LABELS, 1);
    const unlabelled = Math.max(0, total - members.length);
    if (unlabelled > 0) add(UNKNOWN_LABELS, unlabelled);

    const queue_name = this.params.queueName;
    for (const [key, labels] of this.blockedSeries) {
      if (!counts.has(key)) gqBlockedGroups.set(0, { queue_name, ...labels });
    }
    if (counts.size === 0) gqBlockedGroups.set(0, { queue_name });
    for (const { labels, count } of counts.values()) {
      gqBlockedGroups.set(count, { queue_name, ...labels });
    }
    this.blockedSeries = new Map([...counts].map(([key, { labels }]) => [key, labels]));
  }

  /** Distinct blocked members, up to {@link BLOCKED_LABEL_LIMIT}. */
  private async scanBlockedMembers(blockedKey: string): Promise<string[]> {
    const members = new Set<string>();
    let cursor = "0";
    do {
      const [next, page] = await this.params.redisConnection.sscan(
        blockedKey,
        cursor,
        "COUNT",
        LABEL_RESOLVE_BATCH,
      );
      for (const groupId of page) {
        if (members.size >= BLOCKED_LABEL_LIMIT) return [...members];
        members.add(groupId);
      }
      cursor = next;
    } while (cursor !== "0");
    return [...members];
  }

  /**
   * Each group's head-job pipeline/job, read on Redis in bounded batches. A
   * failed batch leaves its groups out (they read as "unknown") and is retried
   * next cycle, so a script error never costs the rest of the collect.
   */
  private async resolveGroupLabels({
    keyPrefix,
    groupIds,
  }: {
    keyPrefix: string;
    groupIds: string[];
  }): Promise<Map<string, GroupLabels>> {
    const resolved = new Map<string, GroupLabels>();
    for (let start = 0; start < groupIds.length; start += LABEL_RESOLVE_BATCH) {
      const batch = groupIds.slice(start, start + LABEL_RESOLVE_BATCH);
      try {
        const reply = await groupRoutingLabelsScript.run(
          this.params.redisConnection,
          1,
          `${keyPrefix}blocked`,
          keyPrefix,
          ...batch,
        );
        const fields = Array.isArray(reply) ? reply.map(String) : [];
        for (const [index, groupId] of batch.entries()) {
          resolved.set(groupId, {
            pipeline_name: fields[index * 3] || "unknown",
            job_type: fields[index * 3 + 1] || "unknown",
            job_name: fields[index * 3 + 2] || "unknown",
          });
        }
      } catch (error) {
        this.params.logger.debug(
          {
            queueName: this.params.queueName,
            groups: batch.length,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to resolve group routing labels for metrics",
        );
      }
    }
    return resolved;
  }

  /**
   * Logs once when a tenant starts being parked (warn) and once when it stops
   * (info); never per group. The first cycle logs every tenant already parked.
   */
  private logParkTransitions(current: Map<string, number>): void {
    const previous = this.parkedTenantCounts ?? new Map<string, number>();
    for (const [tenantId, parkedGroups] of current) {
      if (previous.has(tenantId)) continue;
      this.params.logger.warn(
        { queueName: this.params.queueName, tenantId, parkedGroups },
        "Tenant started being parked at the in-flight soft cap",
      );
    }
    for (const tenantId of previous.keys()) {
      if (current.has(tenantId)) continue;
      this.params.logger.info(
        { queueName: this.params.queueName, tenantId },
        "Tenant stopped being parked",
      );
    }
    this.parkedTenantCounts = current;
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

    gqGroupStagingDepthMax.set(this.stagingDepthMax, { queue_name: this.params.queueName });
    gqGroupsOverStagingDepth.set(this.stagingOverThreshold.size, {
      queue_name: this.params.queueName,
    });

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

function seriesKey(labels: GroupLabels): string {
  return `${labels.pipeline_name}\u0000${labels.job_type}\u0000${labels.job_name}`;
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
