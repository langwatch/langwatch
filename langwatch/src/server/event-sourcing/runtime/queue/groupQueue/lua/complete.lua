-- complete.lua: Mark a group job as completed, clear active flag, signal dispatcher
--
-- KEYS[1] = {queueName}:gq:group:{groupId}:active   (string: active stagedJobId)
-- KEYS[2] = {queueName}:gq:group:{groupId}:jobs     (sorted set: pending jobs)
-- KEYS[3] = {queueName}:gq:ready                    (sorted set: ready groups)
-- KEYS[4] = {queueName}:gq:signal                   (list: dispatcher wakeup)
-- KEYS[5] = {queueName}:gq:blocked                  (set: blocked groupIds)
--
-- ARGV[1] = groupId
-- ARGV[2] = stagedJobId  (for verification)
--
-- Returns: 1 = completed, 0 = stale (active key doesn't match)

local activeKey  = KEYS[1]
local jobsKey    = KEYS[2]
local readyKey   = KEYS[3]
local signalKey  = KEYS[4]
local blockedKey = KEYS[5]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]

-- Verify the active job matches (prevent stale completions)
local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0 -- stale
end

-- Clear active flag
redis.call("DEL", activeKey)

-- Remove from blocked set if present (job succeeded after retry)
redis.call("SREM", blockedKey, groupId)

-- Recalculate ready set score
local pendingCount = redis.call("ZCARD", jobsKey)
if pendingCount > 0 then
  local score = math.sqrt(pendingCount)
  redis.call("ZADD", readyKey, score, groupId)
else
  -- No more pending: remove from ready set
  redis.call("ZREM", readyKey, groupId)
end

-- Signal dispatcher that a slot is free
redis.call("LPUSH", signalKey, "1")

return 1
