import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { ChainableCommander, Cluster } from "ioredis";
import {
  CachedLuaScript,
  isNoScriptResult,
} from "~/server/event-sourcing/queues/groupQueue/cachedLuaScript";
import {
  decodeJobEnvelope,
  isEnvelope,
  readEnvelopeDescriptor,
  readJobRoutingMeta,
  splitEnvelope,
} from "~/server/event-sourcing/queues/groupQueue/jobEnvelope";
import { legacyStagedJobAttempt } from "~/server/event-sourcing/queues/groupQueue/legacyStagedJobAttempt";
import { RedisJobBlobStore } from "~/server/event-sourcing/queues/groupQueue/redisJobBlobStore";
import {
  GROUP_QUEUE_REGISTRY_KEY,
  PARK_HELPER_LUA,
  PENDING_INDEX_HELPER_LUA,
  pendingDriftKey,
  pendingGroupsKey,
  TTL_HELPER_LUA,
} from "~/server/event-sourcing/queues/groupQueue/scripts";
import { TieredBlobStore } from "~/server/event-sourcing/queues/groupQueue/tieredBlobStore";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
import { normalizeErrorMessage } from "../normalize-error-message";
import type { ParkedTenant } from "../snapshot/snapshot.types";
import type {
  ErrorCluster,
  GroupInfo,
  ParkedGroupInfo,
  QueueInfo,
} from "../types";
import type {
  BlockedSummary,
  DlqGroupInfo,
  DrainPreview,
  JobEntry,
  ParkedTenantsPage,
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
-- The poison guard's per-group state is the claim marker; the legacy strikes
-- counter above is cleared alongside it so a group blocked by the old guard
-- still unblocks cleanly while both are in the fleet. Derived from strikesKey
-- (":strikes" is 8 chars) so the key arity stays fixed.
redis.call("DEL", string.sub(strikesKey, 1, #strikesKey - 8) .. ":claim")
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
-- The poison guard's per-group state is the claim marker; the legacy strikes
-- counter above is cleared alongside it so a group blocked by the old guard
-- still unblocks cleanly while both are in the fleet. Derived from strikesKey
-- (":strikes" is 8 chars) so the key arity stays fixed.
redis.call("DEL", string.sub(strikesKey, 1, #strikesKey - 8) .. ":claim")
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
-- The poison guard's per-group state is the claim marker; the legacy strikes
-- counter above is cleared alongside it so a group blocked by the old guard
-- still unblocks cleanly while both are in the fleet. Derived from strikesKey
-- (":strikes" is 8 chars) so the key arity stays fixed.
redis.call("DEL", string.sub(strikesKey, 1, #strikesKey - 8) .. ":claim")
redis.call("DEL", attemptKey)
redis.call("DEL", failStreakKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

const REPLAY_FROM_DLQ_LUA =
  PENDING_INDEX_HELPER_LUA +
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
  -- Replaying puts jobs back on the live group, so it is a pending-index write
  -- like any other stage. Same atomic step as the ZADD above.
  gqMarkPending(parkKeyPrefixOf(readyKey), groupId)
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

// Discard a DLQ group: the operator marking its jobs never-to-run
// (specs/ops/dead-letter-recovery.feature). The Redis substrate already
// forgets DLQ entries at their TTL, so the durable mark lives in the audit
// row the service writes — this script's job is to remove the group and
// hand back what that audit row must record: the job count and last error.
const DISCARD_FROM_DLQ_LUA = `
local dlqJobsKey   = KEYS[1]
local dlqDataKey   = KEYS[2]
local dlqErrorKey  = KEYS[3]
local dlqIndexKey  = KEYS[4]
local groupId      = ARGV[1]

local count = redis.call("ZCARD", dlqJobsKey)
local lastError = redis.call("HGET", dlqErrorKey, "message")

redis.call("DEL", dlqJobsKey)
redis.call("DEL", dlqDataKey)
redis.call("DEL", dlqErrorKey)
redis.call("SREM", dlqIndexKey, groupId)

return {count, lastError or ""}
`;

// Re-arm (or drop, when the requested TTL is not positive) the pending-reconcile
// single-flight marker, but only while the caller still holds it. A marker that
// lapsed mid-pass may already have been re-acquired by another instance, and
// extending or dropping that one would put two reconcile passes on the same
// counter at once — exactly what the marker exists to prevent. GET-then-act is
// safe only inside a script, where nothing else can run in between.
const RECONCILE_MARKER_TTL_LUA = `
local markerKey  = KEYS[1]
local holderToken = ARGV[1]
local ttlMs       = tonumber(ARGV[2])

if redis.call("GET", markerKey) ~= holderToken then return 0 end
if ttlMs <= 0 then return redis.call("DEL", markerKey) end
return redis.call("PEXPIRE", markerKey, ttlMs)
`;

// Write the reconciled counter only while this pass still holds the marker.
//
// Losing the marker means another pass has started and may already have written
// a fresher value; a late write from the old pass would put a stale count back.
// The check and the write have to be one step, so a marker lost between them
// cannot leave the stale write to land anyway.
/**
 * Exported so the fence can be tested against the real script and a real Redis.
 * The reconcile unit suite runs against a fake that models these semantics, and
 * a model cannot fail when the thing it models changes.
 */
export const RECONCILE_WRITE_LUA = `
local markerKey  = KEYS[1]
local counterKey = KEYS[2]
local driftKey   = KEYS[3]
local holderToken = ARGV[1]
local groundTruth = ARGV[2]
local drift       = ARGV[3]
local driftTtlMs  = ARGV[4]

if redis.call("GET", markerKey) ~= holderToken then return 0 end
redis.call("SET", counterKey, groundTruth)
redis.call("SET", driftKey, drift, "PX", driftTtlMs)
return 1
`;

// Drop a group from the pending index, but only while its jobs zset is still
// empty. The reconcile decides what to prune from a ZCARD it read earlier, and a
// group can be staged again in between; re-reading inside the script is what
// stops a live group being dropped on the strength of a stale observation.
// Losing a group from this index would hide its jobs from every later pass.
const PENDING_INDEX_PRUNE_LUA = `
local indexKey = KEYS[1]
local pruned = 0
for i = 1, #ARGV, 2 do
  local groupId = ARGV[i]
  local jobsKey = ARGV[i + 1]
  if redis.call("ZCARD", jobsKey) == 0 then
    pruned = pruned + redis.call("SREM", indexKey, groupId)
  end
end
return pruned
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
const discardFromDlqScript = new CachedLuaScript(DISCARD_FROM_DLQ_LUA);
const reconcileMarkerTtlScript = new CachedLuaScript(RECONCILE_MARKER_TTL_LUA);
const reconcileWriteScript = new CachedLuaScript(RECONCILE_WRITE_LUA);
const pendingIndexPruneScript = new CachedLuaScript(PENDING_INDEX_PRUNE_LUA);

// ── Constants ────────────────────────────────────────────────────────

const SUMMARY_TOP_N = 200;
const DLQ_TTL_SECONDS = 604800;
const SSCAN_BATCH = 500;

/** Page size for the index reads that enumerate a queue's groups. */
const PENDING_RECONCILE_PAGE_SIZE = 1000;

/** Split an explicit id list into pipeline-sized batches. */
function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** Number of ZCARDs sent per pipeline round trip during a reconcile pass. */
const PENDING_RECONCILE_ZCARD_BATCH = 1000;

/**
 * How long the single-flight marker survives without a refresh.
 *
 * The marker is re-armed to this after every index page and every ZCARD batch,
 * so a pass holds it for as long as it runs no matter how long that is — both
 * phases refresh, since collection is itself a paging walk and on a large queue
 * can outlast a lease on its own. It bounds the other direction instead: an
 * instance that dies mid-pass strands the marker for at most this long before
 * another instance may take over.
 */
const PENDING_RECONCILE_LEASE_MS = 30_000;

/**
 * How long a published drift figure stays readable.
 *
 * Three reconcile cycles (the collector runs one per minute). The value has to
 * outlive the gap between passes or every instance would read null for most of
 * the minute, and it has to expire or a queue whose reconcile has stopped
 * entirely would pin its last drift on the dashboard forever. Expiring is the
 * safer end of that trade: a missing figure reads as "unknown" and drops out of
 * the aggregate, where a stale one reads as a live measurement.
 */
const PENDING_DRIFT_TTL_MS = 180_000;

/**
 * How long the keyspace sweep waits once it has nothing left to adopt.
 *
 * At that point every group is in the pending index and the sweep is a backstop
 * against a writer nobody noticed was missing, so it can be rare. While it is
 * still adopting — through a rollout, or on a queue that predates the index — it
 * runs every pass instead, which is what this reconcile cost before the index
 * existed. See {@link QueueRedisRepository.sweepKeyspaceForGroups}.
 */
const PENDING_RECONCILE_SWEEP_BACKSTOP_MS = 60 * 60 * 1000;

/** Suffix of the key holding when the next keyspace sweep is due. */
const SWEEP_DUE_KEY_SUFFIX = "stats:pending-recon-sweep-due";

function isClusterClient(client: IORedis | Cluster): client is Cluster {
  return typeof (client as Cluster).nodes === "function";
}

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

/**
 * The head job's retry count, ADR-080 first: the group's retry chain lives in
 * the `group:{id}:attempt` key (TTL'd past the max backoff), written on every
 * restage. The `/r/<n>` job-id suffix stopped being written at ADR-080, so
 * parsing only the id read "—" for every retrying group — during the
 * 2026-08-05 backup it made day-old retry loops look never-attempted. The
 * legacy id parse stays as the last-resort fallback for jobs staged before an
 * ADR-080 deploy.
 */
function resolveRetryCount({
  attemptRaw,
  jobId,
}: {
  attemptRaw: string | null;
  jobId: string | null;
}): number | null {
  const attempt = attemptRaw === null ? Number.NaN : parseInt(attemptRaw, 10);
  if (Number.isInteger(attempt) && attempt > 0) return attempt;
  if (!jobId) return null;
  const legacy = legacyStagedJobAttempt(jobId);
  return legacy > 0 ? legacy : null;
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
    const dlqKey = `${prefix}dlq`;
    const totalPendingKey = `${prefix}stats:total-pending`;
    const parkedTenantsKey = `${prefix}parked-tenants`;

    // Sample BOTH ends of the ready zset. The zset is scored by dispatch
    // eligibility, so its ends hold the two distinct stuck-group classes: the
    // high end is the most-deferred groups (in-flight, retry backoff — where a
    // failing group hides between attempts), the low end is the most-eligible
    // ones (an old due head the dispatcher is starving). A single-ended
    // ZREVRANGE sampled only the deferred end, so an aged eligible backlog past
    // `limit` never appeared in the dashboard at all. When the zset fits in
    // `limit` the two ranges coincide and dedup makes this identical to before.
    const [
      readyCount,
      blockedCount,
      dlqCount,
      topReadyMembers,
      bottomReadyMembers,
      totalPendingRaw,
      parkedTenants,
    ] = await Promise.all([
      this.redis.zcard(readyKey),
      this.redis.scard(blockedKey),
      this.redis.scard(dlqKey),
      this.redis.zrevrange(readyKey, offset, offset + limit - 1, "WITHSCORES"),
      this.redis.zrange(readyKey, offset, offset + limit - 1, "WITHSCORES"),
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
    for (const members of [topReadyMembers, bottomReadyMembers]) {
      for (let i = 0; i < members.length; i += 2) {
        const groupId = members[i]!;
        if (readyScores.has(groupId)) continue;
        const score = parseFloat(members[i + 1]!);
        groupIds.push(groupId);
        readyScores.set(groupId, score);
      }
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

    const CMDS_PER_GROUP = 7;
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
      pipeline.get(`${prefix}group:${groupId}:attempt`);
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
      const attemptRaw = (pipelineResults?.[base + 6]?.[1] as string) ?? null;

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
        retryCount: resolveRetryCount({
          attemptRaw,
          jobId: firstJobIds[i]!.jobId,
        }),
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

  /**
   * The payload size to DISPLAY for a staged value: the encoder-recorded
   * `header.s` when present, the stored length for bare JSON, and null when
   * the value cannot say. Deliberately not `readJobPayloadBytes`, whose
   * "unknown is worth the cap" sentinel is a batch-budget rule — rendered on
   * a job card it would read as a 50 MB payload that isn't one.
   */
  private readDisplayPayloadBytes(raw: string): number | null {
    try {
      if (!isEnvelope(raw)) return Buffer.byteLength(raw, "utf8");
      const { header } = splitEnvelope(raw);
      return Number.isSafeInteger(header.s) && (header.s as number) >= 0
        ? (header.s as number)
        : null;
    } catch {
      return null;
    }
  }

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
      jobs.push({
        jobId,
        score,
        data: null,
        payloadBytes: null,
        envelope: null,
      });
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
          if (!raw) return;
          await this.decorateJobFromRaw({
            job: jobs[i]!,
            raw,
            blobs,
            tieredBlobs,
          });
        }),
      );
    }

    return { jobs, total };
  }

  /** Fill one job's envelope descriptor, payload size, and decoded body. */
  private async decorateJobFromRaw({
    job,
    raw,
    blobs,
    tieredBlobs,
  }: {
    job: JobEntry;
    raw: string;
    blobs: RedisJobBlobStore;
    tieredBlobs: TieredBlobStore;
  }): Promise<void> {
    // Storage shape from the header alone — survives a body the decode below
    // cannot read, which is exactly when an operator most wants to know where
    // the body was supposed to be.
    job.envelope = isEnvelope(raw) ? readEnvelopeDescriptor(raw) : null;
    job.payloadBytes = this.readDisplayPayloadBytes(raw);
    try {
      // Ops-dashboard inspection: DO NOT refresh the blob TTL on read
      // (2026-06-24 review). A repeatedly-viewed blocked group would
      // otherwise keep its orphan blobs alive indefinitely. readMode
      // "peek" routes BOTH the GQ1 blobs.get AND the tieredBlobs.get
      // to their peek variants.
      job.data = await decodeJobEnvelope({
        value: raw,
        blobs,
        tieredBlobs,
        readMode: "peek",
      });
    } catch {
      // ignore undecodable values
    }
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

  // ── Parked (tenant soft cap) ────────────────────────────────────

  async enumerateParkedTenants(params: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<ParkedTenantsPage> {
    const rows: ParkedTenant[] = [];
    for (const queueName of params.queueNames) {
      rows.push(...(await this.parkedTenantsForQueue(queueName)));
    }

    rows.sort((a, b) => b.groupCount - a.groupCount);
    return {
      tenants: rows.slice(0, Math.max(0, params.maxTenants)),
      total: rows.length,
    };
  }

  /**
   * One queue's over-cap tenants.
   *
   * The registry holds one entry per OVER-CAP TENANT, not per parked group, so
   * this stays cheap even when parked DEPTH is in the hundreds of thousands —
   * which is exactly the case the dashboard has to explain.
   */
  private async parkedTenantsForQueue(
    queueName: string,
  ): Promise<ParkedTenant[]> {
    const prefix = `${queueName}:gq:`;
    const tenantIds = await this.redis.smembers(`${prefix}parked-tenants`);
    if (tenantIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const tenantId of tenantIds) {
      pipeline.zcard(`${prefix}parked:${tenantId}`);
      pipeline.zrange(`${prefix}parked:${tenantId}`, 0, 0);
    }
    const results = await pipeline.exec();

    const depths = new Map<string, number>();
    const headGroups: Array<{ tenantId: string; groupId: string }> = [];
    for (let i = 0; i < tenantIds.length; i++) {
      const tenantId = tenantIds[i]!;
      const depth = Number(results?.[i * 2]?.[1] ?? 0) || 0;
      if (depth === 0) continue;
      depths.set(tenantId, depth);
      const head = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (head[0]) headGroups.push({ tenantId, groupId: head[0] });
    }

    const ageMs = await this.oldestJobPerTenant({ prefix, headGroups });

    return Array.from(depths, ([tenantId, groupCount]) => ({
      tenantId,
      queueName,
      groupCount,
      oldestParkedMs: ageMs.get(tenantId) ?? null,
    }));
  }

  /**
   * Age comes from each tenant's head parked group's oldest job. The head is
   * the tenant's most dispatch-eligible parked group, and parking preserves the
   * score it held in ready, so this is the closest available answer to "how
   * long has this tenant been waiting" without walking every parked group.
   */
  private async oldestJobPerTenant({
    prefix,
    headGroups,
  }: {
    prefix: string;
    headGroups: Array<{ tenantId: string; groupId: string }>;
  }): Promise<Map<string, number>> {
    const ageMs = new Map<string, number>();
    if (headGroups.length === 0) return ageMs;

    const pipeline = this.redis.pipeline();
    for (const { groupId } of headGroups) {
      pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0, "WITHSCORES");
    }
    const results = await pipeline.exec();

    for (let i = 0; i < headGroups.length; i++) {
      const arr = (results?.[i]?.[1] as string[]) ?? [];
      if (arr.length < 2) continue;
      const ts = parseFloat(arr[1]!);
      if (Number.isFinite(ts)) ageMs.set(headGroups[i]!.tenantId, ts);
    }
    return ageMs;
  }

  async listParkedGroups(params: {
    queueName: string;
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ groups: ParkedGroupInfo[]; total: number }> {
    const prefix = `${params.queueName}:gq:`;
    const parkedKey = `${prefix}parked:${params.tenantId}`;

    const total = await this.redis.zcard(parkedKey);
    if (total === 0) return { groups: [], total: 0 };

    const start = (params.page - 1) * params.pageSize;
    const members = await this.redis.zrange(
      parkedKey,
      start,
      start + params.pageSize - 1,
      "WITHSCORES",
    );

    const scores = new Map<string, number>();
    for (let i = 0; i < members.length; i += 2) {
      scores.set(members[i]!, parseFloat(members[i + 1]!));
    }
    if (scores.size === 0) return { groups: [], total };

    return {
      groups: await this.hydrateParkedGroups({ prefix, scores }),
      total,
    };
  }

  /** Fill in job counts, oldest wait and pipeline name for one page of groups. */
  private async hydrateParkedGroups({
    prefix,
    scores,
  }: {
    prefix: string;
    scores: Map<string, number>;
  }): Promise<ParkedGroupInfo[]> {
    const groupIds = Array.from(scores.keys());

    const pipeline = this.redis.pipeline();
    for (const groupId of groupIds) {
      pipeline.zcard(`${prefix}group:${groupId}:jobs`);
      pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0, "WITHSCORES");
    }
    const results = await pipeline.exec();

    const oldestJobIds = groupIds.map((groupId, i) => ({
      groupId,
      jobId: ((results?.[i * 2 + 1]?.[1] as string[]) ?? [])[0] ?? null,
    }));

    const dataPipeline = this.redis.pipeline();
    for (const { groupId, jobId } of oldestJobIds) {
      if (jobId) dataPipeline.hget(`${prefix}group:${groupId}:data`, jobId);
    }
    const withJob = oldestJobIds.filter((entry) => entry.jobId !== null);
    const dataResults = withJob.length > 0 ? await dataPipeline.exec() : [];

    const pipelineNames = new Map<string, string | null>();
    for (let i = 0; i < withJob.length; i++) {
      const raw = (dataResults?.[i]?.[1] as string) ?? null;
      pipelineNames.set(
        withJob[i]!.groupId,
        raw ? readJobRoutingMeta(raw).pipelineName : null,
      );
    }

    return groupIds.map((groupId, i) => {
      const oldestArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
      return {
        groupId,
        pendingJobs: Number(results?.[i * 2]?.[1] ?? 0) || 0,
        oldestJobMs: oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null,
        score: scores.get(groupId) ?? 0,
        pipelineName: pipelineNames.get(groupId) ?? null,
      };
    });
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
  //   - "/reactor/customEvaluationSync/" → drop only this subscriber's groups
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

  /**
   * Redrive an explicit set of DLQ groups. The list comes from what the
   * operator's filter SHOWED, so acting on ids rather than re-evaluating a
   * filter server-side means the confirmation and the act cover the same
   * groups (specs/ops/dead-letter-recovery.feature).
   */
  async redriveManyFromDlq(params: {
    queueName: string;
    groupIds: string[];
  }): Promise<{ redrivenCount: number; jobsRedriven: number }> {
    const prefix = `${params.queueName}:gq:`;
    let redrivenCount = 0;
    let jobsRedriven = 0;
    for (const batch of chunk(params.groupIds, SSCAN_BATCH)) {
      const pipeline = this.redis.pipeline();
      const argsByIndex = batch.map((groupId) => [
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
              redrivenCount++;
              jobsRedriven += replayed;
            }
          }
        }
      }
    }
    return { redrivenCount, jobsRedriven };
  }

  /**
   * Discard an explicit set of DLQ groups: their jobs never run again. The
   * substrate forgets DLQ entries at their TTL anyway, so the durable record
   * is the audit row the service writes from what this returns — per-group
   * job counts and a sample of the last errors.
   */
  async discardManyFromDlq(params: {
    queueName: string;
    groupIds: string[];
  }): Promise<{
    discardedCount: number;
    jobsDiscarded: number;
    lastErrors: string[];
  }> {
    const prefix = `${params.queueName}:gq:`;
    let discardedCount = 0;
    let jobsDiscarded = 0;
    const lastErrors = new Set<string>();
    for (const batch of chunk(params.groupIds, SSCAN_BATCH)) {
      const pipeline = this.redis.pipeline();
      const argsByIndex = batch.map((groupId) => [
        `${prefix}dlq:${groupId}:jobs`,
        `${prefix}dlq:${groupId}:data`,
        `${prefix}dlq:${groupId}:error`,
        `${prefix}dlq`,
        groupId,
      ]);
      for (const args of argsByIndex) {
        discardFromDlqScript.queue(pipeline, 4, ...args);
      }
      const results = await execWithNoScriptRecovery(pipeline, (index) =>
        discardFromDlqScript.run(this.redis, 4, ...argsByIndex[index]!),
      );
      if (results) {
        for (const [err, result] of results) {
          if (err) continue;
          const [count, lastError] = result as [number, string];
          if (Number(count) > 0) {
            discardedCount++;
            jobsDiscarded += Number(count);
          }
          if (lastError && lastErrors.size < 5) lastErrors.add(lastError);
        }
      }
    }
    return { discardedCount, jobsDiscarded, lastErrors: [...lastErrors] };
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

  async listDlqGroups(params: { queueName: string }): Promise<DlqGroupInfo[]> {
    const prefix = `${params.queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;
    const groups: DlqGroupInfo[] = [];

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
    } while (cursor !== "0");

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
   * The ground truth is the authoritative Σ ZCARD over the `:jobs` zset of every
   * group this queue knows about — intentionally the complete count, distinct
   * from the top-N sampled per-group dashboard tile.
   *
   * A small re-drift from concurrent dispatch/complete INCR/DECR during the SET
   * window is acceptable and self-corrects on the next scheduled cycle.
   *
   * The single-flight window default is shorter than the collector's reconcile
   * interval so each scheduled cycle can acquire the marker while still guarding
   * against multi-pod overlap.
   *
   * The reconcile is single-flighted per `singleFlightWindowMs` so only one
   * pod recomputes per window. The marker is held for the whole pass and only
   * then downgraded to the remainder of the window, so a pass that outlives the
   * window cannot be joined by a second one — the regime where a stacked pass
   * would hurt most is exactly the regime where passes run long. It is
   * intentionally off the hot dispatch path.
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
    const holderToken = randomUUID();
    const startedAtMs = Date.now();

    // Single-flight gate: only one pod/cycle runs per window. The marker is
    // taken on a refreshable lease rather than for the full window so a pod that
    // dies mid-pass cannot wedge the reconcile until the window elapses.
    const acquired = await this.redis.set(
      markerKey,
      holderToken,
      "PX",
      PENDING_RECONCILE_LEASE_MS,
      "NX",
    );
    if (acquired !== "OK") return null;

    try {
      // Read the pre-reconcile counter.
      const raw = await this.redis.get(counterKey);
      const counter = Math.max(0, parseInt(raw ?? "0", 10) || 0);

      // Collection is itself a paging walk, so it re-arms the lease as it goes.
      // Without that a pass on a large queue could spend its whole lease before
      // the first ZCARD batch and lose the marker to another instance mid-pass.
      //
      // Losing it aborts the pass. A pass that no longer holds the marker cannot
      // know whether a newer one has already written, so anything it computed is
      // a candidate for overwriting fresher state with staler state.
      const refreshLease = async (): Promise<boolean> =>
        await this.setReconcileMarkerTtl({
          markerKey,
          holderToken,
          ttlMs: PENDING_RECONCILE_LEASE_MS,
        });

      const groupIds = await this.collectPendingGroupIds({
        prefix,
        refreshLease,
      });
      if (groupIds === null) return null;

      const jobsKeys = Array.from(
        groupIds,
        (groupId) => `${prefix}group:${groupId}:jobs`,
      );

      const summed = await this.sumPendingJobs({ jobsKeys, refreshLease });
      if (summed === null) return null;
      const { groundTruth, emptyJobsKeys } = summed;

      const drift = counter - groundTruth;

      // Fenced write: a pass that lost the marker must not put its count back
      // over a newer pass's. `0` means the marker moved on, so this pass reports
      // nothing rather than a result it did not manage to publish.
      //
      // The drift goes out under the same fence as the counter it describes.
      // Publishing it separately would let a pass write the counter, lose the
      // marker, and still announce a drift for a count it did not land.
      const wrote = await reconcileWriteScript.run(
        this.redis,
        3,
        markerKey,
        counterKey,
        pendingDriftKey(prefix),
        holderToken,
        String(groundTruth),
        String(drift),
        String(PENDING_DRIFT_TTL_MS),
      );
      if (Number(wrote) !== 1) {
        logger.warn(
          { queueName },
          "Pending reconcile lost its single-flight marker before writing — discarding the pass",
        );
        return null;
      }

      await this.prunePendingIndex({ prefix, emptyJobsKeys, refreshLease });

      return { counter, groundTruth, drift };
    } finally {
      // Hand the marker back as the unspent remainder of the window, so the
      // cadence stays one reconcile per window measured from when this pass
      // started. A pass that already outlived the window drops it outright and
      // the next scheduled cycle may run immediately.
      await this.setReconcileMarkerTtl({
        markerKey,
        holderToken,
        ttlMs: singleFlightWindowMs - (Date.now() - startedAtMs),
      });
    }
  }

  async readPublishedPendingDrift(queueNames: string[]): Promise<number> {
    if (queueNames.length === 0) return 0;

    const raw = await this.redis.mget(
      ...queueNames.map((queueName) => pendingDriftKey(`${queueName}:gq:`)),
    );

    let total = 0;
    for (const value of raw) {
      // A key that is absent or unparseable is a queue with no live figure. It
      // contributes nothing either way, so this is hygiene rather than a
      // behaviour: no sum can tell "no drift" apart from "no measurement".
      // Surfacing that difference needs a signal beside the total, which the
      // dashboard does not have a place for yet.
      if (value === null) continue;
      // Whole value or nothing. A lenient parse stops at the first character it
      // cannot use, so "7oops" reads as 7 and "1.5" as 1, and the result lands
      // in the total looking exactly like a real measurement. A value that is
      // only partly a number is not a measurement, so it is skipped like any
      // other unusable one rather than half-believed.
      if (!/^-?\d+$/.test(value)) continue;
      const drift = Number(value);
      if (!Number.isSafeInteger(drift)) continue;
      total += Math.abs(drift);
    }
    return total;
  }

  /**
   * Collect the ids of every group that can be holding a pending job.
   *
   * Deliberately not a keyspace SCAN: SCAN walks every key in the database
   * regardless of MATCH, so the cost of a pass would track the size of the whole
   * Redis instance rather than the number of groups in this queue.
   *
   * The authority is `pending-groups`, written atomically with every job insert
   * (see PENDING_INDEX_HELPER_LUA). It is read as a single index, so no group can
   * slip between two reads the way it can between the lifecycle indexes.
   *
   * The lifecycle indexes are still read, and cover the groups the index does not
   * yet know about: everything staged before it existed, and everything staged by
   * a pod on the previous release while a rollout is in progress. Those groups are
   * still exposed to the sequential-read race the index exists to remove, so any
   * id found there is written into the index as it is read. One observation is
   * enough — from then on the group is counted from the index and is immune,
   * which bounds the exposure at "until first seen" rather than "until drained".
   *
   * The legs can be dropped once no queue predates the index and no pod predates
   * the writers.
   *
   * Returns null when the pass lost its single-flight marker partway.
   */
  private async collectPendingGroupIds(params: {
    prefix: string;
    refreshLease: () => Promise<boolean>;
  }): Promise<Set<string> | null> {
    const { prefix, refreshLease } = params;
    const groupIds = new Set<string>();

    const parkedTenants = new Set<string>();
    const heldThroughTenants = await this.collectIndexMembers({
      key: `${prefix}parked-tenants`,
      type: "set",
      into: parkedTenants,
      refreshLease,
    });
    if (!heldThroughTenants) return null;

    const indexed = await this.collectIndexMembers({
      key: pendingGroupsKey(prefix),
      type: "set",
      into: groupIds,
      refreshLease,
    });
    if (!indexed) return null;
    const alreadyIndexed = new Set(groupIds);

    // TODO(cleanup): the lifecycle legs below exist only for groups the index has
    // not learned about yet. Removable once no queue predates the index and no pod
    // predates the writers.
    const legacyLegs: { key: string; type: "zset" | "set" }[] = [
      { key: `${prefix}ready`, type: "zset" },
      { key: `${prefix}blocked`, type: "set" },
      ...Array.from(parkedTenants, (tenantId) => ({
        key: `${prefix}parked:${tenantId}`,
        type: "zset" as const,
      })),
    ];

    for (const leg of legacyLegs) {
      const held = await this.collectIndexMembers({
        key: leg.key,
        type: leg.type,
        into: groupIds,
        refreshLease,
      });
      if (!held) return null;
    }

    // The lifecycle legs only cover a group the pass actually saw, and a group
    // moving between them mid-read is seen by neither. The keyspace sweep is what
    // covers those, because it reads key existence rather than membership.
    let sweptUnindexed: number | null = null;
    if (await this.isKeyspaceSweepDue(prefix)) {
      const swept = await this.sweepKeyspaceForGroups({ prefix, refreshLease });
      if (swept === null) return null;
      sweptUnindexed = 0;
      for (const groupId of swept) {
        groupIds.add(groupId);
        if (!alreadyIndexed.has(groupId)) sweptUnindexed += 1;
      }
    }

    const toAdopt = Array.from(groupIds).filter(
      (id) => !alreadyIndexed.has(id),
    );
    const held = await this.backfillPendingIndex({
      prefix,
      groupIds: toAdopt,
      refreshLease,
    });
    if (!held) return null;

    // Only a pass that actually swept may move the deadline. Rescheduling on
    // every pass would push it out by a fresh backstop each time and the sweep
    // would never come due again — the deadline would outrun the clock.
    if (sweptUnindexed !== null) {
      await this.recordSweepOutcome({ prefix, adopted: sweptUnindexed });
    }

    return groupIds;
  }

  /**
   * Adopt groups the lifecycle indexes know about but the pending index does not.
   *
   * Until a group is in the index it is counted by reading the lifecycle indexes
   * in sequence, and a group moving between them mid-read can be missed. Writing
   * it in on first sight closes that for every later pass.
   *
   * Returns false when the lease was lost, which aborts the pass: this runs
   * inside the pass's marker and can span several round trips, so it has to hold
   * the lease like every other phase rather than run on a marker that has since
   * moved to another instance.
   */
  private async backfillPendingIndex(params: {
    prefix: string;
    groupIds: string[];
    refreshLease: () => Promise<boolean>;
  }): Promise<boolean> {
    if (params.groupIds.length === 0) return true;
    const indexKey = pendingGroupsKey(params.prefix);
    try {
      for (
        let offset = 0;
        offset < params.groupIds.length;
        offset += PENDING_RECONCILE_ZCARD_BATCH
      ) {
        await this.redis.sadd(
          indexKey,
          ...params.groupIds.slice(
            offset,
            offset + PENDING_RECONCILE_ZCARD_BATCH,
          ),
        );
        if (!(await params.refreshLease())) return false;
      }
    } catch (err) {
      logger.warn(
        { error: err },
        "Failed to adopt lifecycle-index groups into the pending index",
      );
    }
    return true;
  }

  /**
   * Walk the keyspace for `group:<id>:jobs` keys and adopt every group into the
   * pending index.
   *
   * This is the one enumeration that cannot miss a group: it reads key existence,
   * so a group is found whatever lifecycle index it is in and however it moves
   * between them. That is what makes it the right tool for the groups the index
   * does not know about — everything staged before the index existed, and
   * everything staged by a pod on the previous release during a rollout. Reading
   * the lifecycle indexes cannot cover those safely, and adopting on sight only
   * helps a group the pass actually saw.
   *
   * It is also the expensive one — SCAN walks every key in the database
   * regardless of MATCH — which is why it is not how the counter is normally
   * enumerated. It runs when the queue has groups the index has not learned yet
   * (so, repeatedly through a rollout, at the cost this reconcile had before the
   * index existed and no more) and drops back to a slow backstop cadence once a
   * sweep finds nothing new to adopt.
   *
   * Returns null when the lease was lost.
   */
  private async sweepKeyspaceForGroups(params: {
    prefix: string;
    refreshLease: () => Promise<boolean>;
  }): Promise<Set<string> | null> {
    const pattern = `${params.prefix}group:*:jobs`;
    const groupKeyPrefix = `${params.prefix}group:`;
    const found = new Set<string>();

    // SCAN is keyless, so on a cluster ioredis routes it to an arbitrary node and
    // one call sees one node's keyspace. Fanning out over the masters is what
    // makes "cannot miss a group" true there too.
    const nodes: { scan: IORedis["scan"] }[] = isClusterClient(this.redis)
      ? this.redis.nodes("master")
      : [this.redis];

    for (const node of nodes) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await node.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          PENDING_RECONCILE_PAGE_SIZE,
        );
        cursor = nextCursor;
        for (const key of keys) {
          found.add(key.slice(groupKeyPrefix.length, -":jobs".length));
        }
        if (!(await params.refreshLease())) return null;
      } while (cursor !== "0");
    }

    return found;
  }

  /**
   * Whether a keyspace sweep is due.
   *
   * Due when one has never run, or when the stored due time has passed. The due
   * time is written by {@link recordSweepOutcome}, which keeps sweeping every
   * pass while sweeps are still finding groups to adopt.
   */
  private async isKeyspaceSweepDue(prefix: string): Promise<boolean> {
    const raw = await this.redis.get(`${prefix}${SWEEP_DUE_KEY_SUFFIX}`);
    if (raw === null) return true;
    const dueAt = Number(raw);
    return !Number.isFinite(dueAt) || Date.now() >= dueAt;
  }

  /**
   * Schedule the next keyspace sweep from what this one adopted.
   *
   * Adopting something means the index is still behind — a rollout is in flight,
   * or the queue predates the index — so the next pass sweeps again, which costs
   * what this reconcile cost before the index existed and no more. Adopting
   * nothing means the index is complete, and the sweep drops back to a slow
   * backstop that only has to catch a writer nobody has noticed is missing.
   *
   * `adopted` counts what the SWEEP found unindexed, not everything the pass
   * adopted. The lifecycle legs also turn up unindexed ids, but they include
   * groups that hold no jobs at all — a drained group still listed in `ready` or
   * `blocked` is adopted, pruned for being empty, and found again next pass.
   * Counting those would answer "sweep again" forever and pin the queue to the
   * expensive walk on a group with no pending work to find.
   *
   * Only ever called by a pass that swept. Calling it otherwise moves the
   * deadline without the walk that earns it, and the sweep stops coming due.
   */
  private async recordSweepOutcome(params: {
    prefix: string;
    adopted: number;
  }): Promise<void> {
    const nextDueAt =
      params.adopted > 0
        ? Date.now()
        : Date.now() + PENDING_RECONCILE_SWEEP_BACKSTOP_MS;
    await this.redis.set(
      `${params.prefix}${SWEEP_DUE_KEY_SUFFIX}`,
      String(nextDueAt),
    );
  }

  /**
   * Page one index into `into`, re-arming the lease after each page.
   *
   * Returns false when the lease was lost, which aborts the pass: a pass that no
   * longer owns the marker must not go on to publish a count.
   */
  private async collectIndexMembers(params: {
    key: string;
    type: "zset" | "set";
    into: Set<string>;
    refreshLease: () => Promise<boolean>;
  }): Promise<boolean> {
    // A ZSCAN page alternates [member, score, ...]; an SSCAN page is members only.
    const stride = params.type === "zset" ? 2 : 1;
    let cursor = "0";
    do {
      const [nextCursor, members] =
        params.type === "zset"
          ? await this.redis.zscan(
              params.key,
              cursor,
              "COUNT",
              PENDING_RECONCILE_PAGE_SIZE,
            )
          : await this.redis.sscan(
              params.key,
              cursor,
              "COUNT",
              PENDING_RECONCILE_PAGE_SIZE,
            );
      cursor = nextCursor;
      for (let i = 0; i < members.length; i += stride) {
        params.into.add(members[i]!);
      }
      if (!(await params.refreshLease())) return false;
    } while (cursor !== "0");
    return true;
  }

  /**
   * Sum ZCARD over the collected keys in batches, re-arming the single-flight
   * lease between batches so a long pass keeps its hold.
   *
   * Returns null if any pipeline entry errors, if the whole batch fails, or if
   * the lease was lost — a flaky ZCARD must never write a partial under-count as
   * ground truth, and a pass that lost the marker must not write at all. The next
   * cycle retries.
   *
   * Also reports the keys observed empty, which the caller may prune from the
   * pending index.
   */
  private async sumPendingJobs(params: {
    jobsKeys: string[];
    refreshLease: () => Promise<boolean>;
  }): Promise<{ groundTruth: number; emptyJobsKeys: string[] } | null> {
    let groundTruth = 0;
    const emptyJobsKeys: string[] = [];
    for (
      let offset = 0;
      offset < params.jobsKeys.length;
      offset += PENDING_RECONCILE_ZCARD_BATCH
    ) {
      const batch = await this.countOneBatch(
        params.jobsKeys.slice(offset, offset + PENDING_RECONCILE_ZCARD_BATCH),
        offset,
      );
      if (batch === null) return null;
      groundTruth += batch.sum;
      emptyJobsKeys.push(...batch.emptyKeys);
      if (!(await params.refreshLease())) return null;
    }
    return { groundTruth, emptyJobsKeys };
  }

  /**
   * ZCARD one batch of keys in a single round trip.
   *
   * Returns null on any failure — whole-batch or single-entry — so the caller
   * abandons the pass rather than folding a shortfall into the total.
   */
  private async countOneBatch(
    jobsKeys: string[],
    batchOffset: number,
  ): Promise<{ sum: number; emptyKeys: string[] } | null> {
    const pipeline = this.redis.pipeline();
    for (const key of jobsKeys) {
      pipeline.zcard(key);
    }
    const results = await pipeline.exec();
    // A null exec is the whole batch failing, not an empty batch. Treating it as
    // empty would contribute 0 for every key in it and write the shortfall out as
    // ground truth — the same under-count the per-entry check refuses.
    if (results === null) {
      logger.warn(
        { batchOffset },
        "ZCARD pipeline returned no results during pending reconcile — aborting to avoid under-count",
      );
      return null;
    }
    let sum = 0;
    const emptyKeys: string[] = [];
    for (const [index, [err, val]] of results.entries()) {
      if (err) {
        logger.warn(
          { error: err },
          "ZCARD pipeline error during pending reconcile — aborting to avoid under-count",
        );
        return null;
      }
      const count = Number(val) || 0;
      sum += count;
      if (count === 0) emptyKeys.push(jobsKeys[index]!);
    }
    return { sum, emptyKeys };
  }

  /**
   * Drop groups this pass observed empty from the pending index.
   *
   * Best-effort and never fatal: the index is allowed to over-report, so a failed
   * prune costs a few wasted ZCARDs on later passes and nothing else. The script
   * re-reads each zset atomically, so a group staged since the observation stays.
   */
  private async prunePendingIndex(params: {
    prefix: string;
    emptyJobsKeys: string[];
    refreshLease: () => Promise<boolean>;
  }): Promise<void> {
    if (params.emptyJobsKeys.length === 0) return;
    const indexKey = pendingGroupsKey(params.prefix);
    const groupKeyPrefix = `${params.prefix}group:`;
    for (
      let offset = 0;
      offset < params.emptyJobsKeys.length;
      offset += PENDING_RECONCILE_ZCARD_BATCH
    ) {
      const args: string[] = [];
      for (const jobsKey of params.emptyJobsKeys.slice(
        offset,
        offset + PENDING_RECONCILE_ZCARD_BATCH,
      )) {
        // The script needs both the id to remove and the key to re-read.
        args.push(
          jobsKey.slice(groupKeyPrefix.length, -":jobs".length),
          jobsKey,
        );
      }
      try {
        await pendingIndexPruneScript.run(this.redis, 1, indexKey, ...args);
        // Pruning runs after the counter is published, so losing the lease here
        // cannot corrupt a result — but it can leave this pass working on a
        // marker another instance now owns, which is the overlap the marker
        // exists to stop. Stop rather than press on.
        if (!(await params.refreshLease())) return;
      } catch (err) {
        logger.warn(
          { error: err },
          "Failed to prune drained groups from the pending index",
        );
        return;
      }
    }
  }

  /**
   * Re-arm the single-flight marker this pass holds, or drop it when the
   * requested TTL has already run out.
   *
   * Returns whether this pass still owned the marker. A false is the signal to
   * abort: the marker has moved to another instance, so anything this pass went
   * on to write could overwrite fresher state. An error reports the same way —
   * being unable to prove ownership is not the same as holding it.
   */
  private async setReconcileMarkerTtl(params: {
    markerKey: string;
    holderToken: string;
    ttlMs: number;
  }): Promise<boolean> {
    try {
      const held = await reconcileMarkerTtlScript.run(
        this.redis,
        1,
        params.markerKey,
        params.holderToken,
        Math.trunc(params.ttlMs),
      );
      return Number(held) === 1;
    } catch (err) {
      logger.warn(
        { error: err },
        "Failed to re-arm the pending reconcile single-flight marker",
      );
      return false;
    }
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
