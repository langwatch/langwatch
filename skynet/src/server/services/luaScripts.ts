/**
 * Lua script to atomically unblock a group.
 * Mirrors complete.lua: clears blocked + active state, recalculates
 * ready score so the dispatcher can pick the group up immediately.
 *
 * KEYS[1] = {queueName}:gq:blocked                 (set)
 * KEYS[2] = {queueName}:gq:group:{groupId}:active  (string)
 * KEYS[3] = {queueName}:gq:group:{groupId}:jobs    (sorted set)
 * KEYS[4] = {queueName}:gq:ready                   (sorted set)
 * KEYS[5] = {queueName}:gq:signal                  (list)
 * ARGV[1] = groupId
 *
 * Returns: 1 = was blocked and unblocked, 0 = was not blocked
 */
export const UNBLOCK_LUA = `
local blockedKey = KEYS[1]
local activeKey  = KEYS[2]
local jobsKey    = KEYS[3]
local readyKey   = KEYS[4]
local signalKey  = KEYS[5]
local groupId    = ARGV[1]

local wasBlocked = redis.call("SREM", blockedKey, groupId)

if wasBlocked > 0 then
  redis.call("DEL", activeKey)

  local pendingCount = redis.call("ZCARD", jobsKey)
  if pendingCount > 0 then
    local score = math.sqrt(pendingCount)
    redis.call("ZADD", readyKey, score, groupId)
  else
    redis.call("ZREM", readyKey, groupId)
  end

  redis.call("LPUSH", signalKey, "1")
end

return wasBlocked
`;

/**
 * Lua script to drain a group entirely.
 * Removes all staged jobs, data, active key, and entries from ready/blocked sets.
 *
 * KEYS[1] = {queueName}:gq:group:{groupId}:jobs    (sorted set)
 * KEYS[2] = {queueName}:gq:group:{groupId}:data    (hash)
 * KEYS[3] = {queueName}:gq:group:{groupId}:active  (string)
 * KEYS[4] = {queueName}:gq:ready                   (sorted set)
 * KEYS[5] = {queueName}:gq:blocked                 (set)
 * KEYS[6] = {queueName}:gq:signal                  (list)
 * ARGV[1] = groupId
 *
 * Returns: number of jobs removed
 */
export const DRAIN_GROUP_LUA = `
local jobsKey    = KEYS[1]
local dataKey    = KEYS[2]
local activeKey  = KEYS[3]
local readyKey   = KEYS[4]
local blockedKey = KEYS[5]
local signalKey  = KEYS[6]
local groupId    = ARGV[1]

local count = redis.call("ZCARD", jobsKey)

redis.call("DEL", jobsKey)
redis.call("DEL", dataKey)
redis.call("DEL", activeKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")

return count
`;
