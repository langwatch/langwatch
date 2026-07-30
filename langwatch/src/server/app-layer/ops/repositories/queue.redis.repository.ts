import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { ChainableCommander, Cluster } from "ioredis";
import {
  CachedLuaScript,
  isNoScriptResult,
} from "~/server/event-sourcing/queues/groupQueue/cachedLuaScript";
import {
  decodeJobEnvelope,
  readJobRoutingMeta,
} from "~/server/event-sourcing/queues/groupQueue/jobEnvelope";
import { RedisJobBlobStore } from "~/server/event-sourcing/queues/groupQueue/redisJobBlobStore";
import {
  GROUP_QUEUE_REGISTRY_KEY,
  PARK_HELPER_LUA,
  TTL_HELPER_LUA,
} from "~/server/event-sourcing/queues/groupQueue/scripts";
import { TieredBlobStore } from "~/server/event-sourcing/queues/groupQueue/tieredBlobStore";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
import { normalizeErrorMessage } from "../normalize-error-message";
import type { ErrorCluster, GroupInfo, QueueInfo } from "../types";
import type {
  BlockedSummary,
  DlqGroupInfo,
  DrainPreview,
  JobEntry,
  QueueRepository,
  ReconcileResult,
} from "./queue.repository";

const logger = createLogger("langwatch:ops:queue-redis-repository");

// ── Lua Scripts ──────────────────────────────────────────────────────

const UNBLOCK_LUA =
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  `
local blockedKey = KEYS[1]
local activeKey  = KEYS[2]
local jobsKey    = KEYS[3]
local readyKey   = KEYS[4]
local signalKey  = KEYS[5]
local errorKey   = KEYS[6]
local strikesKey = KEYS[7]
local attemptKey = KEYS[8]
local failStreakKey = KEYS[9]
local groupId    = ARGV[1]
local nowMs      = tonumber(ARGV[2])

local wasBlocked = redis.call("SREM", blockedKey, groupId)

if wasBlocked > 0 then
  redis.call("DEL", activeKey)
  redis.call("DEL", errorKey)
  -- Unblocking is an operator's "try again", so EVERY counter that decides
  -- whether trying is allowed has to be reset — not just the claim strikes
  -- (ADR-080). A group blocked by retry exhaustion came back with its retry
  -- chain still reading "budget spent" and its failure streak still at the
  -- quarantine threshold, so the very first failure re-blocked it, and whether
  -- it did depended on how long the operator took to press the button (the
  -- chain expires on its own after GROUP_ATTEMPT_TTL_SECONDS).
  redis.call("DEL", strikesKey)
  -- specs/event-sourcing/poison-group-park-guard.feature
  redis.call("DEL", attemptKey)
  redis.call("DEL", failStreakKey)

  local pendingCount = redis.call("ZCARD", jobsKey)
  if pendingCount > 0 then
    local score = 1
    -- Route through the parked-aware write so unblock can't clobber a parked
    -- group back into the dispatch scan (TRAP 1). A blocked group is never
    -- itself parked, so this normally writes straight to ready; if the tenant
    -- is over cap, the next dispatch parks it again.
    addToReadyOrParked(readyKey, groupId, score, false)
    -- The block path PERSISTs the group keys; restore the safety-net TTL now
    -- that the group is live again (dataKey = jobsKey with the ":jobs" suffix
    -- swapped for ":data").
    local dataKey = string.sub(jobsKey, 1, #jobsKey - 5) .. ":data"
    refreshGroupKeyTtl(jobsKey, dataKey, nowMs)
  else
    redis.call("ZREM", readyKey, groupId)
  end

  redis.call("LPUSH", signalKey, "1")
  redis.call("LTRIM", signalKey, 0, 999)
end

return wasBlocked
`;

const DRAIN_GROUP_LUA = `
local jobsKey         = KEYS[1]
local dataKey         = KEYS[2]
local activeKey       = KEYS[3]
local readyKey        = KEYS[4]
local blockedKey      = KEYS[5]
local signalKey       = KEYS[6]
local errorKey        = KEYS[7]
local totalPendingKey = KEYS[8]
local strikesKey      = KEYS[9]
local attemptKey      = KEYS[10]
local failStreakKey   = KEYS[11]
local groupId         = ARGV[1]

-- Total dropped = staged jobs (ZCARD) only. Previously this also counted
-- the active job (+hadActive), but since the counter DECR moved from
-- COMPLETE_LUA to DISPATCH (PR #4181), the active job's INCR is already
-- compensated at dispatch time. Counting it again here would double-DECR.
-- Added post-2026-05-11 incident — bulk drain at 500K scale would
-- otherwise leave the stat permanently overstated.
local pendingCount = redis.call("ZCARD", jobsKey)
local totalDropped = pendingCount

redis.call("DEL", jobsKey)
redis.call("DEL", dataKey)
redis.call("DEL", activeKey)
redis.call("DEL", errorKey)
-- Draining empties the group for a fresh start, so EVERY counter that decides
-- whether a later job is allowed to run goes with it. Leaving any behind means
-- a re-created group with the same id inherits it: claim strikes park it on its
-- first claim, a spent retry chain exhausts it on its first failure, and a
-- carried failure streak re-quarantines it (ADR-080,
-- specs/event-sourcing/poison-group-park-guard.feature).
redis.call("DEL", strikesKey)
redis.call("DEL", attemptKey)
redis.call("DEL", failStreakKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

if totalDropped > 0 then
  redis.call("DECRBY", totalPendingKey, totalDropped)
end

return totalDropped
`;

const MOVE_TO_DLQ_LUA = `
local srcJobsKey   = KEYS[1]
local srcDataKey   = KEYS[2]
local activeKey    = KEYS[3]
local readyKey     = KEYS[4]
local blockedKey   = KEYS[5]
local signalKey    = KEYS[6]
local srcErrorKey  = KEYS[7]
local dstJobsKey   = KEYS[8]
local dstDataKey   = KEYS[9]
local dstErrorKey  = KEYS[10]
local dlqIndexKey  = KEYS[11]
local strikesKey   = KEYS[12]
local attemptKey   = KEYS[13]
local failStreakKey = KEYS[14]
local groupId      = ARGV[1]
local ttl          = tonumber(ARGV[2])

local jobs = redis.call("ZRANGE", srcJobsKey, 0, -1, "WITHSCORES")
local count = #jobs / 2
if count > 0 then
  for i = 1, #jobs, 2 do
    redis.call("ZADD", dstJobsKey, jobs[i+1], jobs[i])
  end
end

local data = redis.call("HGETALL", srcDataKey)
for i = 1, #data, 2 do
  redis.call("HSET", dstDataKey, data[i], data[i+1])
end

local errorData = redis.call("HGETALL", srcErrorKey)
for i = 1, #errorData, 2 do
  redis.call("HSET", dstErrorKey, errorData[i], errorData[i+1])
end

if ttl > 0 then
  redis.call("EXPIRE", dstJobsKey, ttl)
  redis.call("EXPIRE", dstDataKey, ttl)
  redis.call("EXPIRE", dstErrorKey, ttl)
end

redis.call("SADD", dlqIndexKey, groupId)

redis.call("DEL", srcJobsKey)
redis.call("DEL", srcDataKey)
redis.call("DEL", activeKey)
redis.call("DEL", srcErrorKey)
-- Moving to the DLQ empties the live group just like a drain, so it clears the
-- same counters for the same reason: a re-created group with the same id must
-- get a fresh run, not inherit strikes, a spent retry chain, or a failure
-- streak from the jobs that were carried off (ADR-080).
redis.call("DEL", strikesKey)
redis.call("DEL", attemptKey)
redis.call("DEL", failStreakKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

const REPLAY_FROM_DLQ_LUA =
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  `
local dlqJobsKey   = KEYS[1]
local dlqDataKey   = KEYS[2]
local dlqErrorKey  = KEYS[3]
local dstJobsKey   = KEYS[4]
local dstDataKey   = KEYS[5]
local readyKey     = KEYS[6]
local signalKey    = KEYS[7]
local dlqIndexKey  = KEYS[8]
local groupId      = ARGV[1]
local nowMs        = tonumber(ARGV[2])

