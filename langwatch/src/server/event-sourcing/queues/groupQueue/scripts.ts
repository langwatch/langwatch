import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

// Lua scripts inlined as string constants.
// Source files in ./lua/ are kept as documentation but are NOT imported at runtime.
// This avoids loader incompatibilities across turbopack, webpack, vitest, and tsx.

const STAGE_LUA = `
local groupJobsKey = KEYS[1]
local readyKey     = KEYS[2]
local signalKey    = KEYS[3]
local dedupKey     = KEYS[4]

local stagedJobId    = ARGV[1]
local groupId        = ARGV[2]
local dispatchAfter  = tonumber(ARGV[3])
local dedupId        = ARGV[4]
local dedupTtlMs     = tonumber(ARGV[5])
local jobDataJson    = ARGV[6]

if dedupId ~= "" and dedupTtlMs > 0 then
  local existingJobId = redis.call("GET", dedupKey)
  if existingJobId then
    redis.call("ZREM", groupJobsKey, existingJobId)
    redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
    redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
    local dataKey = string.gsub(groupJobsKey, ":jobs$", ":data")
    redis.call("HDEL", dataKey, existingJobId)
    redis.call("HSET", dataKey, stagedJobId, jobDataJson)
    local pendingCount = redis.call("ZCARD", groupJobsKey)
    local score = math.sqrt(pendingCount)
    redis.call("ZADD", readyKey, score, groupId)
    redis.call("LPUSH", signalKey, "1")
    return 0
  end
end

redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
local dataKey = string.gsub(groupJobsKey, ":jobs$", ":data")
redis.call("HSET", dataKey, stagedJobId, jobDataJson)

if dedupId ~= "" and dedupTtlMs > 0 then
  redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
end

local pendingCount = redis.call("ZCARD", groupJobsKey)
local score = math.sqrt(pendingCount)
redis.call("ZADD", readyKey, score, groupId)

redis.call("LPUSH", signalKey, "1")

return 1
`;

const STAGE_BATCH_LUA = `
local readyKey   = KEYS[1]
local signalKey  = KEYS[2]

local keyPrefix = ARGV[1]
local count     = tonumber(ARGV[2])

local newStagedCount = 0
local affectedGroups = {}

for i = 1, count do
  local offset = 2 + (i - 1) * 6
  local stagedJobId   = ARGV[offset + 1]
  local groupId       = ARGV[offset + 2]
  local dispatchAfter = tonumber(ARGV[offset + 3])
  local dedupId       = ARGV[offset + 4]
  local dedupTtlMs    = tonumber(ARGV[offset + 5])
  local jobDataJson   = ARGV[offset + 6]

  local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
  local dataKey      = keyPrefix .. "group:" .. groupId .. ":data"
  local dedupKey     = (dedupId ~= "") and (keyPrefix .. "dedup:" .. dedupId) or (keyPrefix .. "dedup:__none__")

  local isDeduped = false
  if dedupId ~= "" and dedupTtlMs > 0 then
    local existingJobId = redis.call("GET", dedupKey)
    if existingJobId then
      redis.call("ZREM", groupJobsKey, existingJobId)
      redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
      redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
      redis.call("HDEL", dataKey, existingJobId)
      redis.call("HSET", dataKey, stagedJobId, jobDataJson)
      isDeduped = true
    end
  end

  if not isDeduped then
    redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
    redis.call("HSET", dataKey, stagedJobId, jobDataJson)
    if dedupId ~= "" and dedupTtlMs > 0 then
      redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
    end
    newStagedCount = newStagedCount + 1
  end

  affectedGroups[groupId] = true
end

for groupId, _ in pairs(affectedGroups) do
  local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
  local pendingCount = redis.call("ZCARD", groupJobsKey)
  local score = math.sqrt(pendingCount)
  redis.call("ZADD", readyKey, score, groupId)
  redis.call("LPUSH", signalKey, "1")
end

return newStagedCount
`;

const DISPATCH_LUA = `
local readyKey   = KEYS[1]
local blockedKey = KEYS[2]

local keyPrefix    = ARGV[1]
local nowMs        = tonumber(ARGV[2])
local activeTtlSec = tonumber(ARGV[3])

local groups = redis.call("ZREVRANGE", readyKey, 0, -1)

for _, groupId in ipairs(groups) do
  if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
    local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
    local activeJob = redis.call("GET", activeKey)

    if not activeJob then
      local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
      local results = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, 1)

      if #results >= 2 then
        local stagedJobId = results[1]
        local originalScore = results[2]
        redis.call("ZREM", jobsKey, stagedJobId)
        redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

        local pendingCount = redis.call("ZCARD", jobsKey)
        if pendingCount > 0 then
          local score = math.sqrt(pendingCount)
          redis.call("ZADD", readyKey, score, groupId)
        else
          redis.call("ZREM", readyKey, groupId)
        end

        local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
        local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
        redis.call("HDEL", dataKey, stagedJobId)

        return {stagedJobId, groupId, jobDataJson or "", originalScore}
      end
    end
  end
end

return nil
`;

