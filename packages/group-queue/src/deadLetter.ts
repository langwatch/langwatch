import { nowInstant } from "@langwatch/time";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import { CachedLuaScript } from "./cachedLuaScript.ts";
import {
  BLOB_LEASE_HELPER_LUA,
  PARK_HELPER_LUA,
  PENDING_INDEX_HELPER_LUA,
  ROUTING_META_HELPER_LUA,
  TTL_HELPER_LUA,
} from "./scripts.ts";

/** What a job's group does once the job exhausts its retries or fails non-retryably. */
export const EXHAUSTED_OUTCOMES = ["block", "dead-letter"] as const;
export type ExhaustedOutcome = (typeof EXHAUSTED_OUTCOMES)[number];

/** How long a dead-lettered group's entries survive before Redis forgets them. */
export const DLQ_TTL_SECONDS = 604800;

/** The set of a queue's groups holding dead-lettered jobs, from the queue's key prefix. */
export function dlqIndexKey(keyPrefix: string): string {
  return `${keyPrefix}dlq`;
}

/** One group's dead-lettered jobs, their stored values and the last error that sent one there. */
export function dlqGroupKeys({ keyPrefix, groupId }: { keyPrefix: string; groupId: string }): {
  jobs: string;
  data: string;
  error: string;
} {
  return {
    jobs: `${keyPrefix}dlq:${groupId}:jobs`,
    data: `${keyPrefix}dlq:${groupId}:data`,
    error: `${keyPrefix}dlq:${groupId}:error`,
  };
}

/** An operator moving a whole live group (usually a blocked one) into the dead-letter layout. */
export const MOVE_TO_DLQ_LUA = `
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

-- A dead worker's claimed jobs (no active key; ":active" is 7 chars) go to the dead-letter queue
-- with the rest, in order. A live worker's claim is dropped with its active key, as before.
local claimedKey = string.sub(activeKey, 1, #activeKey - 7) .. ":claimed"
if redis.call("EXISTS", activeKey) == 0 then
  local claimed = redis.call("HGETALL", claimedKey)
  for i = 1, #claimed, 2 do
    if string.sub(claimed[i], 1, 2) == "s:" then
      local claimedJobId = string.sub(claimed[i], 3)
      local body = redis.call("HGET", claimedKey, "d:" .. claimedJobId)
      if body and redis.call("ZADD", dstJobsKey, "NX", claimed[i + 1], claimedJobId) == 1 then
        redis.call("HSET", dstDataKey, claimedJobId, body)
        count = count + 1
      end
    end
  end
end
redis.call("DEL", claimedKey)

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

/** Redrive: puts a group's dead-lettered jobs back on its live group and wakes dispatch. */
export const REPLAY_FROM_DLQ_LUA =
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

/**
 * Discard: the operator marking a group's jobs never-to-run. Answers the job count and last error
 * the audit row records (specs/ops/dead-letter-recovery.feature).
 */
export const DISCARD_FROM_DLQ_LUA = `
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

/**
 * The queue dead-letters one job: the claimed job's own value, or (value "") a drained sibling
 * already re-staged on the live group, taken off it. The group itself stays live.
 */
const DEAD_LETTER_JOB_LUA =
  BLOB_LEASE_HELPER_LUA +
  ROUTING_META_HELPER_LUA +
  `
local dlqIndexKey     = KEYS[1]
local statsKey        = KEYS[2]
local totalPendingKey = KEYS[3]

local keyPrefix    = ARGV[1]
local groupId      = ARGV[2]
local jobId        = ARGV[3]
local score        = tonumber(ARGV[4])
local value        = ARGV[5]
local errorMessage = ARGV[6]
local errorStack   = ARGV[7]
local ttl          = tonumber(ARGV[8])
local nowMs        = ARGV[9]
local claimToken   = ARGV[10] or ""

local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"
local dlqJobsKey   = keyPrefix .. "dlq:" .. groupId .. ":jobs"
local dlqDataKey   = keyPrefix .. "dlq:" .. groupId .. ":data"
local dlqErrorKey  = keyPrefix .. "dlq:" .. groupId .. ":error"
local claimedKey   = keyPrefix .. "group:" .. groupId .. ":claimed"
-- A worker whose claim another worker recovered dead-letters nothing; empty token: an older caller.
if claimToken ~= "" and redis.call("HGET", claimedKey, "token") ~= claimToken then
  return -1
end
-- A dead-lettered job leaves its claim's record too, so a death before the slot is completed
-- cannot bring it back (packages/group-queue/specs/claimed-job-recovery.feature).
redis.call("HDEL", claimedKey, "s:" .. jobId, "d:" .. jobId)

if value == "" then
  -- A staged sibling keeps its value and lease; it leaves the live group and its pending count.
  value = redis.call("HGET", groupDataKey, jobId)
  if not value then return 0 end
  local stagedScore = redis.call("ZSCORE", groupJobsKey, jobId)
  if stagedScore then score = tonumber(stagedScore) end
  if redis.call("ZREM", groupJobsKey, jobId) == 1 then
    redis.call("DECR", totalPendingKey)
  end
  redis.call("HDEL", groupDataKey, jobId)
else
  local lease = gqParseLease(value)
  if lease and lease.projectId == gqTenantOf(groupId) then
    gqTakeLease(keyPrefix, lease, gqRedisNowMs())
  end
end

redis.call("ZADD", dlqJobsKey, score, jobId)
redis.call("HSET", dlqDataKey, jobId, value)
redis.call("HSET", dlqErrorKey, "message", errorMessage, "stack", errorStack, "timestamp", nowMs)
redis.call("EXPIRE", dlqJobsKey, ttl)
redis.call("EXPIRE", dlqDataKey, ttl)
redis.call("EXPIRE", dlqErrorKey, ttl)
redis.call("SADD", dlqIndexKey, groupId)

redis.call("INCR", statsKey)
local _, _, jn = gqRoutingMeta(value)
if jn and jn ~= "" then
  redis.call("INCR", statsKey .. ":" .. jn)
end

return 1
`;

const deadLetterJobScript = new CachedLuaScript(DEAD_LETTER_JOB_LUA);

/**
 * Moves one job into its group's dead-letter entries, where ops lists, redrives and discards it.
 * `jobDataJson` "" takes a re-staged sibling off the live group. With the claim's token, a worker
 * whose claim was recovered moves nothing and hears "claim-lost".
 */
export async function deadLetterJob({
  redis,
  keyPrefix,
  groupId,
  jobId,
  score,
  jobDataJson,
  errorMessage,
  errorStack,
  claimToken = "",
}: {
  redis: IORedis | Cluster;
  keyPrefix: string;
  groupId: string;
  jobId: string;
  score: number;
  jobDataJson: string;
  errorMessage: string;
  errorStack: string;
  claimToken?: string;
}): Promise<"moved" | "missing" | "claim-lost"> {
  const moved = await deadLetterJobScript.run(
    redis,
    3,
    dlqIndexKey(keyPrefix),
    `${keyPrefix}stats:failed`,
    `${keyPrefix}stats:total-pending`,
    keyPrefix,
    groupId,
    jobId,
    String(score),
    jobDataJson,
    errorMessage,
    errorStack,
    String(DLQ_TTL_SECONDS),
    String(nowInstant().epochMilliseconds),
    claimToken,
  );
  if (Number(moved) === -1) return "claim-lost";
  return Number(moved) === 1 ? "moved" : "missing";
}
