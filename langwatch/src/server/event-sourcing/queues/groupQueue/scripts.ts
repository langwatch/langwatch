import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

// Lua scripts inlined as string constants.
// This avoids loader incompatibilities across turbopack, webpack, vitest, and tsx.

const STAGE_LUA = `
local groupJobsKey = KEYS[1]
local readyKey     = KEYS[2]
local signalKey    = KEYS[3]
local dedupKey     = KEYS[4]
local dataKey      = KEYS[5]

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
    redis.call("HDEL", dataKey, existingJobId)
    redis.call("HSET", dataKey, stagedJobId, jobDataJson)
    redis.call("ZADD", readyKey, 1, groupId)
    redis.call("LPUSH", signalKey, "1")
    redis.call("LTRIM", signalKey, 0, 999)
    return 0
  end
end

redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
redis.call("HSET", dataKey, stagedJobId, jobDataJson)

if dedupId ~= "" and dedupTtlMs > 0 then
  redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
end

redis.call("ZADD", readyKey, 1, groupId)

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

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
  redis.call("ZADD", readyKey, 1, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return newStagedCount
`;

const DISPATCH_LUA = `
local readyKey     = KEYS[1]
local blockedKey   = KEYS[2]
local pausedJobKey = KEYS[3]

local keyPrefix    = ARGV[1]
local nowMs        = tonumber(ARGV[2])
local activeTtlSec = tonumber(ARGV[3])

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local scanStart = 0
local scanEnd = 99
local maxPasses = hasPauses and 5 or 3

for pass = 1, maxPasses do
  local groups = redis.call("ZREVRANGE", readyKey, scanStart, scanEnd)
  if #groups == 0 then break end

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

          -- Check pause status before dequeuing
          local paused = false
          if hasPauses then
            local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
            local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
            if jobDataJson then
              local ok, data = pcall(cjson.decode, jobDataJson)
              if ok and type(data) == "table" then
                local p = data["__pipelineName"]
                local t = data["__jobType"]
                local n = data["__jobName"]
                local pIsStr = type(p) == "string"
                local tIsStr = type(t) == "string"
                local nIsStr = type(n) == "string"
                if pIsStr then
                  if redis.call("SISMEMBER", pausedJobKey, p) == 1 then paused = true
                  elseif tIsStr and redis.call("SISMEMBER", pausedJobKey, p .. "/" .. t) == 1 then paused = true
                  elseif tIsStr and nIsStr and redis.call("SISMEMBER", pausedJobKey, p .. "/" .. t .. "/" .. n) == 1 then paused = true
                  end
                end
              end
            end
          end

          if not paused then
            redis.call("ZREM", jobsKey, stagedJobId)
            redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

            local pendingCount = redis.call("ZCARD", jobsKey)
            if pendingCount > 0 then
              redis.call("ZADD", readyKey, 1, groupId)
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
  end

  scanStart = scanEnd + 1
  scanEnd = scanEnd + 100
end

return nil
`;

const DISPATCH_BATCH_LUA = `
local readyKey     = KEYS[1]
local blockedKey   = KEYS[2]
local pausedJobKey = KEYS[3]

local keyPrefix      = ARGV[1]
local nowMs          = tonumber(ARGV[2])
local activeTtlSec   = tonumber(ARGV[3])
local maxJobs        = tonumber(ARGV[4])
local randomOffset   = tonumber(ARGV[5]) or 0

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local scanWindow = maxJobs * 3
local maxPasses = hasPauses and 5 or 3
local results = {}
local dispatched = 0
local readySize = redis.call("ZCARD", readyKey)
local scanStart = (readySize > 0) and (randomOffset % readySize) or 0

for pass = 1, maxPasses do
  if dispatched >= maxJobs then break end

  local scanEnd = scanStart + scanWindow - 1
  local groups = redis.call("ZREVRANGE", readyKey, scanStart, scanEnd)
  if #groups == 0 then break end

  for _, groupId in ipairs(groups) do
    if dispatched >= maxJobs then break end

    if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
      local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
      local activeJob = redis.call("GET", activeKey)

      if not activeJob then
        local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
        local jobResults = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, 1)

        if #jobResults >= 2 then
          local stagedJobId = jobResults[1]
          local originalScore = jobResults[2]

          -- Check pause status before dequeuing
          local paused = false
          if hasPauses then
            local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
            local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
            if jobDataJson then
              local ok, data = pcall(cjson.decode, jobDataJson)
              if ok and type(data) == "table" then
                local p = data["__pipelineName"]
                local t = data["__jobType"]
                local n = data["__jobName"]
                local pIsStr = type(p) == "string"
                local tIsStr = type(t) == "string"
                local nIsStr = type(n) == "string"
                if pIsStr then
                  if redis.call("SISMEMBER", pausedJobKey, p) == 1 then paused = true
                  elseif tIsStr and redis.call("SISMEMBER", pausedJobKey, p .. "/" .. t) == 1 then paused = true
                  elseif tIsStr and nIsStr and redis.call("SISMEMBER", pausedJobKey, p .. "/" .. t .. "/" .. n) == 1 then paused = true
                  end
                end
              end
            end
          end

          if not paused then
            redis.call("ZREM", jobsKey, stagedJobId)
            redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

            local pendingCount = redis.call("ZCARD", jobsKey)
            if pendingCount > 0 then
              redis.call("ZADD", readyKey, 1, groupId)
            else
              redis.call("ZREM", readyKey, groupId)
            end

            local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
            local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
            redis.call("HDEL", dataKey, stagedJobId)

            results[#results + 1] = stagedJobId
            results[#results + 1] = groupId
            results[#results + 1] = jobDataJson or ""
            results[#results + 1] = tostring(originalScore)
            dispatched = dispatched + 1
          end
        end
      end
    end
  end

  scanStart = scanStart + scanWindow
end

return results
`;