const COMPLETE_LUA = `
local activeKey  = KEYS[1]
local jobsKey    = KEYS[2]
local readyKey   = KEYS[3]
local signalKey  = KEYS[4]
local blockedKey = KEYS[5]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]

local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

redis.call("DEL", activeKey)

-- Do NOT auto-unblock here. If the group was blocked (e.g. by a cascading
-- failure), only an explicit Skynet unblock should remove it. This prevents
-- a concurrent successful job from silently unblocking a group that has
-- ordering violations from the cascade.
-- redis.call("SREM", blockedKey, groupId)

local pendingCount = redis.call("ZCARD", jobsKey)
if pendingCount > 0 then
  local score = math.sqrt(pendingCount)
  redis.call("ZADD", readyKey, score, groupId)
else
  redis.call("ZREM", readyKey, groupId)
end

redis.call("LPUSH", signalKey, "1")

return 1
`;

const REFRESH_LUA = `
local activeKey    = KEYS[1]
local stagedJobId  = ARGV[1]
local activeTtlSec = tonumber(ARGV[2])

local currentActive = redis.call("GET", activeKey)
if currentActive == stagedJobId then
  redis.call("EXPIRE", activeKey, activeTtlSec)
  return 1
end
return 0
`;

const FAIL_LUA = `
local blockedKey = KEYS[1]
local activeKey  = KEYS[2]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]

-- Always block the group when retries are exhausted.
-- Previously we skipped blocking if a different job was active (stale worker check),
-- but this allowed cascading failures: active key TTL expires mid-retry → dispatcher
-- dispatches another job → old job's final failure can't block → repeat until staging
-- is drained. Always blocking is safe because blocked groups require explicit
-- operator unblock (via Skynet) to resume processing.
redis.call("SADD", blockedKey, groupId)

return 1
`;

const RESTAGE_AND_BLOCK_LUA = `
local blockedKey = KEYS[1]
local readyKey   = KEYS[2]

local keyPrefix       = ARGV[1]
local groupId         = ARGV[2]
local newStagedJobId  = ARGV[3]
local score           = tonumber(ARGV[4])
local jobDataJson     = ARGV[5]

local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"

-- 1. Block the group — prevents dispatcher from re-dispatching
redis.call("SADD", blockedKey, groupId)

-- 2. Re-stage the failed job with a new ID
redis.call("ZADD", groupJobsKey, score, newStagedJobId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)

-- 3. Update ready score so group is visible after unblock
local pendingCount = redis.call("ZCARD", groupJobsKey)
local readyScore = math.sqrt(pendingCount)
redis.call("ZADD", readyKey, readyScore, groupId)

return 1
`;

/**
 * Result of a dispatch operation.
 * Returns null when no eligible job is available.
 */
export interface DispatchResult {
  stagedJobId: string;
  groupId: string;
  jobDataJson: string;
  originalScore: number;
}

/**
 * TypeScript wrapper for the 4 group queue Lua scripts.
 * All Redis keys use the `{queueName}` hash tag for Redis Cluster compatibility.
 * Lua scripts derive per-group keys dynamically (e.g. keyPrefix .. "group:" .. groupId)
 * instead of passing them via KEYS[]; this is safe because keyPrefix includes the hash
 * tag, so all derived keys hash to the same Redis Cluster slot.
 */
