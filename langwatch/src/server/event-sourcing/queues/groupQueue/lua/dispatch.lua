-- dispatch.lua: Atomically pick the highest-weight ready group and pop its oldest eligible job
--
-- KEYS[1] = {queueName}:gq:ready     (sorted set: ready groups, score = sqrt(pending))
-- KEYS[2] = {queueName}:gq:blocked   (set: blocked groupIds)
--
-- ARGV[1] = keyPrefix       ({queueName}:gq:)
-- ARGV[2] = nowMs           (current epoch ms for eligibility check)
-- ARGV[3] = activeTtlSec    (TTL in seconds for the active key)
--
-- Returns: {stagedJobId, groupId, jobDataJson} or nil if nothing to dispatch

local readyKey   = KEYS[1]
local blockedKey = KEYS[2]

local keyPrefix    = ARGV[1]
local nowMs        = tonumber(ARGV[2])
local activeTtlSec = tonumber(ARGV[3])

-- Get groups ordered by weight descending (highest score first)
local groups = redis.call("ZREVRANGE", readyKey, 0, -1)

for _, groupId in ipairs(groups) do
  -- Skip blocked groups
  if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
    -- Check if group has an active job
    local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
    local activeJob = redis.call("GET", activeKey)

    if not activeJob then
      -- No active job: pop the oldest eligible job (score <= nowMs)
      local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
      local results = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "LIMIT", 0, 1)

      if #results > 0 then
        local stagedJobId = results[1]

        -- Remove from pending set
        redis.call("ZREM", jobsKey, stagedJobId)

        -- Set active flag with TTL (safety net for crashes)
        redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

        -- Recalculate ready set score
        local pendingCount = redis.call("ZCARD", jobsKey)
        if pendingCount > 0 then
          local score = math.sqrt(pendingCount)
          redis.call("ZADD", readyKey, score, groupId)
        else
          -- No more pending jobs: remove from ready set
          redis.call("ZREM", readyKey, groupId)
        end

        -- Get job data
        local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
        local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
        redis.call("HDEL", dataKey, stagedJobId)

        return {stagedJobId, groupId, jobDataJson or ""}
      end
      -- Group has no eligible jobs yet (all delayed); skip to next group
    end
    -- Group has active job; skip to next group
  end
  -- Group is blocked; skip to next group
end

-- Nothing to dispatch
return nil