local jobs = redis.call("ZRANGE", dlqJobsKey, 0, -1, "WITHSCORES")
local count = #jobs / 2
if count > 0 then
  for i = 1, #jobs, 2 do
    redis.call("ZADD", dstJobsKey, jobs[i+1], jobs[i])
  end
end

local data = redis.call("HGETALL", dlqDataKey)
for i = 1, #data, 2 do
  redis.call("HSET", dstDataKey, data[i], data[i+1])
end

redis.call("DEL", dlqJobsKey)
redis.call("DEL", dlqDataKey)
redis.call("DEL", dlqErrorKey)
redis.call("SREM", dlqIndexKey, groupId)

if count > 0 then
  -- Route through the parked-aware write so a replay can't clobber a parked
  -- group back into the dispatch scan (TRAP 1). A DLQ group is never itself
  -- parked; if the tenant is over cap, the next dispatch parks it again.
  addToReadyOrParked(readyKey, groupId, 1, false)
  -- Restore the safety-net TTL on the revived group keys (DLQ keys carry none).
  refreshGroupKeyTtl(dstJobsKey, dstDataKey, nowMs)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

/**
 * Drop the DLQ-index members whose dead-letter has already expired, and return
 * the ones still worth showing. The self-healing half of every DLQ read.
 *
 * WHY THIS EXISTS. `SADD {queue}:gq:dlq <groupId>` names a dead-letter, but a
 * Redis SET has no per-member TTL, so the member cannot age out alongside the
 * `dlq:{groupId}:*` keys it points at — those carry `DLQ_TTL_SECONDS`. The only
 * `SREM` on a normal path is `REPLAY_FROM_DLQ_LUA`, which runs when an operator
 * explicitly replays, so a dead-letter left to expire used to leave its groupId
 * in the set forever while the payload it pointed at vanished after 7 days.
 * That was tolerable while `moveToDlq` was the only writer — a rare whole-group
 * operator action, usually followed by a replay. It is not tolerable now that a
 * body-present drop dead-letters ONE job automatically (#719) under a
 * per-aggregate group id that is unique and never reused: `dlqCount` was a raw
 * `SCARD`, so the operator's "there is something in the DLQ" badge became a
 * number that only ever went up and never returned to zero.
 *
 * DO NOT "SIMPLIFY" THIS TO `EXPIRE dlqIndexKey`. It is not the same fix and it
 * is wrong: the set holds many members with independent deadlines, so a single
 * EXPIRE drops ALL of them the moment the oldest ages out — live dead-letters
 * included. A SET has no per-member expiry — true, but not the reason to stop
 * looking: a deadline-scored ZSET (`ZREMRANGEBYSCORE key -inf <now>` to prune,
 * `ZCARD` to count) is the standard structure for exactly this, and this module
 * already uses it — `blobLeases.ts`'s `COUNT_LIVE_LUA` is this index's
 * structural twin (blobLeases.ts:109: "member is a holder identity and its
 * score is an absolute Redis-time deadline"). Converting is DEFERRED (#6362),
 * not rejected: the live production key `{queue}:gq:dlq` is already a SET, so a
 * deploy that `ZADD`s it would fail `WRONGTYPE` — the migration needs a new key
 * name and a read-both window, not a type change in place. Until then, the
 * readers stay authoritative and the set heals behind them.
 *
 * LIVENESS PREDICATE — a member is dropped only when BOTH `dlq:{groupId}:jobs`
 * and `dlq:{groupId}:error` hold nothing, i.e. Redis has nothing left for it.
 * Deliberately not `ZCARD jobs == 0` alone: `MOVE_TO_DLQ_LUA` always copies the
 * group's error hash but only creates the jobs zset when the group had staged
 * jobs, so a stale block (blocked, nothing pending — `isStaleBlock` below)
 * dead-letters as an error hash with no jobs. Nothing there is replayable, but
 * it IS the operator's record of why that group died, and a false SREM would
 * delete a real dead-letter from their only view of it — strictly worse than
 * leaving an orphan behind. `dlq:{groupId}:data` is deliberately not consulted:
 * both writers create it in the same script as the jobs zset and with the same
 * TTL, and without the zset naming its job ids nothing can read or replay it.
 *
 * Check and removal are one atomic script on purpose. Reading liveness in TS
 * and then SREMing would let a concurrent re-dead-lettering of the same group
 * id land in between, and the stale SREM would unindex it — the false-SREM
 * hazard again, this time by race rather than by predicate.
 *
 * Per-group keys are derived here from `keyPrefix` rather than passed in KEYS,
 * the same way the queue's own scripts do it: the prefix carries the
 * `{queueName}` hash tag, so every derived key shares KEYS[1]'s cluster slot.
 */
const SWEEP_DLQ_INDEX_LUA = `
local dlqIndexKey = KEYS[1]
local keyPrefix   = ARGV[1]

-- One variadic SREM per chunk rather than one per member: the round trip is
-- already paid for, but unpack() is bounded by the Lua C stack, so a page is
-- spliced instead of handed over whole.
local SREM_CHUNK = 250

local live = {}
local dead = {}

for i = 2, #ARGV do
  local groupId = ARGV[i]
  local jobCount   = redis.call("ZCARD", keyPrefix .. "dlq:" .. groupId .. ":jobs")
  local errorCount = redis.call("HLEN",  keyPrefix .. "dlq:" .. groupId .. ":error")
  if jobCount == 0 and errorCount == 0 then
    dead[#dead + 1] = groupId
  else
    live[#live + 1] = groupId
  end
end

local at = 1
while at <= #dead do
  local last = math.min(at + SREM_CHUNK - 1, #dead)
  redis.call("SREM", dlqIndexKey, unpack(dead, at, last))
  at = last + 1
end

return live
`;

// ── Cached scripts ───────────────────────────────────────────────────
//
// EVALSHA, not EVAL: plain EVAL re-transfers and re-hashes the full source on
// every call, which was measured at ~33% of the prod Redis engine CPU for the
// queue's own scripts (see `cachedLuaScript.ts`). These ops scripts are larger
// than they look — each one carries the shared TTL/park helpers — and the bulk
// paths below run one per group across a whole page, so the same argument
// applies. A NOSCRIPT miss falls back to EVAL once and warms the node's cache.

const unblockScript = new CachedLuaScript(UNBLOCK_LUA);
const drainGroupScript = new CachedLuaScript(DRAIN_GROUP_LUA);
const moveToDlqScript = new CachedLuaScript(MOVE_TO_DLQ_LUA);
const replayFromDlqScript = new CachedLuaScript(REPLAY_FROM_DLQ_LUA);
const sweepDlqIndexScript = new CachedLuaScript(SWEEP_DLQ_INDEX_LUA);

// ── Constants ────────────────────────────────────────────────────────

const SUMMARY_TOP_N = 200;
const DLQ_TTL_SECONDS = 604800;
const SSCAN_BATCH = 500;
const PENDING_RECONCILE_SCAN_COUNT = 1000;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Run a pipeline of cached scripts, re-running any entry the node had no cached
 * copy of.
 *
 * `queue()` sends EVALSHA with no fallback of its own — a queued command cannot
 * retry itself — so a node whose script cache is cold (restart, SCRIPT FLUSH,
 * or the first call against a fresh cluster node) fails EVERY entry in the
 * batch with NOSCRIPT. These are the bulk operator paths, so without this a
 * "drain everything" would report zero drained and quietly do nothing. Re-running
 * through `run()` both completes the work and loads the source for later calls.
 *
 * Returns the same `[err, value]` tuples `pipeline.exec()` does, so callers read
 * the results exactly as before.
 */