export class GroupStagingScripts {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: IORedis | Cluster,
    queueName: string,
  ) {
    // queueName already includes hash tags, e.g. "{pipeline/handler/spanStorage}"
    this.keyPrefix = `${queueName}:gq:`;
  }

  /**
   * Stage a job into a group's pending queue.
   *
   * @returns true if a new job was staged, false if an existing job was replaced (dedup)
   */
  async stage({
    stagedJobId,
    groupId,
    dispatchAfterMs,
    dedupId,
    dedupTtlMs,
    jobDataJson,
  }: {
    stagedJobId: string;
    groupId: string;
    dispatchAfterMs: number;
    dedupId: string;
    dedupTtlMs: number;
    jobDataJson: string;
  }): Promise<boolean> {
    const groupJobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;
    const dedupKey =
      dedupId !== "" ? `${this.keyPrefix}dedup:${dedupId}` : `${this.keyPrefix}dedup:__none__`;

    const result = await this.redis.eval(
      STAGE_LUA,
      4,
      groupJobsKey,
      readyKey,
      signalKey,
      dedupKey,
      stagedJobId,
      groupId,
      String(dispatchAfterMs),
      dedupId,
      String(dedupTtlMs),
      jobDataJson,
    );

    return result === 1;
  }

  /**
   * Stage a batch of jobs into their respective group queues.
   *
   * @returns number of new jobs staged (excluding replaced ones)
   */
  async stageBatch(
    jobs: Array<{
      stagedJobId: string;
      groupId: string;
      dispatchAfterMs: number;
      dedupId: string;
      dedupTtlMs: number;
      jobDataJson: string;
    }>,
  ): Promise<number> {
    if (jobs.length === 0) return 0;

    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;

    const args: string[] = [this.keyPrefix, String(jobs.length)];
    for (const job of jobs) {
      args.push(
        job.stagedJobId,
        job.groupId,
        String(job.dispatchAfterMs),
        job.dedupId,
        String(job.dedupTtlMs),
        job.jobDataJson,
      );
    }

    const result = await this.redis.eval(STAGE_BATCH_LUA, 2, readyKey, signalKey, ...args);

    return Number(result);
  }

  /**
   * Pick the highest-weight ready group and pop its oldest eligible job.
   *
   * @returns dispatch result or null if nothing to dispatch
   */
  async dispatch({
    nowMs,
    activeTtlSec,
  }: {
    nowMs: number;
    activeTtlSec: number;
  }): Promise<DispatchResult | null> {
    const readyKey = `${this.keyPrefix}ready`;
    const blockedKey = `${this.keyPrefix}blocked`;

    const result = await this.redis.eval(
      DISPATCH_LUA,
      2,
      readyKey,
      blockedKey,
      this.keyPrefix,
      String(nowMs),
      String(activeTtlSec),
    );

    if (!result || !Array.isArray(result) || result.length < 4) {
      return null;
    }

    return {
      stagedJobId: String(result[0]),
      groupId: String(result[1]),
      jobDataJson: String(result[2]),
      originalScore: Number(result[3]),
    };
  }

  /**
   * Mark a group job as completed and signal the dispatcher.
   *
   * @returns true if completed, false if stale (active key doesn't match)
   */
  async complete({
    groupId,
    stagedJobId,
  }: {
    groupId: string;
    stagedJobId: string;
  }): Promise<boolean> {
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;
    const jobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;
    const blockedKey = `${this.keyPrefix}blocked`;

    const result = await this.redis.eval(
      COMPLETE_LUA,
      5,
      activeKey,
      jobsKey,
      readyKey,
      signalKey,
      blockedKey,
      groupId,
      stagedJobId,
    );

    return result === 1;
  }

  /**
   * Refresh the activeKey TTL during intermediate retries to prevent expiration.
   *
   * @returns true if refreshed, false if activeKey doesn't match (stale)
   */
  async refreshActiveKey({
    groupId,
    stagedJobId,
    activeTtlSec,
  }: {
    groupId: string;
    stagedJobId: string;
    activeTtlSec: number;
  }): Promise<boolean> {
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;

    const result = await this.redis.eval(
      REFRESH_LUA,
      1,
      activeKey,
      stagedJobId,
      String(activeTtlSec),
    );

    return result === 1;
  }

  /**
   * Mark a group as blocked after exhausted retries.
   * Always blocks unconditionally — COMPLETE_LUA on a healthy job will remove the block.
   */
  async fail({
    groupId,
    stagedJobId,
  }: {
    groupId: string;
    stagedJobId: string;
  }): Promise<boolean> {
    const blockedKey = `${this.keyPrefix}blocked`;
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;

    const result = await this.redis.eval(
      FAIL_LUA,
      2,
      blockedKey,
      activeKey,
      groupId,
      stagedJobId,
    );

    return result === 1;
  }

  /**
   * Atomically block a group and re-stage a failed job after exhausted retries.
   * Combines blocking, re-staging, and ready-score update in a single Lua call.
   */
  async restageAndBlock({
    groupId,
    newStagedJobId,
    score,
    jobDataJson,
  }: {
    groupId: string;
    newStagedJobId: string;
    score: number;
    jobDataJson: string;
  }): Promise<void> {
    const blockedKey = `${this.keyPrefix}blocked`;
    const readyKey = `${this.keyPrefix}ready`;

    await this.redis.eval(
      RESTAGE_AND_BLOCK_LUA,
      2,
      blockedKey,
      readyKey,
      this.keyPrefix,
      groupId,
      newStagedJobId,
      String(score),
      jobDataJson,
    );
  }

  /**
   * Get the signal key for BRPOP-based waiting.
   */
  getSignalKey(): string {
    return `${this.keyPrefix}signal`;
  }

  /**
   * Get the key prefix for metrics/recovery scans.
   */
  getKeyPrefix(): string {
    return this.keyPrefix;
  }
}
