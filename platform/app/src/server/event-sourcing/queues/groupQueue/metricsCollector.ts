import type { Logger } from "@langwatch/observability";
import type fastq from "fastq";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import {
  gqActiveGroups,
  gqBlockedGroups,
  gqFastqActive,
  gqFastqPending,
  gqOldestBacklogAgeMilliseconds,
  gqOldestPendingAgeMilliseconds,
  gqParkedGroups,
  gqPendingGroups,
  gqReadyScoreImplausibleTotal,
} from "./metrics";
import { isPlausibleReadyScore, MIN_PLAUSIBLE_EPOCH_MS } from "./readyScore";
import type { DispatchResult, GroupStagingScripts } from "./scripts";

/**
 * Ready-score written by UNBLOCK_LUA (app-layer/ops/repositories/
 * queue.redis.repository.ts) to force a just-unblocked group to dispatch
 * promptly. It is a sentinel (epoch 1ms), not a real eligibility time, so the
 * oldest-pending-age gauge excludes it — see the computation in collect().
 *
 * It sits below MIN_PLAUSIBLE_EPOCH_MS, so the floor the gauges now apply
 * already drops it. The constant survives as the lower edge of the band the
 * implausible-score counter watches: a sentinel is deliberate, a score of 0 or
 * 57,000 is a producer bug, and only the second should raise a signal.
 */
const READY_UNBLOCK_SENTINEL_SCORE = 1;

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
 * Periodically collects metrics from the group queue processing and staging layers.
 */
export class GroupQueueMetricsCollector {
  private interval: ReturnType<typeof setInterval> | null = null;
  /**
   * Implausible rows seen last cycle. Only the transition from none to some is
   * logged: the counter carries the ongoing signal, and an implausibly-scored
   * group can sit in ready for days, which at collect cadence would be a warn
   * line every few seconds for as long as it stays.
   */
  private lastImplausibleRows = 0;

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
   * dispatch, and a producer whose score function returns 0 or NaN used to
   * stage at the epoch too (`?? 0` in queueManager, `??` in GroupQueue.send:
   * neither catches 0). Both read as ~56 years of age. The lower bound is
   * therefore MIN_PLAUSIBLE_EPOCH_MS rather than `(1`, which makes the gauge
   * structurally incapable of reporting an age that predates the queue,
   * whatever a producer writes. Rows dropped for an implausible (rather than
   * sentinel) score raise gq_ready_score_implausible_total, because a silent
   * skip would leave a mis-scored producer invisible.
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

    const backlog = await this.foldDeferredHeads({
      readyKey,
      keyPrefix,
      nowMs,
      seed: eligibleDueMs,
    });
    gqOldestBacklogAgeMilliseconds.set(
      { queue_name: this.params.queueName },
      backlog.oldest === null ? 0 : Math.max(0, nowMs - backlog.oldest),
    );

    await this.reportImplausibleScores({
      readyKey,
      headRows: backlog.implausible,
    });
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
  }): Promise<{ oldest: number | null; implausible: number }> {
    const deferredGroups = await this.params.redisConnection.zrangebyscore(
      readyKey,
      `(${nowMs}`,
      "+inf",
      "LIMIT",
      0,
      OLDEST_BACKLOG_SAMPLE_GROUPS,
    );
    if (deferredGroups.length === 0) return { oldest: seed, implausible: 0 };

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
   * Counts the ready rows the age probes refused to read as a timestamp, and
   * raises the counter that makes those refusals visible.
   *
   * The unblock sentinel is a deliberate score, so subtract it back out;
   * anything else under the floor is a producer writing something that is not
   * an occurrence time. The sentinel count only runs when something was found
   * under the floor, so the healthy steady state pays for one ZCOUNT over an
   * empty range.
   */
  private async reportImplausibleScores({
    readyKey,
    headRows,
  }: {
    readyKey: string;
    headRows: number;
  }): Promise<void> {
    const belowFloorRows = await this.params.redisConnection.zcount(
      readyKey,
      "-inf",
      `(${MIN_PLAUSIBLE_EPOCH_MS}`,
    );
    const sentinelRows =
      belowFloorRows === 0
        ? 0
        : await this.params.redisConnection.zcount(
            readyKey,
            READY_UNBLOCK_SENTINEL_SCORE,
            READY_UNBLOCK_SENTINEL_SCORE,
          );
    const implausibleRows =
      Math.max(0, belowFloorRows - sentinelRows) + headRows;

    if (implausibleRows > 0) {
      gqReadyScoreImplausibleTotal.inc(
        { queue_name: this.params.queueName },
        implausibleRows,
      );
    }
    if (implausibleRows > 0 && this.lastImplausibleRows === 0) {
      this.params.logger.warn(
        { queueName: this.params.queueName, implausibleRows },
        "Queue holds jobs scored below the plausible-epoch floor - a producer's score function is returning a value that is not an occurrence time, which also ranks those jobs ahead of every real one",
      );
    }
    this.lastImplausibleRows = implausibleRows;
  }
}

/**
 * Folds the sampled head-job [member, score] replies into the running oldest
 * due time. Only DUE jobs are backlog: a head legitimately scheduled in the
 * future (delayed stage, monitor timers hours out) is not late work.
 *
 * A head score below the plausible-epoch floor is dropped for the same reason
 * the eligible probe drops one - `nowMs - 0` is not an age - and reported back
 * so the caller can count it. An absent or unreadable head is not implausible,
 * just nothing to fold.
 */
function minDueMs(
  seed: number | null,
  headResults: Array<[unknown, unknown]>,
  nowMs: number,
): { oldest: number | null; implausible: number } {
  const heads = headResults
    .map(([err, value]) => (err ? [] : (value as string[])))
    .filter((arr) => arr.length >= 2)
    .map((arr) => Number(arr[1]));

  const oldest = heads
    .filter((dueMs) => isPlausibleReadyScore(dueMs) && dueMs <= nowMs)
    .reduce<number | null>(
      (acc, dueMs) => (acc === null || dueMs < acc ? dueMs : acc),
      seed,
    );

  return {
    oldest,
    implausible: heads.filter((dueMs) => !isPlausibleReadyScore(dueMs)).length,
  };
}