const COMPLETE_LUA = `
local activeKey  = KEYS[1]
local jobsKey    = KEYS[2]
local readyKey   = KEYS[3]
local signalKey  = KEYS[4]
local statsKey   = KEYS[5]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]

local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

redis.call("DEL", activeKey)

local pendingCount = redis.call("ZCARD", jobsKey)
if pendingCount > 0 then
  redis.call("ZADD", readyKey, 1, groupId)
else
  redis.call("ZREM", readyKey, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- Increment completed counter for Skynet
redis.call("INCR", statsKey)

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

const RESTAGE_AND_BLOCK_LUA = `
local blockedKey = KEYS[1]
local readyKey   = KEYS[2]
local statsKey   = KEYS[3]

local keyPrefix       = ARGV[1]
local groupId         = ARGV[2]
local newStagedJobId  = ARGV[3]
local score           = tonumber(ARGV[4])
local jobDataJson     = ARGV[5]
local errorMessage    = ARGV[6]
local errorStack      = ARGV[7]

local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"

-- 1. Block the group — prevents dispatcher from re-dispatching
redis.call("SADD", blockedKey, groupId)

-- 2. Re-stage the failed job with a new ID
redis.call("ZADD", groupJobsKey, score, newStagedJobId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)

-- 3. Remove from ready set — blocked groups should not be scanned by dispatch.
--    UNBLOCK_LUA re-adds the group when it is unblocked.
redis.call("ZREM", readyKey, groupId)

-- 4. Store error info for Skynet visibility
if errorMessage and errorMessage ~= "" then
  local errorKey = keyPrefix .. "group:" .. groupId .. ":error"
  redis.call("HSET", errorKey, "message", errorMessage, "stack", errorStack or "", "timestamp", tostring(score))
end

-- 5. Increment failed counter for Skynet
redis.call("INCR", statsKey)

return 1
`;

const RETRY_RESTAGE_LUA = `
local activeKey = KEYS[1]

local keyPrefix       = ARGV[1]
local groupId         = ARGV[2]
local stagedJobId     = ARGV[3]
local newStagedJobId  = ARGV[4]
local dispatchAfterMs = tonumber(ARGV[5])
local jobDataJson     = ARGV[6]
local retryTtlSec     = tonumber(ARGV[7])

-- 1. Validate active key matches
local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

-- 2. Re-stage job with future score (backoff delay)
local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"
redis.call("ZADD", groupJobsKey, dispatchAfterMs, newStagedJobId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)

-- 3. Update ready set score
local readyKey = keyPrefix .. "ready"
redis.call("ZADD", readyKey, 1, groupId)