export async function execWithNoScriptRecovery(
  pipeline: ChainableCommander,
  rerun: (index: number) => Promise<unknown>,
): Promise<Array<[Error | null, unknown]>> {
  const results = (await pipeline.exec()) ?? [];
  return await Promise.all(
    results.map(async (result, index): Promise<[Error | null, unknown]> => {
      if (!isNoScriptResult(result)) return result;
      try {
        return [null, await rerun(index)];
      } catch (err) {
        return [err instanceof Error ? err : new Error(String(err)), null];
      }
    }),
  );
}

function stripHashTag(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    return name.slice(1, -1);
  }
  return name;
}

function parseRetryCount(id: string | null): number | null {
  if (!id) return null;
  const match = id.match(/\/r\/(\d+)$/);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  return n < 1000 ? n : null;
}

// ── Repository Implementation ────────────────────────────────────────

export class QueueRedisRepository implements QueueRepository {
  private readonly redis: IORedis | Cluster;

  constructor(redis: IORedis | Cluster) {
    this.redis = redis;
  }

  // ── Queue Discovery & Scanning ──────────────────────────────────

  async discoverQueueNames(): Promise<string[]> {
    // Fast path: producers register their queue name on construction, so the
    // registry set is the authoritative list and reads in O(1).
    const registered = await this.redis.smembers(GROUP_QUEUE_REGISTRY_KEY);
    if (registered.length > 0) {
      return registered;
    }

    // Fallback for the window after deploy before any producer has registered
    // (or a wiped registry): scan once, then backfill so the next call is O(1).
    // Without this the dashboard would scan the full keyspace on every poll.
    const names = await this.scanReadyKeyNames();
    if (names.length > 0) {
      await this.redis.sadd(GROUP_QUEUE_REGISTRY_KEY, ...names);
    }
    return names;
  }

