-- fail.lua: Mark a group as blocked after exhausted retries
--
-- KEYS[1] = {queueName}:gq:blocked                  (set: blocked groupIds)
-- KEYS[2] = {queueName}:gq:group:{groupId}:active   (string: active stagedJobId)
--
-- ARGV[1] = groupId
-- ARGV[2] = stagedJobId  (for verification)
--
-- Returns: 1 = blocked, 0 = stale (active key doesn't match)

local blockedKey = KEYS[1]
local activeKey  = KEYS[2]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]

-- Only skip if a DIFFERENT job is active (stale worker).
-- Block if activeKey matches OR has expired (false in Redis Lua).
local currentActive = redis.call("GET", activeKey)
if currentActive and currentActive ~= stagedJobId then
  return 0 -- stale: a different job took over
end

-- Add group to blocked set (active key stays to keep group stalled)
redis.call("SADD", blockedKey, groupId)

return 1