-- 4. Set active key TTL to match backoff period.
--    While the key exists the group is locked (preserves FIFO ordering).
--    When it expires the dispatcher picks up the retry job on its next poll.
redis.call("EXPIRE", activeKey, retryTtlSec)

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
 * TypeScript wrapper for the group queue Lua scripts.
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

    const dataKey = `${this.keyPrefix}group:${groupId}:data`;

    const result = await this.redis.eval(
      STAGE_LUA,
      5,
      groupJobsKey,
      readyKey,
      signalKey,
      dedupKey,
      dataKey,
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
    const pausedJobKey = `${this.keyPrefix}paused-jobs`;

    const result = await this.redis.eval(
      DISPATCH_LUA,
      3,
      readyKey,
      blockedKey,
      pausedJobKey,
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
   * Pick eligible groups and dispatch up to maxJobs in a single atomic Lua call.
   * Returns an array of dispatch results (may be empty).
   */
  async dispatchBatch({
    nowMs,
    activeTtlSec,
    maxJobs,
    randomOffset,
  }: {
    nowMs: number;
    activeTtlSec: number;
    maxJobs: number;
    randomOffset?: number;
  }): Promise<DispatchResult[]> {
    const readyKey = `${this.keyPrefix}ready`;
    const blockedKey = `${this.keyPrefix}blocked`;
    const pausedJobKey = `${this.keyPrefix}paused-jobs`;

    const result = await this.redis.eval(
      DISPATCH_BATCH_LUA,
      3,
      readyKey,
      blockedKey,
      pausedJobKey,
      this.keyPrefix,
      String(nowMs),
      String(activeTtlSec),
      String(maxJobs),
      String(randomOffset ?? 0),
    );

    if (!result || !Array.isArray(result) || result.length < 4) {
      return [];
    }

    const dispatched: DispatchResult[] = [];
    for (let i = 0; i < result.length; i += 4) {
      dispatched.push({
        stagedJobId: String(result[i]),
        groupId: String(result[i + 1]),
        jobDataJson: String(result[i + 2]),
        originalScore: Number(result[i + 3]),
      });
    }

    return dispatched;
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
    const statsKey = `${this.keyPrefix}stats:completed`;

    const result = await this.redis.eval(
      COMPLETE_LUA,
      5,
      activeKey,
      jobsKey,
      readyKey,
      signalKey,
      statsKey,
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
   * Atomically block a group and re-stage a failed job after exhausted retries.
   * Combines blocking, re-staging, and ready-score update in a single Lua call.
   */
  async restageAndBlock({
    groupId,
    newStagedJobId,
    score,
    jobDataJson,
    errorMessage,
    errorStack,
  }: {
    groupId: string;
    newStagedJobId: string;
    score: number;
    jobDataJson: string;
    errorMessage?: string;
    errorStack?: string;
  }): Promise<void> {
    const blockedKey = `${this.keyPrefix}blocked`;
    const readyKey = `${this.keyPrefix}ready`;
    const statsKey = `${this.keyPrefix}stats:failed`;

    await this.redis.eval(
      RESTAGE_AND_BLOCK_LUA,
      3,
      blockedKey,
      readyKey,
      statsKey,
      this.keyPrefix,
      groupId,
      newStagedJobId,
      String(score),
      jobDataJson,
      errorMessage ?? "",
      errorStack ?? "",
    );
  }

  /**
   * Re-stage a job with a future dispatch score (backoff delay) while keeping
   * the active key alive to preserve per-group FIFO ordering. The fastq worker
   * slot is freed immediately.
   *
   * The active key TTL is set to match the backoff period so the key expires
   * naturally. On the next dispatcher poll (≤1s) the retry job is dispatched.
   * This is fully Redis-driven — no Node.js timers, survives restarts.
   *
   * @returns true if re-staged, false if stale (active key doesn't match)
   */
  async retryRestage({
    groupId,
    stagedJobId,
    newStagedJobId,
    dispatchAfterMs,
    jobDataJson,
    backoffMs,
  }: {
    groupId: string;
    stagedJobId: string;
    newStagedJobId: string;
    dispatchAfterMs: number;
    jobDataJson: string;
    backoffMs: number;
  }): Promise<boolean> {
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;
    // TTL = backoff + 2s buffer so the key expires just after the job becomes eligible
    const retryTtlSec = Math.ceil(backoffMs / 1000) + 2;

    const result = await this.redis.eval(
      RETRY_RESTAGE_LUA,
      1,
      activeKey,
      this.keyPrefix,
      groupId,
      stagedJobId,
      newStagedJobId,
      String(dispatchAfterMs),
      jobDataJson,
      String(retryTtlSec),
    );

    return result === 1;
  }

  /**
   * Get all paused keys from the pause set.
   */
  async getPausedKeys(): Promise<string[]> {
    return this.redis.smembers(`${this.keyPrefix}paused-jobs`);
  }

  /**
   * Add a pause key to the pause set.
   */
  async addPauseKey(key: string): Promise<void> {
    await this.redis.sadd(`${this.keyPrefix}paused-jobs`, key);
  }

  /**
   * Remove a pause key from the pause set.
   */
  async removePauseKey(key: string): Promise<void> {
    await this.redis.srem(`${this.keyPrefix}paused-jobs`, key);
  }

  /**
   * Retrieve stored error info for a blocked group.
   *
   * @returns error info or null if no error is stored
   */
  async getGroupError(groupId: string): Promise<{
    message: string;
    stack: string;
    timestamp: string;
  } | null> {
    const errorKey = `${this.keyPrefix}group:${groupId}:error`;
    const result = await this.redis.hgetall(errorKey);

    if (!result || !result.message) {
      return null;
    }

    return {
      message: result.message,
      stack: result.stack ?? "",
      timestamp: result.timestamp ?? "",
    };
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