  private async scanReadyKeyNames(): Promise<string[]> {
    const names = new Set<string>();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        "*:gq:ready",
        "COUNT",
        50000,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const gqIdx = key.indexOf(":gq:ready");
        if (gqIdx > 0) {
          names.add(key.slice(0, gqIdx));
        }
      }
    } while (cursor !== "0");

    return Array.from(names);
  }

  async scanQueues(params: {
    queueNames: string[];
    topN?: number;
  }): Promise<QueueInfo[]> {
    const queues = await Promise.all(
      params.queueNames.map((queueName) =>
        this.scanSingleQueue(queueName, params.topN ?? SUMMARY_TOP_N),
      ),
    );
    queues.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return queues;
  }

  private async scanSingleQueue(
    queueName: string,
    limit: number,
    offset = 0,
  ): Promise<QueueInfo> {
    const displayName = stripHashTag(queueName);
    const prefix = `${queueName}:gq:`;

    const readyKey = `${prefix}ready`;
    const blockedKey = `${prefix}blocked`;
    const totalPendingKey = `${prefix}stats:total-pending`;
    const parkedTenantsKey = `${prefix}parked-tenants`;

    const [
      readyCount,
      blockedCount,
      dlqCount,
      topReadyMembers,
      totalPendingRaw,
      parkedTenants,
    ] = await Promise.all([
      this.redis.zcard(readyKey),
      this.redis.scard(blockedKey),
      // Not a SCARD of the DLQ index — see SWEEP_DLQ_INDEX_LUA. This tile is
      // the operator's primary "there is something in the DLQ" signal (it feeds
      // the ops nav badge and the dashboard total), so it counts only what is
      // still there and sweeps what is not.
      this.countLiveDlqGroups({ prefix }),
      this.redis.zrevrange(readyKey, offset, offset + limit - 1, "WITHSCORES"),
      this.redis.get(totalPendingKey),
      this.redis.smembers(parkedTenantsKey),
    ]);

    // Sum parked depth across the tenants currently over cap. The registry set
    // is tiny (one entry per over-cap tenant), so this is a single SMEMBERS plus
    // one ZCARD per parked tenant — effectively free in the cap=0 steady state
    // where the registry is empty.
    let parkedGroupCount = 0;
    if (parkedTenants.length > 0) {
      const parkedPipeline = this.redis.pipeline();
      for (const tenantId of parkedTenants) {
        parkedPipeline.zcard(`${prefix}parked:${tenantId}`);
      }
      const parkedResults = await parkedPipeline.exec();
      for (const [err, val] of parkedResults ?? []) {
        if (!err) parkedGroupCount += Number(val) || 0;
      }
    }

    const groupIds: string[] = [];
    const readyScores = new Map<string, number>();
    for (let i = 0; i < topReadyMembers.length; i += 2) {
      const groupId = topReadyMembers[i]!;
      const score = parseFloat(topReadyMembers[i + 1]!);
      groupIds.push(groupId);
      readyScores.set(groupId, score);
    }

    const blockedMembers =
      blockedCount > 0
        ? await this.redis.srandmember(
            blockedKey,
            Math.min(limit, blockedCount),
          )
        : [];
    const readyGroupIdSet = new Set(groupIds);
    const blockedGroupIds = (blockedMembers ?? []).filter(
      (id): id is string => id !== null && !readyGroupIdSet.has(id),
    );

    const allGroupIds = [...groupIds, ...blockedGroupIds];

    const CMDS_PER_GROUP = 6;
    const pipeline = this.redis.pipeline();
    for (const groupId of allGroupIds) {
      const jobsKey = `${prefix}group:${groupId}:jobs`;
      const activeKey = `${prefix}group:${groupId}:active`;
      pipeline.zcard(jobsKey);
      pipeline.get(activeKey);
      pipeline.zrange(jobsKey, 0, 0, "WITHSCORES");
      pipeline.zrange(jobsKey, -1, -1, "WITHSCORES");
      pipeline.sismember(blockedKey, groupId);
      pipeline.ttl(`${prefix}group:${groupId}:active`);
    }

    const pipelineResults = await pipeline.exec();

    const firstJobIds: Array<{ groupId: string; jobId: string | null }> = [];
    for (let i = 0; i < allGroupIds.length; i++) {
      const base = i * CMDS_PER_GROUP;
      const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
      firstJobIds.push({
        groupId: allGroupIds[i]!,
        jobId: oldestArr[0] ?? null,
      });
    }

    const dataPipeline = this.redis.pipeline();
    let dataFetchCount = 0;
    for (const { groupId, jobId } of firstJobIds) {
      if (jobId) {
        dataPipeline.hget(`${prefix}group:${groupId}:data`, jobId);
        dataFetchCount++;
      }
    }
    const dataResults = dataFetchCount > 0 ? await dataPipeline.exec() : [];

    const errorPipeline = this.redis.pipeline();
    for (const groupId of allGroupIds) {
      errorPipeline.hgetall(`${prefix}group:${groupId}:error`);
    }
    const errorResults =
      allGroupIds.length > 0 ? await errorPipeline.exec() : [];

    const groupErrors = new Map<
      string,
      { message: string; stack: string; timestamp: string }
    >();
    for (let i = 0; i < allGroupIds.length; i++) {
      const errorHash = errorResults?.[i]?.[1] as Record<string, string> | null;
      if (errorHash?.message) {
        groupErrors.set(allGroupIds[i]!, {
          message: errorHash.message,
          stack: errorHash.stack ?? "",
          timestamp: errorHash.timestamp ?? "",
        });
      }
    }

    let dataIdx = 0;
    const groups: GroupInfo[] = [];
    let activeGroupCount = 0;

    for (let i = 0; i < allGroupIds.length; i++) {
      const groupId = allGroupIds[i]!;
      const base = i * CMDS_PER_GROUP;

      const pendingJobs = (pipelineResults?.[base]?.[1] as number) ?? 0;
      const activeJobId = (pipelineResults?.[base + 1]?.[1] as string) ?? null;
      const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
      const newestArr = (pipelineResults?.[base + 3]?.[1] as string[]) ?? [];
      const isBlocked = (pipelineResults?.[base + 4]?.[1] as number) === 1;
      const activeKeyTtlSec =
        (pipelineResults?.[base + 5]?.[1] as number) ?? -2;

      const oldestJobMs =
        oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null;
      const newestJobMs =
        newestArr.length >= 2 ? parseFloat(newestArr[1]!) : null;

      let pipelineName: string | null = null;
      let jobType: string | null = null;
      let jobName: string | null = null;

      if (firstJobIds[i]!.jobId) {
        const rawData = (dataResults?.[dataIdx]?.[1] as string) ?? null;
        dataIdx++;
        if (rawData) {
          const meta = readJobRoutingMeta(rawData);
          pipelineName = meta.pipelineName;
          jobType = meta.jobType;
          jobName = meta.jobName;
        }
      }

      const errorInfo = groupErrors.get(groupId);
      if (activeJobId !== null) activeGroupCount++;

      groups.push({
        groupId,
        pendingJobs,
        score: readyScores.get(groupId) ?? 0,
        hasActiveJob: activeJobId !== null,
        activeJobId,
        isBlocked,
        oldestJobMs,
        newestJobMs,
        isStaleBlock: isBlocked && pendingJobs === 0 && activeJobId === null,
        pipelineName,
        jobType,
        jobName,
        errorMessage: errorInfo?.message ?? null,
        errorStack: errorInfo?.stack ?? null,
        errorTimestamp: errorInfo?.timestamp
          ? parseFloat(errorInfo.timestamp)
          : null,
        retryCount: parseRetryCount(firstJobIds[i]!.jobId),
        activeKeyTtlSec: activeKeyTtlSec > 0 ? activeKeyTtlSec : null,
        processingDurationMs: null,
      });
    }

    groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

    let totalPendingJobs: number;
    if (totalPendingRaw !== null) {
      totalPendingJobs = Math.max(0, parseInt(totalPendingRaw, 10) || 0);
    } else {
      totalPendingJobs = 0;
      for (const g of groups) {
        totalPendingJobs += g.pendingJobs;
      }
    }

    return {
      name: queueName,
      displayName,
      pendingGroupCount: readyCount,
      blockedGroupCount: blockedCount,
      activeGroupCount,
      totalPendingJobs,
      dlqCount,
      parkedGroupCount,
      groups,
    };
  }

  // ── Job Browsing ────────────────────────────────────────────────

  async getGroupJobs(params: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<{ jobs: JobEntry[]; total: number }> {
    const prefix = `${params.queueName}:gq:`;
    const jobsKey = `${prefix}group:${params.groupId}:jobs`;

    const total = await this.redis.zcard(jobsKey);
    const start = (params.page - 1) * params.pageSize;
    const end = start + params.pageSize - 1;
    const jobEntries = await this.redis.zrange(
      jobsKey,
      start,
      end,
      "WITHSCORES",
    );

    const jobs: JobEntry[] = [];
    const jobIds: string[] = [];

    for (let i = 0; i < jobEntries.length; i += 2) {
      const jobId = jobEntries[i]!;
      const score = parseFloat(jobEntries[i + 1]!);
      jobIds.push(jobId);
      jobs.push({ jobId, score, data: null });
    }

    if (jobIds.length > 0) {
      const dataPipeline = this.redis.pipeline();
      for (const jobId of jobIds) {
        dataPipeline.hget(`${prefix}group:${params.groupId}:data`, jobId);
      }
      const dataResults = await dataPipeline.exec();

      const blobs = new RedisJobBlobStore({
        redis: this.redis,
        queueName: params.queueName,
      });
      // Wire the GQ2 tiered store too so an offloaded envelope renders its
      // body in the ops dashboard once the write flag flips in prod. Without
      // it, decode throws "no tiered store provided" and the catch below hides
      // the payload from any operator trying to diagnose a stuck GQ2 job
      // (2026-07-03 audit follow-up).
      const tieredBlobs = new TieredBlobStore({
        redisBlobs: blobs,
        objectStoreFor: (projectId) => createStorageRegistry({ projectId }),
        resolveDestination: resolveProjectStorageDestination,
        queueName: params.queueName,
        logger,
      });
      await Promise.all(
        jobIds.map(async (_, i) => {
          const raw = dataResults?.[i]?.[1] as string | null;
          if (raw) {
            try {
              // Ops-dashboard inspection: DO NOT refresh the blob TTL on read
              // (2026-06-24 review). A repeatedly-viewed blocked group would
              // otherwise keep its orphan blobs alive indefinitely. readMode
              // "peek" routes BOTH the GQ1 blobs.get AND the tieredBlobs.get
              // to their peek variants.
              jobs[i]!.data = await decodeJobEnvelope({
                value: raw,
                blobs,
                tieredBlobs,
                readMode: "peek",
              });
            } catch {
              // ignore undecodable values
            }
          }
        }),
      );
    }

    return { jobs, total };
  }

  // ── Blocked Group Analysis ─────────────────────────────────────

  async getBlockedSummary(params: {
    queueNames: string[];
  }): Promise<BlockedSummary> {
    let totalBlocked = 0;
    const clusterMap = new Map<string, ErrorCluster>();

    for (const queueName of params.queueNames) {
      const prefix = `${queueName}:gq:`;
      const blockedKey = `${prefix}blocked`;

      let cursor = "0";
      do {
        const [nextCursor, members] = await this.redis.sscan(
          blockedKey,
          cursor,
          "COUNT",
          SSCAN_BATCH,
        );
        cursor = nextCursor;
        totalBlocked += members.length;

        if (members.length === 0) continue;

        const pipeline = this.redis.pipeline();
        for (const groupId of members) {
          pipeline.hgetall(`${prefix}group:${groupId}:error`);
          pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
        }
        const results = await pipeline.exec();

        const jobDataPipeline = this.redis.pipeline();
        const jobDataRequests: { groupId: string; jobId: string }[] = [];
        for (let i = 0; i < members.length; i++) {
          const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
          if (jobArr[0]) {
            jobDataPipeline.hget(
              `${prefix}group:${members[i]!}:data`,
              jobArr[0],
            );
            jobDataRequests.push({ groupId: members[i]!, jobId: jobArr[0] });
          }
        }
        const jobDataResults =
          jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

        const pipelineNames = new Map<string, string>();
        for (let i = 0; i < jobDataRequests.length; i++) {
          const raw = jobDataResults?.[i]?.[1] as string | null;
          if (raw) {
            const pipelineName = readJobRoutingMeta(raw).pipelineName;
            if (pipelineName) {
              pipelineNames.set(jobDataRequests[i]!.groupId, pipelineName);
            }
          }
        }

        for (let i = 0; i < members.length; i++) {
          const groupId = members[i]!;
          const errorHash = results?.[i * 2]?.[1] as Record<
            string,
            string
          > | null;
          const message = errorHash?.message ?? "Unknown error";
          const stack = errorHash?.stack ?? null;
          const pipelineName = pipelineNames.get(groupId) ?? null;

          const normalized = normalizeErrorMessage(message);
          const clusterKey = `${pipelineName ?? ""}::${normalized}`;

          const existing = clusterMap.get(clusterKey);
          if (existing) {
            existing.count++;
            if (existing.sampleGroupIds.length < 5) {
              existing.sampleGroupIds.push(groupId);
            }
          } else {
            clusterMap.set(clusterKey, {
              normalizedMessage: normalized,
              sampleMessage: message,
              sampleStack: stack,
              count: 1,
              pipelineName,
              queueName,
              sampleGroupIds: [groupId],
            });
          }
        }
      } while (cursor !== "0");
    }

    const clusters = Array.from(clusterMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return { totalBlocked, clusters };
  }

  // ── Actions ─────────────────────────────────────────────────────

  async unblockGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await unblockScript.run(
      this.redis,
      9,
      `${prefix}blocked`,
      `${prefix}group:${params.groupId}:active`,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}group:${params.groupId}:error`,
      `${prefix}group:${params.groupId}:strikes`,
      `${prefix}group:${params.groupId}:attempt`,
      `${prefix}group:${params.groupId}:failstreak`,
      params.groupId,
      String(Date.now()),
    );
    return { wasBlocked: result === 1 };
  }

  async unblockAll(params: {
    queueName: string;
  }): Promise<{ unblockedCount: number }> {
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let unblockedCount = 0;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        blockedKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      const argsByIndex = members.map((groupId) => [
        `${prefix}blocked`,
        `${prefix}group:${groupId}:active`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        `${prefix}group:${groupId}:strikes`,
        `${prefix}group:${groupId}:attempt`,
        `${prefix}group:${groupId}:failstreak`,
        groupId,
        String(Date.now()),
      ]);
      for (const args of argsByIndex) {
        unblockScript.queue(pipeline, 9, ...args);
      }
      const results = await execWithNoScriptRecovery(pipeline, (index) =>
        unblockScript.run(this.redis, 9, ...argsByIndex[index]!),
      );
      if (results) {
        for (const [err, result] of results) {
          if (!err && result === 1) unblockedCount++;
        }
      }
    } while (cursor !== "0");

    return { unblockedCount };
  }

  async drainGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await drainGroupScript.run(
      this.redis,
      11,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}group:${params.groupId}:data`,
      `${prefix}group:${params.groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      `${prefix}group:${params.groupId}:error`,
      `${prefix}stats:total-pending`,
      `${prefix}group:${params.groupId}:strikes`,
      `${prefix}group:${params.groupId}:attempt`,
      `${prefix}group:${params.groupId}:failstreak`,
      params.groupId,
    );
    return { jobsRemoved: Number(result) };
  }

  async pausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void> {
    await this.redis.sadd(`${params.queueName}:gq:paused-jobs`, params.key);
  }

  async unpausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void> {
    await this.redis.srem(`${params.queueName}:gq:paused-jobs`, params.key);
    await this.redis.lpush(`${params.queueName}:gq:signal`, "1");
  }

  async retryBlocked(params: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.unblockGroup({
      queueName: params.queueName,
      groupId: params.groupId,
    });
  }

  async listPausedKeys(params: { queueName: string }): Promise<string[]> {
    return this.redis.smembers(`${params.queueName}:gq:paused-jobs`);
  }

  // Tenant pause: encoded as a special "tenant:<id>" entry in the same
  // paused-jobs SET that DISPATCH_BATCH_LUA already consults. The Lua dispatcher
  // extracts the tenantId from each groupId (everything before the first
  // "/") and checks SISMEMBER for "tenant:<id>". Added post-2026-05-11
  // incident so an operator can halt ALL processing for a runaway tenant
  // without touching pipeline keys. See specs/queue-pausing/.
  static readonly TENANT_PAUSE_PREFIX = "tenant:";

  async pauseTenant(params: {
    queueName: string;
    tenantId: string;
  }): Promise<void> {
    await this.redis.sadd(
      `${params.queueName}:gq:paused-jobs`,
      `${QueueRedisRepository.TENANT_PAUSE_PREFIX}${params.tenantId}`,
    );
  }

  async unpauseTenant(params: {
    queueName: string;
    tenantId: string;
  }): Promise<void> {
    await this.redis.srem(
      `${params.queueName}:gq:paused-jobs`,
      `${QueueRedisRepository.TENANT_PAUSE_PREFIX}${params.tenantId}`,
    );
    // Kick the dispatcher loop so paused work resumes within the next scan.
    await this.redis.lpush(`${params.queueName}:gq:signal`, "1");
  }

  async listPausedTenants(params: { queueName: string }): Promise<string[]> {
    const all = await this.redis.smembers(`${params.queueName}:gq:paused-jobs`);
    const prefix = QueueRedisRepository.TENANT_PAUSE_PREFIX;
    return all
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  // Bulk-drain every group whose ID starts with "<tenantId>/" for the given
  // queue, optionally narrowed by a substring filter on the groupId.
  // Returns the total group count and total job count drained.
  // Added post-2026-05-11 incident — clicking 500K Drain buttons by hand
  // wasn't feasible.
  //
  // `groupIdContains`: optional plain-text fragment that the groupId
  // must contain in addition to starting with `<tenantId>/`. Use this to
  // scope a drain to part of a tenant's groups — for example:
  //   - "/fold/traceSummary/" → drop only that fold's groups
  //   - "/reactor/customEvaluationSync/" → drop only this reactor's groups
  //   - "/map/spanStorage/" → drop only the span-storage map groups
  // Honest substring semantics (matches the operator's mental model of
  // what they see in the Groups table): no fancy resolution to pipeline
  // names — those live in job data which would require an HGET per group
  // and dominate the latency. Document the groupId shape so operators
  // know what to type.
  //
  // Performance: ZSCAN pages 1000 groupIds at a time, then ALL matching
  // DRAIN_GROUP_LUA EVALs for that page are issued as a single Redis
  // pipeline. At 500K groups → ~500 page round-trips instead of 500,000
  // sequential ones. The PR-#3970 production drain of 507K groups took
  // 4 min via a similar pipelined approach; the previous one-at-a-time
  // shape would have been ~tens of minutes through TLS+ElastiCache.
  async drainTenant(params: {
    queueName: string;
    tenantId: string;
    groupIdContains?: string;
  }): Promise<{ groupsDrained: number; jobsDrained: number }> {
    const prefix = `${params.queueName}:gq:`;
    const readyKey = `${prefix}ready`;
    const totalPendingKey = `${prefix}stats:total-pending`;
    const tenantPrefix = `${params.tenantId}/`;
    const contains = params.groupIdContains ?? null;

    let cursor = "0";
    let groupsDrained = 0;
    let jobsDrained = 0;
    const SCAN_BATCH = 1000;

    do {
      const [next, members] = await this.redis.zscan(
        readyKey,
        cursor,
        "COUNT",
        SCAN_BATCH,
      );
      cursor = next;

      // members alternates [groupId, score, groupId, score, ...] — collect
      // just the groupIds that match our tenant prefix (and the optional
      // groupIdContains fragment, if set).
      const matched: string[] = [];
      for (let i = 0; i < members.length; i += 2) {
        const groupId = members[i]!;
        if (!groupId.startsWith(tenantPrefix)) continue;
        if (contains && !groupId.includes(contains)) continue;
        matched.push(groupId);
      }
      if (matched.length === 0) continue;

      // Pipeline all the drains for this page into a single network round-trip.
      // Each call is independent; ioredis batches them and returns results in
      // the same order.
      const pipeline = this.redis.pipeline();
      const argsByIndex = matched.map((groupId) => [
        `${prefix}group:${groupId}:jobs`,
        `${prefix}group:${groupId}:data`,
        `${prefix}group:${groupId}:active`,
        readyKey,
        `${prefix}blocked`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        totalPendingKey,
        `${prefix}group:${groupId}:strikes`,
        `${prefix}group:${groupId}:attempt`,
        `${prefix}group:${groupId}:failstreak`,
        groupId,
      ]);
      for (const args of argsByIndex) {
        drainGroupScript.queue(pipeline, 11, ...args);
      }
      const results = await execWithNoScriptRecovery(pipeline, (index) =>
        drainGroupScript.run(this.redis, 11, ...argsByIndex[index]!),
      );
      if (!results) continue;
      for (const [err, value] of results) {
        if (err) continue;
        groupsDrained++;
        jobsDrained += Number(value);
      }
    } while (cursor !== "0");

    return { groupsDrained, jobsDrained };
  }

  // ── DLQ Operations ──────────────────────────────────────────────

  async moveToDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await moveToDlqScript.run(
      this.redis,
      14,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}group:${params.groupId}:data`,
      `${prefix}group:${params.groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      `${prefix}group:${params.groupId}:error`,
      `${prefix}dlq:${params.groupId}:jobs`,
      `${prefix}dlq:${params.groupId}:data`,
      `${prefix}dlq:${params.groupId}:error`,
      `${prefix}dlq`,
      `${prefix}group:${params.groupId}:strikes`,
      `${prefix}group:${params.groupId}:attempt`,
      `${prefix}group:${params.groupId}:failstreak`,
      params.groupId,
      String(DLQ_TTL_SECONDS),
    );
    return { jobsMoved: Number(result) };
  }

  async moveAllBlockedToDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }> {
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let movedCount = 0;
    let jobsMoved = 0;
    const hasFilters = !!params.pipelineFilter || !!params.errorFilter;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        blockedKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const groupsToMove = hasFilters
        ? await this.filterBlockedGroups({
            prefix,
            members,
            pipelineFilter: params.pipelineFilter,
            errorFilter: params.errorFilter,
          })
        : members;

      if (groupsToMove.length === 0) continue;

      const pipeline = this.redis.pipeline();
      const argsByIndex = groupsToMove.map((groupId) => [
        `${prefix}group:${groupId}:jobs`,
        `${prefix}group:${groupId}:data`,
        `${prefix}group:${groupId}:active`,
        `${prefix}ready`,
        `${prefix}blocked`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        `${prefix}dlq:${groupId}:jobs`,
        `${prefix}dlq:${groupId}:data`,
        `${prefix}dlq:${groupId}:error`,
        `${prefix}dlq`,
        `${prefix}group:${groupId}:strikes`,
        `${prefix}group:${groupId}:attempt`,
        `${prefix}group:${groupId}:failstreak`,
        groupId,
        String(DLQ_TTL_SECONDS),
      ]);
      for (const args of argsByIndex) {
        moveToDlqScript.queue(pipeline, 14, ...args);
      }
      const results = await execWithNoScriptRecovery(pipeline, (index) =>
        moveToDlqScript.run(this.redis, 14, ...argsByIndex[index]!),
      );
      if (results) {
        for (const [err, result] of results) {
          if (!err) {
            const moved = Number(result);
            if (moved >= 0) {
              movedCount++;
              jobsMoved += moved;
            }
          }
        }
      }
    } while (cursor !== "0");

    return { movedCount, jobsMoved };
  }

  async replayFromDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await replayFromDlqScript.run(
      this.redis,
      8,
      `${prefix}dlq:${params.groupId}:jobs`,
      `${prefix}dlq:${params.groupId}:data`,
      `${prefix}dlq:${params.groupId}:error`,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}group:${params.groupId}:data`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}dlq`,
      params.groupId,
      String(Date.now()),
    );
    return { jobsReplayed: Number(result) };
  }

  async replayAllFromDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }> {
    const prefix = `${params.queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;
    let replayedCount = 0;
    let jobsReplayed = 0;
    const hasFilters = !!params.pipelineFilter || !!params.errorFilter;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        dlqIndexKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const groupsToReplay = hasFilters
        ? await this.filterDlqGroups({
            prefix,
            members,
            pipelineFilter: params.pipelineFilter,
            errorFilter: params.errorFilter,
          })
        : members;

      if (groupsToReplay.length === 0) continue;

      const pipeline = this.redis.pipeline();
      const argsByIndex = groupsToReplay.map((groupId) => [
        `${prefix}dlq:${groupId}:jobs`,
        `${prefix}dlq:${groupId}:data`,
        `${prefix}dlq:${groupId}:error`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}group:${groupId}:data`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}dlq`,
        groupId,
        String(Date.now()),
      ]);
      for (const args of argsByIndex) {
        replayFromDlqScript.queue(pipeline, 8, ...args);
      }
      const results = await execWithNoScriptRecovery(pipeline, (index) =>
        replayFromDlqScript.run(this.redis, 8, ...argsByIndex[index]!),
      );
      if (results) {
        for (const [err, result] of results) {
          if (!err) {
            const replayed = Number(result);
            if (replayed > 0) {
              replayedCount++;
              jobsReplayed += replayed;
            }
          }
        }
      }
    } while (cursor !== "0");

    return { replayedCount, jobsReplayed };
  }

  // ── Canary Operations ───────────────────────────────────────────

  async canaryRedrive(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }> {
    const count = params.count ?? 5;
    const prefix = `${params.queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;

    // Raw SCARD on purpose: this samples the index to redrive, it does not
    // report a count to an operator. An expired member sampled here is SREMed by
    // REPLAY_FROM_DLQ_LUA anyway (and reported as not redriven, which it wasn't).
    // The healing sweep the READ paths use is SWEEP_DLQ_INDEX_LUA.
    const dlqSize = await this.redis.scard(dlqIndexKey);
    if (dlqSize === 0) return { redrivenCount: 0, groupIds: [] };

    const candidates = await this.redis.srandmember(
      dlqIndexKey,
      Math.min(count * 3, dlqSize),
    );
    if (!candidates || candidates.length === 0)
      return { redrivenCount: 0, groupIds: [] };

    let groupsToRedrive = candidates.filter((id): id is string => id !== null);

    if (params.pipelineFilter) {
      groupsToRedrive = await this.filterByPipelineName({
        prefix,
        members: groupsToRedrive,
        pipelineFilter: params.pipelineFilter,
        keyPrefix: "dlq",
      });
    }

    groupsToRedrive = groupsToRedrive.slice(0, count);
    if (groupsToRedrive.length === 0) return { redrivenCount: 0, groupIds: [] };

    const pipeline = this.redis.pipeline();
    const argsByIndex = groupsToRedrive.map((groupId) => [
      `${prefix}dlq:${groupId}:jobs`,
      `${prefix}dlq:${groupId}:data`,
      `${prefix}dlq:${groupId}:error`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}group:${groupId}:data`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}dlq`,
      groupId,
      String(Date.now()),
    ]);
    for (const args of argsByIndex) {
      replayFromDlqScript.queue(pipeline, 8, ...args);
    }
    const results = await execWithNoScriptRecovery(pipeline, (index) =>
      replayFromDlqScript.run(this.redis, 8, ...argsByIndex[index]!),
    );

    let redrivenCount = 0;
    const redrivenIds: string[] = [];
    if (results) {
      for (let i = 0; i < results.length; i++) {
        const [err, result] = results[i]!;
        if (!err && Number(result) > 0) {
          redrivenCount++;
          redrivenIds.push(groupsToRedrive[i]!);
        }
      }
    }

    return { redrivenCount, groupIds: redrivenIds };
  }

  async canaryUnblock(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }> {
    const count = params.count ?? 5;
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;

    const candidates = await this.redis.srandmember(blockedKey, count * 3);
    if (!candidates || candidates.length === 0)
      return { unblockedCount: 0, groupIds: [] };

    let groupsToUnblock = candidates.filter((id): id is string => id !== null);

    if (params.pipelineFilter) {
      groupsToUnblock = await this.filterByPipelineName({
        prefix,
        members: groupsToUnblock,
        pipelineFilter: params.pipelineFilter,
        keyPrefix: "group",
      });
    }

    groupsToUnblock = groupsToUnblock.slice(0, count);
    if (groupsToUnblock.length === 0)
      return { unblockedCount: 0, groupIds: [] };

    const unblockPipeline = this.redis.pipeline();
    const argsByIndex = groupsToUnblock.map((groupId) => [
      `${prefix}blocked`,
      `${prefix}group:${groupId}:active`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}group:${groupId}:error`,
      `${prefix}group:${groupId}:strikes`,
      `${prefix}group:${groupId}:attempt`,
      `${prefix}group:${groupId}:failstreak`,
      groupId,
      String(Date.now()),
    ]);
    for (const args of argsByIndex) {
      unblockScript.queue(unblockPipeline, 9, ...args);
    }
    const results = await execWithNoScriptRecovery(unblockPipeline, (index) =>
      unblockScript.run(this.redis, 9, ...argsByIndex[index]!),
    );

    let unblockedCount = 0;
    const unblockedIds: string[] = [];
    if (results) {
      for (let i = 0; i < results.length; i++) {
        const [err, result] = results[i]!;
        if (!err && result === 1) {
          unblockedCount++;
          unblockedIds.push(groupsToUnblock[i]!);
        }
      }
    }

    return { unblockedCount, groupIds: unblockedIds };
  }

  // ── DLQ Listing ─────────────────────────────────────────────────

  /**
   * Page through the DLQ index, healing it as it goes: every SSCAN page is
   * handed to {@link SWEEP_DLQ_INDEX_LUA}, which removes the members whose
   * dead-letter has expired and returns the rest. Yields one page of live group
   * ids at a time; never yields an empty page.
   *
   * Both DLQ readers go through here — the `dlqCount` gauge and
   * {@link listDlqGroups} — so the badge and the page can never disagree about
   * what is in the dead-letter, and the sweep has exactly one home.
   *
   * SSCAN guarantees only that a member present for the whole scan is returned
   * AT LEAST once, so `seen` deduplicates before a page is checked. Without it a
   * set resized mid-scan could count one dead-letter twice, list it twice, and
   * re-check members already swept.
   *
   * Cost: one EVALSHA per page where `dlqCount` used to be a single SCARD. The
   * liveness check runs inside Redis, so a page is one round trip no matter how
   * many members it holds — but that round trip is not free work: per
   * {@link SWEEP_DLQ_INDEX_LUA}, the script runs a `ZCARD` and an `HLEN` per
   * member (2 × page size) inside Redis's single-threaded main loop before
   * returning. The sweep shrinks its own input — after the first pass over a
   * queue the index holds only real dead-letters again.
   */
  private async *scanLiveDlqGroupIds(params: {
    prefix: string;
  }): AsyncGenerator<string[]> {
    const dlqIndexKey = `${params.prefix}dlq`;
    const seen = new Set<string>();

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        dlqIndexKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      const fresh = members.filter((groupId) => !seen.has(groupId));
      for (const groupId of fresh) seen.add(groupId);
      if (fresh.length === 0) continue;

      const live = (await sweepDlqIndexScript.run(
        this.redis,
        1,
        dlqIndexKey,
        params.prefix,
        ...fresh,
      )) as string[] | null;

      if (live && live.length > 0) yield live;
    } while (cursor !== "0");
  }

  /**
   * How many groups the dead-letter actually still holds — the figure behind the
   * ops nav badge and the dashboard DLQ tile.
   *
   * A raw `SCARD` of the index counted groups whose payload expired days ago,
   * which made the badge monotonically increasing: once anything had been
   * dead-lettered and left to expire, it never read zero again. See
   * {@link SWEEP_DLQ_INDEX_LUA}.
   *
   * The metrics collector calls this every 2s. The sweep only removes members
   * whose dead-letter has already expired — it does nothing for a member that
   * is still live, so a live member is re-walked in full on every single call.
   * Steady-state cost is therefore O(live members) per tick per queue, not
   * something that shrinks after a first pass: a queue whose DLQ fills
   * automatically per job under never-reused group ids (see "WHY THIS EXISTS"
   * above) can carry a large, persistently live backlog, and this call pays
   * the full walk for it every 2s for as long as that backlog stays live.
   * `collect()` is single-flighted (`isCollecting`), so a slow pass skips a
   * tick rather than stacking up — that bounds concurrency, not the size or
   * cost of any single pass.
   */
  private async countLiveDlqGroups(params: {
    prefix: string;
  }): Promise<number> {
    let count = 0;
    for await (const page of this.scanLiveDlqGroupIds({
      prefix: params.prefix,
    })) {
      count += page.length;
    }
    return count;
  }

  async listDlqGroups(params: { queueName: string }): Promise<DlqGroupInfo[]> {
    const prefix = `${params.queueName}:gq:`;
    const groups: DlqGroupInfo[] = [];

    // Live members only: an index member whose dead-letter has expired is swept
    // by the scan and never becomes a row, so the page stops listing — and stops
    // paying three pipelined commands for — groups there is nothing left to act
    // on. The ZCARD below re-reads what the sweep already checked: one command
    // per LIVE member, paid once per queue on every tick of the ops DLQ card's
    // 10s poll (DlqCard.tsx's `refetchInterval`, fanned out serially over every
    // discovered queue by `getAllDlqGroups` in queue.service.ts) — not a
    // one-off operator page load. Accepted because this endpoint sits behind
    // `opsViewPermission`: load scales with how many ops tabs are open, not
    // with tenant traffic, and the extra read is one already-scoped command
    // per live member, not another index scan — the same scan contract the 2s
    // `dlqCount` collector shares unchanged.
    for await (const members of this.scanLiveDlqGroupIds({ prefix })) {
      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.hgetall(`${prefix}dlq:${groupId}:error`);
        pipeline.zcard(`${prefix}dlq:${groupId}:jobs`);
        pipeline.zrange(`${prefix}dlq:${groupId}:jobs`, 0, 0);
      }
      const results = await pipeline.exec();

      const dataPipeline = this.redis.pipeline();
      const dataRequests: { groupId: string; idx: number }[] = [];
      for (let i = 0; i < members.length; i++) {
        const jobArr = (results?.[i * 3 + 2]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          dataPipeline.hget(`${prefix}dlq:${members[i]!}:data`, jobArr[0]);
          dataRequests.push({ groupId: members[i]!, idx: i });
        }
      }
      const dataResults =
        dataRequests.length > 0 ? await dataPipeline.exec() : [];

      const groupPipelines = new Map<string, string>();
      for (let j = 0; j < dataRequests.length; j++) {
        const raw = dataResults?.[j]?.[1] as string | null;
        if (raw) {
          const pipelineName = readJobRoutingMeta(raw).pipelineName;
          if (pipelineName) {
            groupPipelines.set(dataRequests[j]!.groupId, pipelineName);
          }
        }
      }

      for (let i = 0; i < members.length; i++) {
        const groupId = members[i]!;
        const errorHash = results?.[i * 3]?.[1] as Record<
          string,
          string
        > | null;
        const jobCount = (results?.[i * 3 + 1]?.[1] as number) ?? 0;

        groups.push({
          groupId,
          error: errorHash?.message ?? null,
          errorStack: errorHash?.stack ?? null,
          pipelineName: groupPipelines.get(groupId) ?? null,
          jobCount,
          movedAt: errorHash?.timestamp
            ? parseFloat(errorHash.timestamp)
            : null,
        });
      }
    }

    groups.sort((a, b) => (b.movedAt ?? 0) - (a.movedAt ?? 0));
    return groups;
  }

  // ── Preview ─────────────────────────────────────────────────────

  async drainAllBlockedPreview(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<DrainPreview> {
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let totalAffected = 0;
    const pipelineCounts = new Map<string, number>();
    const errorCounts = new Map<string, number>();

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        blockedKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.hgetall(`${prefix}group:${groupId}:error`);
        pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
      }
      const results = await pipeline.exec();

      const jobDataPipeline = this.redis.pipeline();
      const jobDataRequests: { groupId: string }[] = [];
      for (let i = 0; i < members.length; i++) {
        const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          jobDataPipeline.hget(`${prefix}group:${members[i]!}:data`, jobArr[0]);
          jobDataRequests.push({ groupId: members[i]! });
        }
      }
      const jobDataResults =
        jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

      const groupPipelines = new Map<string, string>();
      for (let j = 0; j < jobDataRequests.length; j++) {
        const raw = jobDataResults?.[j]?.[1] as string | null;
        if (raw) {
          const pipelineName = readJobRoutingMeta(raw).pipelineName;
          if (pipelineName) {
            groupPipelines.set(jobDataRequests[j]!.groupId, pipelineName);
          }
        }
      }

      for (let i = 0; i < members.length; i++) {
        const groupId = members[i]!;
        const errorHash = results?.[i * 2]?.[1] as Record<
          string,
          string
        > | null;
        const msg = errorHash?.message ?? "Unknown error";
        const pName = groupPipelines.get(groupId) ?? "unknown";

        if (
          params.errorFilter &&
          !msg.toLowerCase().includes(params.errorFilter.toLowerCase())
        )
          continue;
        if (params.pipelineFilter && pName !== params.pipelineFilter) continue;

        totalAffected++;
        pipelineCounts.set(pName, (pipelineCounts.get(pName) ?? 0) + 1);

        const normalizedMsg = normalizeErrorMessage(msg);
        errorCounts.set(
          normalizedMsg,
          (errorCounts.get(normalizedMsg) ?? 0) + 1,
        );
      }
    } while (cursor !== "0");

    return {
      totalAffected,
      byPipeline: Array.from(pipelineCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      byError: Array.from(errorCounts.entries())
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ── Counter Reconciliation ──────────────────────────────────────

  /**
   * Reconcile the total-pending counter against the live ground truth.
   *
   * WHY: The `total-pending` counter is incremented at dispatch (INCR) and
   * decremented at complete (DECR), but several paths leak without a DECR:
   *   - worker death after dispatch but before complete
   *   - the 6-hour `:jobs` TTL reaping a group without a DECR
   *   - MOVE_TO_DLQ_LUA which deletes `:jobs` without decrementing the counter
   * Over time the counter drifts upward. Since it is read-only ops metadata
   * (drives the dashboard "pending" tile), overwriting it with the ZCARD-derived
   * ground truth is safe and does not affect dispatch correctness.
   *
   * The ground truth is the authoritative Σ ZCARD over ALL `group:*:jobs` keys
   * for this queue — intentionally the complete count, distinct from the top-N
   * sampled per-group dashboard tile.
   *
   * A small re-drift from concurrent dispatch/complete INCR/DECR during the SET
   * window is acceptable and self-corrects on the next scheduled cycle.
   *
   * The single-flight window default is shorter than the collector's reconcile
   * interval so each scheduled cycle can acquire the marker while still guarding
   * against multi-pod overlap.
   *
   * The reconcile is single-flighted per `singleFlightWindowMs` so only one
   * pod recomputes per window. It is intentionally off the hot dispatch path.
   *
   * See issue #4683.
   */
  async reconcileTotalPending(
    queueName: string,
    singleFlightWindowMs = 55_000,
  ): Promise<ReconcileResult | null> {
    const prefix = `${queueName}:gq:`;
    const counterKey = `${prefix}stats:total-pending`;
    const markerKey = `${prefix}stats:pending-recon-ts`;

    // Single-flight gate: only one pod/cycle runs per window.
    const acquired = await this.redis.set(
      markerKey,
      String(Date.now()),
      "PX",
      singleFlightWindowMs,
      "NX",
    );
    if (acquired !== "OK") return null;

    // Read the pre-reconcile counter.
    const raw = await this.redis.get(counterKey);
    const counter = Math.max(0, parseInt(raw ?? "0", 10) || 0);

    // Enumerate all group-jobs zsets via SCAN.
    const jobsKeys: string[] = [];
    const matchPattern = `${prefix}group:*:jobs`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        matchPattern,
        "COUNT",
        PENDING_RECONCILE_SCAN_COUNT,
      );
      cursor = nextCursor;
      for (const key of keys) {
        jobsKeys.push(key);
      }
    } while (cursor !== "0");

    // Pipeline ZCARD for every collected key and sum the results.
    // If ANY pipeline entry errors, abort — a flaky ZCARD must never write
    // a partial under-count as ground truth; the next cycle retries.
    let groundTruth = 0;
    if (jobsKeys.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const key of jobsKeys) {
        pipeline.zcard(key);
      }
      const results = await pipeline.exec();
      if (results) {
        for (const [err, val] of results) {
          if (err) {
            logger.warn(
              { error: err },
              "ZCARD pipeline error during pending reconcile — aborting to avoid under-count",
            );
            return null;
          }
          groundTruth += Number(val) || 0;
        }
      }
    }

    const drift = counter - groundTruth;

    // Overwrite the counter with the ground truth.
    await this.redis.set(counterKey, String(groundTruth));

    return { counter, groundTruth, drift };
  }

  // ── Private Filter Helpers ──────────────────────────────────────

  private async filterByPipelineName(params: {
    prefix: string;
    members: string[];
    pipelineFilter: string;
    keyPrefix: "group" | "dlq";
  }): Promise<string[]> {
    const jobIdPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      jobIdPipeline.zrange(
        `${params.prefix}${params.keyPrefix}:${groupId}:jobs`,
        0,
        0,
      );
    }
    const jobIdResults = await jobIdPipeline.exec();

    const dataPipeline = this.redis.pipeline();
    const dataRequests: { groupId: string }[] = [];
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (jobIdResults?.[i]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        dataPipeline.hget(
          `${params.prefix}${params.keyPrefix}:${params.members[i]!}:data`,
          jobArr[0],
        );
        dataRequests.push({ groupId: params.members[i]! });
      }
    }
    const dataResults =
      dataRequests.length > 0 ? await dataPipeline.exec() : [];

    const matchingGroups = new Set<string>();
    for (let i = 0; i < dataRequests.length; i++) {
      const raw = dataResults?.[i]?.[1] as string | null;
      if (raw) {
        if (readJobRoutingMeta(raw).pipelineName === params.pipelineFilter) {
          matchingGroups.add(dataRequests[i]!.groupId);
        }
      }
    }
    return params.members.filter((id) => matchingGroups.has(id));
  }

  private async filterBlockedGroups(params: {
    prefix: string;
    members: string[];
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<string[]> {
    const filterPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      filterPipeline.hgetall(`${params.prefix}group:${groupId}:error`);
      filterPipeline.zrange(`${params.prefix}group:${groupId}:jobs`, 0, 0);
    }
    const filterResults = await filterPipeline.exec();

    const jobDataPipeline = this.redis.pipeline();
    const jobDataMap = new Map<string, number>();
    let jobFetchIdx = 0;
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (filterResults?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        jobDataPipeline.hget(
          `${params.prefix}group:${params.members[i]!}:data`,
          jobArr[0],
        );
        jobDataMap.set(params.members[i]!, jobFetchIdx++);
      }
    }
    const jobDataResults = jobFetchIdx > 0 ? await jobDataPipeline.exec() : [];

    return params.members.filter((groupId, i) => {
      if (params.errorFilter) {
        const errorHash = filterResults?.[i * 2]?.[1] as Record<
          string,
          string
        > | null;
        const msg = errorHash?.message ?? "";
        if (!msg.toLowerCase().includes(params.errorFilter.toLowerCase()))
          return false;
      }
      if (params.pipelineFilter) {
        const fetchIdx = jobDataMap.get(groupId);
        if (fetchIdx !== undefined) {
          const raw = jobDataResults?.[fetchIdx]?.[1] as string | null;
          if (raw) {
            if (readJobRoutingMeta(raw).pipelineName !== params.pipelineFilter)
              return false;
          } else return false;
        } else return false;
      }
      return true;
    });
  }

  private async filterDlqGroups(params: {
    prefix: string;
    members: string[];
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<string[]> {
    const filterPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      filterPipeline.hgetall(`${params.prefix}dlq:${groupId}:error`);
      filterPipeline.zrange(`${params.prefix}dlq:${groupId}:jobs`, 0, 0);
    }
    const filterResults = await filterPipeline.exec();

    const jobDataPipeline = this.redis.pipeline();
    const jobDataMap = new Map<string, number>();
    let jobFetchIdx = 0;
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (filterResults?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        jobDataPipeline.hget(
          `${params.prefix}dlq:${params.members[i]!}:data`,
          jobArr[0],
        );
        jobDataMap.set(params.members[i]!, jobFetchIdx++);
      }
    }
    const jobDataResults = jobFetchIdx > 0 ? await jobDataPipeline.exec() : [];

    return params.members.filter((groupId, i) => {
      if (params.errorFilter) {
        const errorHash = filterResults?.[i * 2]?.[1] as Record<
          string,
          string
        > | null;
        const msg = errorHash?.message ?? "";
        if (!msg.toLowerCase().includes(params.errorFilter.toLowerCase()))
          return false;
      }
      if (params.pipelineFilter) {
        const fetchIdx = jobDataMap.get(groupId);
        if (fetchIdx !== undefined) {
          const raw = jobDataResults?.[fetchIdx]?.[1] as string | null;
          if (raw) {
            if (readJobRoutingMeta(raw).pipelineName !== params.pipelineFilter)
              return false;
          } else return false;
        } else return false;
      }
      return true;
    });
  }
}
