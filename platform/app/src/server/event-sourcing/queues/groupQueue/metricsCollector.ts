import type { Logger } from "@langwatch/observability";
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
} from "./metrics";
import { isPlausibleReadyScore, MIN_PLAUSIBLE_EPOCH_MS } from "./readyScore";
import {
  type DispatchResult,
  type GroupStagingScripts,
  pendingGroupsKey,
} from "./scripts";

/**
 * How many of the soonest-future-scored ("nearest deferred") ready groups the
 * backlog-age gauge samples per collect. Retry-pinned groups' scores sit
 * within maxBackoffMs (600s) of now, so an ascending scan from just-past-now
 * finds them first; long-delayed groups (monitor timers, hours out) rank far
 * later in that same scan and can no longer displace them, unlike a sample
 * taken from the opposite (largest-score) end. In-flight groups sampled
 * alongside contribute nothing because their head job is not due. Bounded so
 * a collect cycle stays O(sample) pipeline commands whatever the backlog size.
 */
const OLDEST_BACKLOG_SAMPLE_GROUPS = 50;

/**
 * Groups whose staging depth one collect cycle reads.
 *
 * A cap, not a sample. The cursor below survives across cycles, so successive
 * cycles read the next page instead of the same head, and every group is
 * reached within one rotation whatever the group count. Paged at the same
 * width the ops repository already pages the ready set at.
 */
const STAGING_DEPTH_GROUPS_PER_CYCLE = 1000;

/**
 * Periodically collects metrics from the group queue processing and staging layers.
 */
export class GroupQueueMetricsCollector {
  private interval: ReturnType<typeof setInterval> | null = null;

  /**
   * Whether a cycle is still running.
   *
   * The timer does not await `collect`, which was harmless while a cycle
   * carried no state between calls. The rotation below does: two overlapping
   * cycles would read the same cursor, both advance it, and skip the page
   * between them. A cycle that pipelines a page of HLENs is also the cycle
   * most likely to outlast the interval. Skipping a tick loses nothing a
   * rotation does not pick up on the next one.
   */
  private isCollecting = false;

