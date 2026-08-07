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
  readJobRoutingMeta,
} from "~/server/event-sourcing/queues/groupQueue/jobEnvelope";
import { legacyStagedJobAttempt } from "~/server/event-sourcing/queues/groupQueue/legacyStagedJobAttempt";
import { RedisJobBlobStore } from "~/server/event-sourcing/queues/groupQueue/redisJobBlobStore";
import {
  GROUP_QUEUE_REGISTRY_KEY,
  PARK_HELPER_LUA,
  PENDING_INDEX_HELPER_LUA,
  pendingGroupsKey,
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
const RECONCILE_WRITE_LUA = `
local markerKey  = KEYS[1]
local counterKey = KEYS[2]
local holderToken = ARGV[1]
local groundTruth = ARGV[2]

if redis.call("GET", markerKey) ~= holderToken then return 0 end
redis.call("SET", counterKey, groundTruth)
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
const reconcileMarkerTtlScript = new CachedLuaScript(RECONCILE_MARKER_TTL_LUA);
const reconcileWriteScript = new CachedLuaScript(RECONCILE_WRITE_LUA);
const pendingIndexPruneScript = new CachedLuaScript(PENDING_INDEX_PRUNE_LUA);

// ── Constants ────────────────────────────────────────────────────────

const SUMMARY_TOP_N = 200;
const DLQ_TTL_SECONDS = 604800;
const SSCAN_BATCH = 500;

/** Page size for the index reads that enumerate a queue's groups. */
const PENDING_RECONCILE_PAGE_SIZE = 1000;

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

/** Number of pipeline commands `fetchGroupPipelineResults` issues per group. */
const SCAN_GROUP_PIPELINE_CMDS_PER_GROUP = 7;

function buildScanQueueKeys(queueName: string): {
  displayName: string;
  prefix: string;
  readyKey: string;
  blockedKey: string;
  dlqKey: string;
  totalPendingKey: string;
  parkedTenantsKey: string;
} {
  const displayName = stripHashTag(queueName);
  const prefix = `${queueName}:gq:`;
  return {
    displayName,
    prefix,
    readyKey: `${prefix}ready`,
    blockedKey: `${prefix}blocked`,
    dlqKey: `${prefix}dlq`,
    totalPendingKey: `${prefix}stats:total-pending`,
    parkedTenantsKey: `${prefix}parked-tenants`,
  };
}

/**
 * Merge the top and bottom samples of the ready zset into a deduped id list.
 *
 * The zset is scored by dispatch eligibility, so its ends hold the two
 * distinct stuck-group classes — see the call site in
 * {@link QueueRedisRepository.fetchQueueOverview}. When the zset fits in the
 * sampled range the two ends coincide and dedup makes this identical to a
 * single-ended sample.
 */
function collectReadyGroupIds(params: {
  topReadyMembers: string[];
  bottomReadyMembers: string[];
}): { groupIds: string[]; readyScores: Map<string, number> } {
  const groupIds: string[] = [];
  const readyScores = new Map<string, number>();
  for (const members of [params.topReadyMembers, params.bottomReadyMembers]) {
    for (let i = 0; i < members.length; i += 2) {
      const groupId = members[i]!;
      if (readyScores.has(groupId)) continue;
      const score = parseFloat(members[i + 1]!);
      groupIds.push(groupId);
      readyScores.set(groupId, score);
    }
  }
  return { groupIds, readyScores };
}

function extractFirstJobIds(params: {
  pipelineResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  allGroupIds: string[];
}): Array<{ groupId: string; jobId: string | null }> {
  const firstJobIds: Array<{ groupId: string; jobId: string | null }> = [];
  for (let i = 0; i < params.allGroupIds.length; i++) {
    const base = i * SCAN_GROUP_PIPELINE_CMDS_PER_GROUP;
    const oldestArr =
      (params.pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
    firstJobIds.push({
      groupId: params.allGroupIds[i]!,
      jobId: oldestArr[0] ?? null,
    });
  }
  return firstJobIds;
}

type GroupErrorInfo = { message: string; stack: string; timestamp: string };

/** The raw per-group fields decoded from `fetchGroupPipelineResults`'s pipeline slots. */
function extractGroupPipelineFields(params: {
  pipelineResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  index: number;
}): {
  pendingJobs: number;
  activeJobId: string | null;
  isBlocked: boolean;
  oldestJobMs: number | null;
  newestJobMs: number | null;
  activeKeyTtlSec: number | null;
  attemptRaw: string | null;
} {
  const base = params.index * SCAN_GROUP_PIPELINE_CMDS_PER_GROUP;
  const results = params.pipelineResults;
  const oldestArr = (results?.[base + 2]?.[1] as string[]) ?? [];
  const newestArr = (results?.[base + 3]?.[1] as string[]) ?? [];
  const activeKeyTtlSecRaw = (results?.[base + 5]?.[1] as number) ?? -2;

  return {
    pendingJobs: (results?.[base]?.[1] as number) ?? 0,
    activeJobId: (results?.[base + 1]?.[1] as string) ?? null,
    isBlocked: (results?.[base + 4]?.[1] as number) === 1,
    oldestJobMs: oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null,
    newestJobMs: newestArr.length >= 2 ? parseFloat(newestArr[1]!) : null,
    activeKeyTtlSec: activeKeyTtlSecRaw > 0 ? activeKeyTtlSecRaw : null,
    attemptRaw: (results?.[base + 6]?.[1] as string) ?? null,
  };
}

/**
 * Resolve the head job's routing metadata, threading `dataIdx` forward.
 *
 * `dataResults` only has an entry for groups whose first job id was truthy
 * (see `fetchFirstJobData`), so the index into it advances independently of
 * the group loop's own index — callers must feed the returned `nextDataIdx`
 * back in on the following iteration.
 */
function resolveGroupJobMeta(params: {
  jobId: string | null;
  dataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  dataIdx: number;
}): {
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
  nextDataIdx: number;
} {
  if (!params.jobId) {
    return {
      pipelineName: null,
      jobType: null,
      jobName: null,
      nextDataIdx: params.dataIdx,
    };
  }

  const rawData = (params.dataResults?.[params.dataIdx]?.[1] as string) ?? null;
  const nextDataIdx = params.dataIdx + 1;
  if (!rawData) {
    return { pipelineName: null, jobType: null, jobName: null, nextDataIdx };
  }

  const meta = readJobRoutingMeta(rawData);
  return {
    pipelineName: meta.pipelineName,
    jobType: meta.jobType,
    jobName: meta.jobName,
    nextDataIdx,
  };
}

function buildGroupInfoList(params: {
  allGroupIds: string[];
  pipelineResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  firstJobIds: Array<{ groupId: string; jobId: string | null }>;
  dataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  groupErrors: Map<string, GroupErrorInfo>;
  readyScores: Map<string, number>;
}): { groups: GroupInfo[]; activeGroupCount: number } {
  let dataIdx = 0;
  const groups: GroupInfo[] = [];
  let activeGroupCount = 0;

  for (let i = 0; i < params.allGroupIds.length; i++) {
    const groupId = params.allGroupIds[i]!;
    const jobId = params.firstJobIds[i]!.jobId;
    const fields = extractGroupPipelineFields({
      pipelineResults: params.pipelineResults,
      index: i,
    });
    const jobMeta = resolveGroupJobMeta({
      jobId,
      dataResults: params.dataResults,
      dataIdx,
    });
    dataIdx = jobMeta.nextDataIdx;

    const errorInfo = params.groupErrors.get(groupId);
    if (fields.activeJobId !== null) activeGroupCount++;

    groups.push({
      groupId,
      pendingJobs: fields.pendingJobs,
      score: params.readyScores.get(groupId) ?? 0,
      hasActiveJob: fields.activeJobId !== null,
      activeJobId: fields.activeJobId,
      isBlocked: fields.isBlocked,
      oldestJobMs: fields.oldestJobMs,
      newestJobMs: fields.newestJobMs,
      isStaleBlock:
        fields.isBlocked &&
        fields.pendingJobs === 0 &&
        fields.activeJobId === null,
      pipelineName: jobMeta.pipelineName,
      jobType: jobMeta.jobType,
      jobName: jobMeta.jobName,
      errorMessage: errorInfo?.message ?? null,
      errorStack: errorInfo?.stack ?? null,
      errorTimestamp: errorInfo?.timestamp
        ? parseFloat(errorInfo.timestamp)
        : null,
      retryCount: resolveRetryCount({ attemptRaw: fields.attemptRaw, jobId }),
      activeKeyTtlSec: fields.activeKeyTtlSec,
      processingDurationMs: null,
    });
  }

  return { groups, activeGroupCount };
}

function resolveTotalPendingJobs(params: {
  totalPendingRaw: string | null;
  groups: GroupInfo[];
}): number {
  if (params.totalPendingRaw !== null) {
    return Math.max(0, parseInt(params.totalPendingRaw, 10) || 0);
  }
  let totalPendingJobs = 0;
  for (const g of params.groups) {
    totalPendingJobs += g.pendingJobs;
  }
  return totalPendingJobs;
}

// The key list + trailing (groupId, nowMs) argv that UNBLOCK_LUA expects,
// in the exact order the script's KEYS/ARGV read them. Shared verbatim by
// every bulk unblock path (unblockAll, canaryUnblock) so the key shape only
// has to match the script in one place.
function buildUnblockScriptArgs(params: {
  prefix: string;
  groupId: string;
}): string[] {
  const { prefix, groupId } = params;
  return [
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
  ];
}

// The key list + trailing (groupId, ttl) argv MOVE_TO_DLQ_LUA expects, in the
// script's KEYS/ARGV order.
function buildMoveToDlqArgs(params: {
  prefix: string;
  groupId: string;
}): string[] {
  const { prefix, groupId } = params;
  return [
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
  ];
}

function collectMoveToDlqResults(
  results: Awaited<ReturnType<typeof execWithNoScriptRecovery>>,
): { movedCount: number; jobsMoved: number } {
  let movedCount = 0;
  let jobsMoved = 0;
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
  return { movedCount, jobsMoved };
}

// The key list + trailing (groupId, nowMs) argv REPLAY_FROM_DLQ_LUA expects,
// in the script's KEYS/ARGV order. Shared verbatim by replayAllFromDlq and
// canaryRedrive.
function buildReplayFromDlqArgs(params: {
  prefix: string;
  groupId: string;
}): string[] {
  const { prefix, groupId } = params;
  return [
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
  ];
}

/**
 * Build a groupId → pipelineName lookup from a batch of `hget ...:data` reads.
 *
 * `dataRequests[i]` and `jobDataResults[i]` are always the same length and
 * index-aligned — every caller builds them together in one pass over the same
 * member list — so this only ever reads a decoded value against the request
 * that produced it.
 */
function buildPipelineNameMap(params: {
  dataRequests: { groupId: string }[];
  jobDataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
}): Map<string, string> {
  const pipelineNames = new Map<string, string>();
  for (let i = 0; i < params.dataRequests.length; i++) {
    const raw = params.jobDataResults?.[i]?.[1] as string | null;
    if (raw) {
      const pipelineName = readJobRoutingMeta(raw).pipelineName;
      if (pipelineName) {
        pipelineNames.set(params.dataRequests[i]!.groupId, pipelineName);
      }
    }
  }
  return pipelineNames;
}

function buildDlqGroupInfos(params: {
  members: string[];
  results: Awaited<ReturnType<ChainableCommander["exec"]>>;
  groupPipelines: Map<string, string>;
}): DlqGroupInfo[] {
  const groups: DlqGroupInfo[] = [];
  for (let i = 0; i < params.members.length; i++) {
    const groupId = params.members[i]!;
    const errorHash = params.results?.[i * 3]?.[1] as Record<
      string,
      string
    > | null;
    const jobCount = (params.results?.[i * 3 + 1]?.[1] as number) ?? 0;

    groups.push({
      groupId,
      error: errorHash?.message ?? null,
      errorStack: errorHash?.stack ?? null,
      pipelineName: params.groupPipelines.get(groupId) ?? null,
      jobCount,
      movedAt: errorHash?.timestamp ? parseFloat(errorHash.timestamp) : null,
    });
  }
  return groups;
}

/**
 * Tally one blocked-group page into the drain preview's running totals,
 * honoring the optional error/pipeline filters. Returns the count of groups
 * this page contributed to `totalAffected`, so the caller can accumulate it.
 */
function passesDrainPreviewFilters(params: {
  msg: string;
  pName: string;
  pipelineFilter?: string;
  errorFilter?: string;
}): boolean {
  if (
    params.errorFilter &&
    !params.msg.toLowerCase().includes(params.errorFilter.toLowerCase())
  ) {
    return false;
  }
  if (params.pipelineFilter && params.pName !== params.pipelineFilter) {
    return false;
  }
  return true;
}

function accumulateDrainPreview(params: {
  members: string[];
  results: Awaited<ReturnType<ChainableCommander["exec"]>>;
  groupPipelines: Map<string, string>;
  pipelineFilter?: string;
  errorFilter?: string;
  pipelineCounts: Map<string, number>;
  errorCounts: Map<string, number>;
}): number {
  let affected = 0;
  for (let i = 0; i < params.members.length; i++) {
    const groupId = params.members[i]!;
    const errorHash = params.results?.[i * 2]?.[1] as Record<
      string,
      string
    > | null;
    const msg = errorHash?.message ?? "Unknown error";
    const pName = params.groupPipelines.get(groupId) ?? "unknown";

    if (
      !passesDrainPreviewFilters({
        msg,
        pName,
        pipelineFilter: params.pipelineFilter,
        errorFilter: params.errorFilter,
      })
    ) {
      continue;
    }

    affected++;
    params.pipelineCounts.set(
      pName,
      (params.pipelineCounts.get(pName) ?? 0) + 1,
    );

    const normalizedMsg = normalizeErrorMessage(msg);
    params.errorCounts.set(
      normalizedMsg,
      (params.errorCounts.get(normalizedMsg) ?? 0) + 1,
    );
  }
  return affected;
}

// Insert-or-update a single error cluster's aggregate, capping the sample
// group ids at 5 the same way whether the cluster is new or already seen.
function upsertErrorCluster(params: {
  clusterMap: Map<string, ErrorCluster>;
  clusterKey: string;
  groupId: string;
  normalizedMessage: string;
  message: string;
  stack: string | null;
  pipelineName: string | null;
  queueName: string;
}): void {
  const existing = params.clusterMap.get(params.clusterKey);
  if (existing) {
    existing.count++;
    if (existing.sampleGroupIds.length < 5) {
      existing.sampleGroupIds.push(params.groupId);
    }
    return;
  }
  params.clusterMap.set(params.clusterKey, {
    normalizedMessage: params.normalizedMessage,
    sampleMessage: params.message,
    sampleStack: params.stack,
    count: 1,
    pipelineName: params.pipelineName,
    queueName: params.queueName,
    sampleGroupIds: [params.groupId],
  });
}

function resolveMatchingPipelineGroups(params: {
  dataRequests: { groupId: string }[];
  dataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  pipelineFilter: string;
}): Set<string> {
  const matchingGroups = new Set<string>();
  for (let i = 0; i < params.dataRequests.length; i++) {
    const raw = params.dataResults?.[i]?.[1] as string | null;
    if (raw) {
      if (readJobRoutingMeta(raw).pipelineName === params.pipelineFilter) {
        matchingGroups.add(params.dataRequests[i]!.groupId);
      }
    }
  }
  return matchingGroups;
}

function passesGroupErrorFilter(params: {
  index: number;
  filterResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  errorFilter?: string;
}): boolean {
  if (!params.errorFilter) return true;
  const errorHash = params.filterResults?.[params.index * 2]?.[1] as Record<
    string,
    string
  > | null;
  const msg = errorHash?.message ?? "";
  return msg.toLowerCase().includes(params.errorFilter.toLowerCase());
}

function passesGroupPipelineFilter(params: {
  groupId: string;
  jobDataMap: Map<string, number>;
  jobDataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  pipelineFilter?: string;
}): boolean {
  if (!params.pipelineFilter) return true;
  const fetchIdx = params.jobDataMap.get(params.groupId);
  if (fetchIdx === undefined) return false;
  const raw = params.jobDataResults?.[fetchIdx]?.[1] as string | null;
  if (!raw) return false;
  return readJobRoutingMeta(raw).pipelineName === params.pipelineFilter;
}

// Shared by filterBlockedGroups and filterDlqGroups' `.filter()` predicates —
// both fetch the same shape of data (error hash + first job id per member,
// then job data keyed by a jobDataMap index), differing only in whether the
// keys live under `group:` or `dlq:`, which is already baked into the maps
// passed in by the time this runs.
function matchesGroupFilters(params: {
  groupId: string;
  index: number;
  filterResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  jobDataMap: Map<string, number>;
  jobDataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  pipelineFilter?: string;
  errorFilter?: string;
}): boolean {
  return (
    passesGroupErrorFilter({
      index: params.index,
      filterResults: params.filterResults,
      errorFilter: params.errorFilter,
    }) &&
    passesGroupPipelineFilter({
      groupId: params.groupId,
      jobDataMap: params.jobDataMap,
      jobDataResults: params.jobDataResults,
      pipelineFilter: params.pipelineFilter,
    })
  );
}

function buildLegacyPendingLegs(params: {
  prefix: string;
  parkedTenants: Set<string>;
}): { key: string; type: "zset" | "set" }[] {
  return [
    { key: `${params.prefix}ready`, type: "zset" },
    { key: `${params.prefix}blocked`, type: "set" },
    ...Array.from(params.parkedTenants, (tenantId) => ({
      key: `${params.prefix}parked:${tenantId}`,
      type: "zset" as const,
    })),
  ];
}

// `members` alternates [groupId, score, groupId, score, ...] — collect just
// the groupIds that match the tenant prefix (and the optional
// groupIdContains fragment, if set).
function filterTenantGroupIds(params: {
  members: string[];
  tenantPrefix: string;
  contains: string | null;
}): string[] {
  const matched: string[] = [];
  for (let i = 0; i < params.members.length; i += 2) {
    const groupId = params.members[i]!;
    if (!groupId.startsWith(params.tenantPrefix)) continue;
    if (params.contains && !groupId.includes(params.contains)) continue;
    matched.push(groupId);
  }
  return matched;
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
    const keys = buildScanQueueKeys(queueName);
    const overview = await this.fetchQueueOverview({ keys, limit, offset });
    const parkedGroupCount = await this.sumParkedGroupCount({
      prefix: keys.prefix,
      parkedTenants: overview.parkedTenants,
    });

    const { groupIds, readyScores } = collectReadyGroupIds({
      topReadyMembers: overview.topReadyMembers,
      bottomReadyMembers: overview.bottomReadyMembers,
    });
    const blockedGroupIds = await this.fetchBlockedGroupIds({
      blockedKey: keys.blockedKey,
      blockedCount: overview.blockedCount,
      limit,
      readyGroupIdSet: new Set(groupIds),
    });
    const allGroupIds = [...groupIds, ...blockedGroupIds];

    const pipelineResults = await this.fetchGroupPipelineResults({
      prefix: keys.prefix,
      blockedKey: keys.blockedKey,
      allGroupIds,
    });
    const firstJobIds = extractFirstJobIds({ pipelineResults, allGroupIds });
    const dataResults = await this.fetchFirstJobData({
      prefix: keys.prefix,
      firstJobIds,
    });
    const groupErrors = await this.fetchGroupErrors({
      prefix: keys.prefix,
      allGroupIds,
    });

    const { groups, activeGroupCount } = buildGroupInfoList({
      allGroupIds,
      pipelineResults,
      firstJobIds,
      dataResults,
      groupErrors,
      readyScores,
    });

    groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

    const totalPendingJobs = resolveTotalPendingJobs({
      totalPendingRaw: overview.totalPendingRaw,
      groups,
    });

    return {
      name: queueName,
      displayName: keys.displayName,
      pendingGroupCount: overview.readyCount,
      blockedGroupCount: overview.blockedCount,
      activeGroupCount,
      totalPendingJobs,
      dlqCount: overview.dlqCount,
      parkedGroupCount,
      groups,
    };
  }

  // Sample BOTH ends of the ready zset. The zset is scored by dispatch
  // eligibility, so its ends hold the two distinct stuck-group classes: the
  // high end is the most-deferred groups (in-flight, retry backoff — where a
  // failing group hides between attempts), the low end is the most-eligible
  // ones (an old due head the dispatcher is starving). A single-ended
  // ZREVRANGE sampled only the deferred end, so an aged eligible backlog past
  // `limit` never appeared in the dashboard at all. When the zset fits in
  // `limit` the two ranges coincide and dedup makes this identical to before.
  private async fetchQueueOverview(params: {
    keys: ReturnType<typeof buildScanQueueKeys>;
    limit: number;
    offset: number;
  }): Promise<{
    readyCount: number;
    blockedCount: number;
    dlqCount: number;
    topReadyMembers: string[];
    bottomReadyMembers: string[];
    totalPendingRaw: string | null;
    parkedTenants: string[];
  }> {
    const { keys, limit, offset } = params;
    const [
      readyCount,
      blockedCount,
      dlqCount,
      topReadyMembers,
      bottomReadyMembers,
      totalPendingRaw,
      parkedTenants,
    ] = await Promise.all([
      this.redis.zcard(keys.readyKey),
      this.redis.scard(keys.blockedKey),
      this.redis.scard(keys.dlqKey),
      this.redis.zrevrange(
        keys.readyKey,
        offset,
        offset + limit - 1,
        "WITHSCORES",
      ),
      this.redis.zrange(
        keys.readyKey,
        offset,
        offset + limit - 1,
        "WITHSCORES",
      ),
      this.redis.get(keys.totalPendingKey),
      this.redis.smembers(keys.parkedTenantsKey),
    ]);
    return {
      readyCount,
      blockedCount,
      dlqCount,
      topReadyMembers,
      bottomReadyMembers,
      totalPendingRaw,
      parkedTenants,
    };
  }

  // Sum parked depth across the tenants currently over cap. The registry set
  // is tiny (one entry per over-cap tenant), so this is a single SMEMBERS plus
  // one ZCARD per parked tenant — effectively free in the cap=0 steady state
  // where the registry is empty.
  private async sumParkedGroupCount(params: {
    prefix: string;
    parkedTenants: string[];
  }): Promise<number> {
    let parkedGroupCount = 0;
    if (params.parkedTenants.length > 0) {
      const parkedPipeline = this.redis.pipeline();
      for (const tenantId of params.parkedTenants) {
        parkedPipeline.zcard(`${params.prefix}parked:${tenantId}`);
      }
      const parkedResults = await parkedPipeline.exec();
      for (const [err, val] of parkedResults ?? []) {
        if (!err) parkedGroupCount += Number(val) || 0;
      }
    }
    return parkedGroupCount;
  }

  private async fetchBlockedGroupIds(params: {
    blockedKey: string;
    blockedCount: number;
    limit: number;
    readyGroupIdSet: Set<string>;
  }): Promise<string[]> {
    const blockedMembers =
      params.blockedCount > 0
        ? await this.redis.srandmember(
            params.blockedKey,
            Math.min(params.limit, params.blockedCount),
          )
        : [];
    return (blockedMembers ?? []).filter(
      (id): id is string => id !== null && !params.readyGroupIdSet.has(id),
    );
  }

  private async fetchGroupPipelineResults(params: {
    prefix: string;
    blockedKey: string;
    allGroupIds: string[];
  }) {
    const pipeline = this.redis.pipeline();
    for (const groupId of params.allGroupIds) {
      const jobsKey = `${params.prefix}group:${groupId}:jobs`;
      const activeKey = `${params.prefix}group:${groupId}:active`;
      pipeline.zcard(jobsKey);
      pipeline.get(activeKey);
      pipeline.zrange(jobsKey, 0, 0, "WITHSCORES");
      pipeline.zrange(jobsKey, -1, -1, "WITHSCORES");
      pipeline.sismember(params.blockedKey, groupId);
      pipeline.ttl(`${params.prefix}group:${groupId}:active`);
      pipeline.get(`${params.prefix}group:${groupId}:attempt`);
    }
    return pipeline.exec();
  }

  private async fetchFirstJobData(params: {
    prefix: string;
    firstJobIds: Array<{ groupId: string; jobId: string | null }>;
  }) {
    const dataPipeline = this.redis.pipeline();
    let dataFetchCount = 0;
    for (const { groupId, jobId } of params.firstJobIds) {
      if (jobId) {
        dataPipeline.hget(`${params.prefix}group:${groupId}:data`, jobId);
        dataFetchCount++;
      }
    }
    return dataFetchCount > 0 ? await dataPipeline.exec() : [];
  }

  private async fetchGroupErrors(params: {
    prefix: string;
    allGroupIds: string[];
  }): Promise<Map<string, GroupErrorInfo>> {
    const errorPipeline = this.redis.pipeline();
    for (const groupId of params.allGroupIds) {
      errorPipeline.hgetall(`${params.prefix}group:${groupId}:error`);
    }
    const errorResults =
      params.allGroupIds.length > 0 ? await errorPipeline.exec() : [];

    const groupErrors = new Map<string, GroupErrorInfo>();
    for (let i = 0; i < params.allGroupIds.length; i++) {
      const errorHash = errorResults?.[i]?.[1] as Record<string, string> | null;
      if (errorHash?.message) {
        groupErrors.set(params.allGroupIds[i]!, {
          message: errorHash.message,
          stack: errorHash.stack ?? "",
          timestamp: errorHash.timestamp ?? "",
        });
      }
    }
    return groupErrors;
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

        const results = await this.fetchBlockedGroupPipelineData({
          prefix,
          members,
        });
        const pipelineNames = await this.fetchBlockedGroupPipelineNames({
          prefix,
          members,
          results,
        });
        this.accumulateBlockedClusters({
          queueName,
          members,
          results,
          pipelineNames,
          clusterMap,
        });
      } while (cursor !== "0");
    }

    const clusters = Array.from(clusterMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return { totalBlocked, clusters };
  }

  private async fetchBlockedGroupPipelineData(params: {
    prefix: string;
    members: string[];
  }) {
    const pipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      pipeline.hgetall(`${params.prefix}group:${groupId}:error`);
      pipeline.zrange(`${params.prefix}group:${groupId}:jobs`, 0, 0);
    }
    return pipeline.exec();
  }

  private queueBlockedGroupDataFetches(params: {
    prefix: string;
    members: string[];
    results: Awaited<ReturnType<ChainableCommander["exec"]>>;
  }): {
    dataPipeline: ChainableCommander;
    dataRequests: { groupId: string; jobId: string }[];
  } {
    const dataPipeline = this.redis.pipeline();
    const dataRequests: { groupId: string; jobId: string }[] = [];
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (params.results?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        dataPipeline.hget(
          `${params.prefix}group:${params.members[i]!}:data`,
          jobArr[0],
        );
        dataRequests.push({ groupId: params.members[i]!, jobId: jobArr[0] });
      }
    }
    return { dataPipeline, dataRequests };
  }

  private async fetchBlockedGroupPipelineNames(params: {
    prefix: string;
    members: string[];
    results: Awaited<ReturnType<ChainableCommander["exec"]>>;
  }): Promise<Map<string, string>> {
    const { dataPipeline, dataRequests } =
      this.queueBlockedGroupDataFetches(params);
    const jobDataResults =
      dataRequests.length > 0 ? await dataPipeline.exec() : [];
    return buildPipelineNameMap({ dataRequests, jobDataResults });
  }

  private accumulateBlockedClusters(params: {
    queueName: string;
    members: string[];
    results: Awaited<ReturnType<ChainableCommander["exec"]>>;
    pipelineNames: Map<string, string>;
    clusterMap: Map<string, ErrorCluster>;
  }): void {
    for (let i = 0; i < params.members.length; i++) {
      const groupId = params.members[i]!;
      const errorHash = params.results?.[i * 2]?.[1] as Record<
        string,
        string
      > | null;
      const message = errorHash?.message ?? "Unknown error";
      const stack = errorHash?.stack ?? null;
      const pipelineName = params.pipelineNames.get(groupId) ?? null;
      const normalized = normalizeErrorMessage(message);
      const clusterKey = `${pipelineName ?? ""}::${normalized}`;

      upsertErrorCluster({
        clusterMap: params.clusterMap,
        clusterKey,
        groupId,
        normalizedMessage: normalized,
        message,
        stack,
        pipelineName,
        queueName: params.queueName,
      });
    }
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

      unblockedCount += await this.unblockGroupsPage({
        prefix,
        groupIds: members,
      });
    } while (cursor !== "0");

    return { unblockedCount };
  }

  private async runUnblockPipeline(params: {
    prefix: string;
    groupIds: string[];
  }) {
    const { prefix, groupIds } = params;
    const pipeline = this.redis.pipeline();
    const argsByIndex = groupIds.map((groupId) =>
      buildUnblockScriptArgs({ prefix, groupId }),
    );
    for (const args of argsByIndex) {
      unblockScript.queue(pipeline, 9, ...args);
    }
    return execWithNoScriptRecovery(pipeline, (index) =>
      unblockScript.run(this.redis, 9, ...argsByIndex[index]!),
    );
  }

  private async unblockGroupsPage(params: {
    prefix: string;
    groupIds: string[];
  }): Promise<number> {
    const results = await this.runUnblockPipeline(params);
    let unblockedCount = 0;
    if (results) {
      for (const [err, result] of results) {
        if (!err && result === 1) unblockedCount++;
      }
    }
    return unblockedCount;
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

      const matched = filterTenantGroupIds({ members, tenantPrefix, contains });
      if (matched.length === 0) continue;

      const page = await this.drainMatchedGroupsPage({
        prefix,
        readyKey,
        totalPendingKey,
        matched,
      });
      groupsDrained += page.groupsDrained;
      jobsDrained += page.jobsDrained;
    } while (cursor !== "0");

    return { groupsDrained, jobsDrained };
  }

  private buildDrainGroupArgs(params: {
    prefix: string;
    readyKey: string;
    totalPendingKey: string;
    groupId: string;
  }): string[] {
    const { prefix, readyKey, totalPendingKey, groupId } = params;
    return [
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
    ];
  }

  // Pipeline all the drains for this page into a single network round-trip.
  // Each call is independent; ioredis batches them and returns results in
  // the same order.
  private async drainMatchedGroupsPage(params: {
    prefix: string;
    readyKey: string;
    totalPendingKey: string;
    matched: string[];
  }): Promise<{ groupsDrained: number; jobsDrained: number }> {
    const { prefix, readyKey, totalPendingKey, matched } = params;
    const pipeline = this.redis.pipeline();
    const argsByIndex = matched.map((groupId) =>
      this.buildDrainGroupArgs({ prefix, readyKey, totalPendingKey, groupId }),
    );
    for (const args of argsByIndex) {
      drainGroupScript.queue(pipeline, 11, ...args);
    }
    const results = await execWithNoScriptRecovery(pipeline, (index) =>
      drainGroupScript.run(this.redis, 11, ...argsByIndex[index]!),
    );
    let groupsDrained = 0;
    let jobsDrained = 0;
    if (results) {
      for (const [err, value] of results) {
        if (err) continue;
        groupsDrained++;
        jobsDrained += Number(value);
      }
    }
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

      const page = await this.moveBlockedGroupsPage({ prefix, groupsToMove });
      movedCount += page.movedCount;
      jobsMoved += page.jobsMoved;
    } while (cursor !== "0");

    return { movedCount, jobsMoved };
  }

  private async moveBlockedGroupsPage(params: {
    prefix: string;
    groupsToMove: string[];
  }): Promise<{ movedCount: number; jobsMoved: number }> {
    const { prefix, groupsToMove } = params;
    const pipeline = this.redis.pipeline();
    const argsByIndex = groupsToMove.map((groupId) =>
      buildMoveToDlqArgs({ prefix, groupId }),
    );
    for (const args of argsByIndex) {
      moveToDlqScript.queue(pipeline, 14, ...args);
    }
    const results = await execWithNoScriptRecovery(pipeline, (index) =>
      moveToDlqScript.run(this.redis, 14, ...argsByIndex[index]!),
    );
    return collectMoveToDlqResults(results);
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

      const page = await this.replayGroupsPage({ prefix, groupsToReplay });
      replayedCount += page.replayedCount;
      jobsReplayed += page.jobsReplayed;
    } while (cursor !== "0");

    return { replayedCount, jobsReplayed };
  }

  private async runReplayFromDlqPipeline(params: {
    prefix: string;
    groupIds: string[];
  }) {
    const { prefix, groupIds } = params;
    const pipeline = this.redis.pipeline();
    const argsByIndex = groupIds.map((groupId) =>
      buildReplayFromDlqArgs({ prefix, groupId }),
    );
    for (const args of argsByIndex) {
      replayFromDlqScript.queue(pipeline, 8, ...args);
    }
    return execWithNoScriptRecovery(pipeline, (index) =>
      replayFromDlqScript.run(this.redis, 8, ...argsByIndex[index]!),
    );
  }

  private async replayGroupsPage(params: {
    prefix: string;
    groupsToReplay: string[];
  }): Promise<{ replayedCount: number; jobsReplayed: number }> {
    const results = await this.runReplayFromDlqPipeline({
      prefix: params.prefix,
      groupIds: params.groupsToReplay,
    });
    let replayedCount = 0;
    let jobsReplayed = 0;
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

    const results = await this.runReplayFromDlqPipeline({
      prefix,
      groupIds: groupsToRedrive,
    });

    return this.collectRedriveResults({ results, groupsToRedrive });
  }

  private collectRedriveResults(params: {
    results: Awaited<ReturnType<typeof execWithNoScriptRecovery>>;
    groupsToRedrive: string[];
  }): { redrivenCount: number; groupIds: string[] } {
    let redrivenCount = 0;
    const redrivenIds: string[] = [];
    if (params.results) {
      for (let i = 0; i < params.results.length; i++) {
        const [err, result] = params.results[i]!;
        if (!err && Number(result) > 0) {
          redrivenCount++;
          redrivenIds.push(params.groupsToRedrive[i]!);
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

    const results = await this.runUnblockPipeline({
      prefix,
      groupIds: groupsToUnblock,
    });

    return this.collectUnblockResults({ results, groupsToUnblock });
  }

  private collectUnblockResults(params: {
    results: Awaited<ReturnType<typeof execWithNoScriptRecovery>>;
    groupsToUnblock: string[];
  }): { unblockedCount: number; groupIds: string[] } {
    let unblockedCount = 0;
    const unblockedIds: string[] = [];
    if (params.results) {
      for (let i = 0; i < params.results.length; i++) {
        const [err, result] = params.results[i]!;
        if (!err && result === 1) {
          unblockedCount++;
          unblockedIds.push(params.groupsToUnblock[i]!);
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

      const results = await this.fetchDlqGroupPipelineData({
        prefix,
        members,
      });
      const groupPipelines = await this.fetchDlqGroupPipelineNames({
        prefix,
        members,
        results,
      });
      groups.push(...buildDlqGroupInfos({ members, results, groupPipelines }));
    } while (cursor !== "0");

    groups.sort((a, b) => (b.movedAt ?? 0) - (a.movedAt ?? 0));
    return groups;
  }

  private async fetchDlqGroupPipelineData(params: {
    prefix: string;
    members: string[];
  }) {
    const pipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      pipeline.hgetall(`${params.prefix}dlq:${groupId}:error`);
      pipeline.zcard(`${params.prefix}dlq:${groupId}:jobs`);
      pipeline.zrange(`${params.prefix}dlq:${groupId}:jobs`, 0, 0);
    }
    return pipeline.exec();
  }

  private async fetchDlqGroupPipelineNames(params: {
    prefix: string;
    members: string[];
    results: Awaited<ReturnType<ChainableCommander["exec"]>>;
  }): Promise<Map<string, string>> {
    const dataPipeline = this.redis.pipeline();
    const dataRequests: { groupId: string; idx: number }[] = [];
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (params.results?.[i * 3 + 2]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        dataPipeline.hget(
          `${params.prefix}dlq:${params.members[i]!}:data`,
          jobArr[0],
        );
        dataRequests.push({ groupId: params.members[i]!, idx: i });
      }
    }
    const jobDataResults =
      dataRequests.length > 0 ? await dataPipeline.exec() : [];
    return buildPipelineNameMap({
      dataRequests,
      jobDataResults,
    });
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

      const results = await this.fetchBlockedGroupPipelineData({
        prefix,
        members,
      });
      const groupPipelines = await this.fetchBlockedGroupPipelineNames({
        prefix,
        members,
        results,
      });
      totalAffected += accumulateDrainPreview({
        members,
        results,
        groupPipelines,
        pipelineFilter: params.pipelineFilter,
        errorFilter: params.errorFilter,
        pipelineCounts,
        errorCounts,
      });
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
      const wrote = await reconcileWriteScript.run(
        this.redis,
        2,
        markerKey,
        counterKey,
        holderToken,
        String(groundTruth),
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
    const legacyHeld = await this.collectLegacyLegMembers({
      legs: buildLegacyPendingLegs({ prefix, parkedTenants }),
      into: groupIds,
      refreshLease,
    });
    if (!legacyHeld) return null;

    // The lifecycle legs only cover a group the pass actually saw, and a group
    // moving between them mid-read is seen by neither. The keyspace sweep is what
    // covers those, because it reads key existence rather than membership.
    const sweepResult = await this.runKeyspaceSweepIfDue({
      prefix,
      groupIds,
      alreadyIndexed,
      refreshLease,
    });
    if (sweepResult.status === "lease-lost") return null;

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
    if (sweepResult.status === "ok") {
      await this.recordSweepOutcome({ prefix, adopted: sweepResult.unindexed });
    }

    return groupIds;
  }

  private async collectLegacyLegMembers(params: {
    legs: { key: string; type: "zset" | "set" }[];
    into: Set<string>;
    refreshLease: () => Promise<boolean>;
  }): Promise<boolean> {
    for (const leg of params.legs) {
      const held = await this.collectIndexMembers({
        key: leg.key,
        type: leg.type,
        into: params.into,
        refreshLease: params.refreshLease,
      });
      if (!held) return false;
    }
    return true;
  }

  private async runKeyspaceSweepIfDue(params: {
    prefix: string;
    groupIds: Set<string>;
    alreadyIndexed: Set<string>;
    refreshLease: () => Promise<boolean>;
  }): Promise<
    | { status: "not-due" }
    | { status: "lease-lost" }
    | { status: "ok"; unindexed: number }
  > {
    if (!(await this.isKeyspaceSweepDue(params.prefix))) {
      return { status: "not-due" };
    }
    const swept = await this.sweepKeyspaceForGroups({
      prefix: params.prefix,
      refreshLease: params.refreshLease,
    });
    if (swept === null) return { status: "lease-lost" };

    let unindexed = 0;
    for (const groupId of swept) {
      params.groupIds.add(groupId);
      if (!params.alreadyIndexed.has(groupId)) unindexed += 1;
    }
    return { status: "ok", unindexed };
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

  private async fetchFirstJobIdsForGroups(params: {
    prefix: string;
    keyPrefix: "group" | "dlq";
    members: string[];
  }) {
    const jobIdPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      jobIdPipeline.zrange(
        `${params.prefix}${params.keyPrefix}:${groupId}:jobs`,
        0,
        0,
      );
    }
    return jobIdPipeline.exec();
  }

  private async fetchGroupDataForFirstJobs(params: {
    prefix: string;
    keyPrefix: "group" | "dlq";
    members: string[];
    jobIdResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  }): Promise<{
    dataRequests: { groupId: string }[];
    dataResults: Awaited<ReturnType<ChainableCommander["exec"]>>;
  }> {
    const dataPipeline = this.redis.pipeline();
    const dataRequests: { groupId: string }[] = [];
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (params.jobIdResults?.[i]?.[1] as string[]) ?? [];
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
    return { dataRequests, dataResults };
  }

  private async filterByPipelineName(params: {
    prefix: string;
    members: string[];
    pipelineFilter: string;
    keyPrefix: "group" | "dlq";
  }): Promise<string[]> {
    const jobIdResults = await this.fetchFirstJobIdsForGroups({
      prefix: params.prefix,
      keyPrefix: params.keyPrefix,
      members: params.members,
    });
    const { dataRequests, dataResults } = await this.fetchGroupDataForFirstJobs(
      {
        prefix: params.prefix,
        keyPrefix: params.keyPrefix,
        members: params.members,
        jobIdResults,
      },
    );
    const matchingGroups = resolveMatchingPipelineGroups({
      dataRequests,
      dataResults,
      pipelineFilter: params.pipelineFilter,
    });
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

    return params.members.filter((groupId, i) =>
      matchesGroupFilters({
        groupId,
        index: i,
        filterResults,
        jobDataMap,
        jobDataResults,
        pipelineFilter: params.pipelineFilter,
        errorFilter: params.errorFilter,
      }),
    );
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

    return params.members.filter((groupId, i) =>
      matchesGroupFilters({
        groupId,
        index: i,
        filterResults,
        jobDataMap,
        jobDataResults,
        pipelineFilter: params.pipelineFilter,
        errorFilter: params.errorFilter,
      }),
    );
  }
}
