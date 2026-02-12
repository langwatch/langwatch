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
      local results = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "LIMIT", 0, 1)

      if #results > 0 then
        local stagedJobId = results[1]
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

        return {stagedJobId, groupId, jobDataJson or ""}
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
redis.call("SREM", blockedKey, groupId)

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

const FAIL_LUA = `
local blockedKey = KEYS[1]
local activeKey  = KEYS[2]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]

local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

redis.call("SADD", blockedKey, groupId)

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
}

/**
 * TypeScript wrapper for the 4 group queue Lua scripts.
 * All Redis keys use the `{queueName}` hash tag for Redis Cluster compatibility.
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

    if (!result || !Array.isArray(result) || result.length < 3) {
      return null;
    }

    return {
      stagedJobId: String(result[0]),
      groupId: String(result[1]),
      jobDataJson: String(result[2]),
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
   * Mark a group as blocked after exhausted retries.
   *
   * @returns true if blocked, false if stale
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
