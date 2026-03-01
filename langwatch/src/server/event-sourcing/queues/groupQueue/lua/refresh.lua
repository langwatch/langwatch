-- refresh.lua: Refresh the activeKey TTL during intermediate retries
--
-- Prevents the safety-net TTL from expiring before all retries complete,
-- which would cause dispatch.lua to see no active job and dispatch a new one.
--
-- KEYS[1] = {queueName}:gq:group:{groupId}:active   (string: active stagedJobId)
--
-- ARGV[1] = stagedJobId   (for verification)
-- ARGV[2] = activeTtlSec  (new TTL in seconds)
--
-- Returns: 1 = refreshed, 0 = stale (active key doesn't match)

local activeKey    = KEYS[1]
local stagedJobId  = ARGV[1]
local activeTtlSec = tonumber(ARGV[2])

local currentActive = redis.call("GET", activeKey)
if currentActive == stagedJobId then
  redis.call("EXPIRE", activeKey, activeTtlSec)
  return 1
end
return 0
