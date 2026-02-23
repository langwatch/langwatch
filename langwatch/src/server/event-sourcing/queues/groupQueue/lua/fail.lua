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

-- Verify the active job matches
local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0 -- stale
end

-- Add group to blocked set (active key stays to keep group stalled)
redis.call("SADD", blockedKey, groupId)

return 1