  /** SSCAN cursor for the staging-depth rotation; "0" starts a new rotation. */
  private stagingCursor = "0";
  /** Deepest group seen so far in the rotation in progress. */
  private stagingDepthMax = 0;
  /**
   * Groups over the threshold in the rotation in progress, by id.
   *
   * Ids rather than a counter because SSCAN promises each member at least
   * once, not exactly once: a group present across a rehash can be returned on
   * two pages, and counting sightings would report one hot group as several.
   * The max is immune to that, a count is not, and telling one deep group from
   * a stalled drainer is the whole reason the count exists.
   *
   * Only over-threshold ids are held, so this is empty in the steady state and
   * never larger than the number it reports.
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
      gqFastqActive.set(
        { queue_name: this.params.queueName },
        this.params.activeJobCountFn(),
      );

      const keyPrefix = this.params.scripts.getKeyPrefix();
      const readyKey = `${keyPrefix}ready`;
      const blockedKey = `${keyPrefix}blocked`;
      const parkedTenantsKey = `${keyPrefix}parked-tenants`;

      const pendingGroupCount =
        await this.params.redisConnection.zcard(readyKey);
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
   * The two age gauges, from opposite clock origins.
   *
   * Oldest eligible-waiting age. A group's readyKey score is its
   * dispatch-eligibility time, and every not-yet-dispatchable state is
   * future-scored:
   *   - genuinely eligible & waiting     → score <= now   (counted)
   *   - in-flight (re-scored to activeUntil), backoff-pending retry,
   *     and not-yet-due delayed stage    → score > now    (excluded)
   * So the oldest eligible-waiting group is simply the smallest score in
   * (sentinel, now]. STAGE writes the score with ZADD LT (keep-if-smaller)
   * and COMPLETE rewrites it to the next remaining job, so the readyKey
   * score already tracks the group's oldest still-pending job.
   *
   * This replaces the previous "min dispatchAfterMs over the first 10 ready
   * groups" scan, which had two independent defects:
   *   1. Sampling bias — zrange(readyKey, 0, 9) returns the 10 MOST
   *      dispatch-eligible groups, not the oldest, so a real backlog sitting
   *      past index 10 was never inspected and the gauge under-reported.
   *   2. Wrong clock origin — it read the per-group jobs zset, whose scores
   *      are PRESERVED across a block/park, so a just-unblocked group
   *      reported its entire blocked duration as backlog age (0 -> hours in
   *      one tick).
   *
   * Exclude every score that cannot be a timestamp, not just the sentinel.
   * UNBLOCK_LUA (app-layer/ops/repositories/queue.redis.repository.ts) re-adds
   * a group to ready with the constant score 1 (epoch 1ms) to force prompt
   * dispatch, and a producer whose score function returned 0 or NaN used to
   * stage at the epoch too (`?? 0` in queueManager, `??` in GroupQueue.send:
   * neither catches 0). Both read as ~56 years of age. The lower bound is
   * therefore MIN_PLAUSIBLE_EPOCH_MS rather than `(1`, which drops the sentinel
   * and every non-timestamp alike.
   *
   * This is the ABSOLUTE bound only, deliberately - not the two-sided one
   * `resolveReadyScore` applies at staging. A genuine backlog IS arbitrarily
   * far in the past, and reporting it is this gauge's entire job, so "old" must
   * stay reportable while "not a timestamp" is skipped. Staging now bounds what
   * can be written, so what this catches is rows staged before that guard
   * existed; they are not counted here, because by the time a row is read back
   * the producer that wrote it is no longer identifiable. The counter is raised
   * at the staging fallback instead.
   *
   * Known residual: unpark restores a group's preserved (pre-park) ready
   * score, so a long-parked group briefly over-reports on unpark until it is
   * dispatched (one scan cycle). Closing that needs an unpark re-score
   * decision (queue-fairness change), tracked separately.
   *
   * Backlog age regardless of eligibility. The eligible gauge is structurally
   * blind to a group pinned in retry backoff: every failed attempt rewrites
   * the group's ready score to now+backoff, so it is either future-scored
   * (excluded) or freshly re-scored (reads as seconds old) — a head job due
   * for a day never surfaces (2026-08-05 incident: day-old
   * codingAgentSpanFactsDispatch backlogs under a ~2.5s gauge). The
   * per-group jobs zset keeps the job's ORIGINAL due time across retries, so
   * clock off that instead, sampling the soonest-future-scored ("nearest
   * deferred") groups of ready — where retry-pinned groups live, their scores
   * within maxBackoffMs of now — while long-delayed groups (hours out) rank
   * far later and can no longer displace them, and folding in the eligible
   * head so an old eligible group past the sample bound still registers.
   */
  private async collectOldestAges({
    readyKey,
    keyPrefix,
  }: {
    readyKey: string;
    keyPrefix: string;
  }): Promise<void> {
    const nowMs = Date.now();
    const oldestEligible = await this.params.redisConnection.zrangebyscore(
      readyKey,
      MIN_PLAUSIBLE_EPOCH_MS,
      nowMs,
      "WITHSCORES",
      "LIMIT",
      0,
      1,
    );
    const eligibleDueMs =
      oldestEligible.length >= 2 ? Number(oldestEligible[1]) : null;
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
      headPipeline.zrange(
        `${keyPrefix}group:${groupId}:jobs`,
        0,
        0,
        "WITHSCORES",
      );
    }
    const headResults = (await headPipeline.exec()) ?? [];
    return minDueMs(seed, headResults, nowMs);
  }

  /**
   * Reads one page of groups' staging depth, continuing where the last cycle
   * stopped.
   *
   * Over `pending-groups`, not over `ready`. A group is in exactly one of
   * ready, parked, blocked or active, and staging keeps adding fields to the
   * `:data` hash of a group in any of them: `parkGroup` ZREMs from ready and
   * `addToReadyOrParked` then routes new work into the parked set, blocking
   * removes from ready by design ("blocked => not in ready"), and a claimed
   * group's member is ZREMed at claim time. Sweeping ready would therefore
   * report zero for a hot group precisely while something is stopping its
   * drainer, which is the state accumulation is most likely in, and would
   * recreate the detection gap this exists to close.
   *
   * Reading the lifecycle indexes one after another does not fix it either,
   * for the reason PENDING_INDEX_HELPER_LUA already gives: a group moving
   * between them mid-read appears in none of the reads. `pending-groups` is
   * keyed on "has jobs", which no lifecycle transition changes, and is written
   * in the same atomic script as the job. Its membership is a deliberate
   * superset, and over-inclusion costs nothing here: a drained group answers
   * HLEN 0 and is dropped by the same filter that drops a missing key.
   *
   * A rotation rather than a sample, because a sample cannot find this. The
   * failure being watched for is ONE group out of many holding an enormous
   * staging hash, and the previous version of the age gauge above records what
   * happens when you look for a per-group outlier in the first N members of an
   * index: the gauge under-reported for as long as that code existed. Reading
   * a fixed page per cycle and keeping the cursor covers every group instead
   * of the same head repeatedly, at the same cost per cycle.
   *
   * What that costs is timeliness, and it is worth being exact about it. The
   * gauges report the deepest group seen since the current rotation began, so
   * a group that starts accumulating right after the cursor passes it is not
   * reported until the next rotation reaches it: `ceil(groups / 1000)` cycles,
   * one rotation, in the worst case. Against an accumulation that took hours
   * to become an incident, and a capacity alarm that only fired at 50% of the
   * cluster, a rotation's lag is not what makes this late.
   *
   * The running values reset when the cursor wraps, so a group that drained
   * stops being reported within one rotation rather than pinning the gauge at
   * its high-water mark for ever. That makes both gauges saw-tooth by
   * construction: they climb through a rotation and fall to zero at the wrap.
   * An alarm on the instantaneous value would therefore clear once per
   * rotation whatever the queue is doing, so alarm on the maximum over a
   * window that covers at least one rotation instead.
   *
   * SSCAN's guarantee is the one this relies on: every member present for the
   * whole rotation is returned at least once. Members added or removed part
   * way through may or may not be, which is why a fresh accumulation is
   * bounded by a rotation and not by a cycle.
   */
  private async sweepStagingDepth({
    keyPrefix,
  }: {
    keyPrefix: string;
  }): Promise<void> {
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

    gqGroupStagingDepthMax.set(
      { queue_name: this.params.queueName },
      this.stagingDepthMax,
    );
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
   * Reads one page of groups' staging-hash sizes.
   *
   * A group that drained between the scan and the read is gone, not deep:
   * HLEN on a missing key is 0. An errored reply carries no value at all, so
   * it reads as NaN. Neither is evidence of accumulation, and both are dropped
   * by the same filter, because ioredis signals an error by omitting the
   * value rather than alongside one, so the two shapes are not separable here.
   *
   * That filter is not observable through the gauges on its own: every
   * comparison the caller makes is false for NaN already, so a NaN depth is
   * inert whether it is dropped or not. It is here for the reader.
   */
  private async readStagingDepths({
    groupIds,
    keyPrefix,
  }: {
    groupIds: string[];
    keyPrefix: string;
  }): Promise<Array<{ groupId: string; depth: number }>> {
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
 * Folds the sampled head-job [member, score] replies into the running oldest
 * due time. Only DUE jobs are backlog: a head legitimately scheduled in the
 * future (delayed stage, monitor timers hours out) is not late work.
 *
 * A head score below the plausible-epoch floor is dropped for the same reason
 * the eligible probe drops one: `nowMs - 0` is not an age. It is not counted
 * here - the counter is raised at staging, where the value still exists and the
 * producer is still identifiable.
 */
function minDueMs(
  seed: number | null,
  headResults: Array<[unknown, unknown]>,
  nowMs: number,
): number | null {
  return headResults
    .map(([err, value]) => (err ? [] : (value as string[])))
    .filter((arr) => arr.length >= 2)
    .map((arr) => Number(arr[1]))
    .filter((dueMs) => isPlausibleReadyScore(dueMs) && dueMs <= nowMs)
    .reduce<number | null>(
      (acc, dueMs) => (acc === null || dueMs < acc ? dueMs : acc),
      seed,
    );
}
