/**
 * Lua script to atomically unblock a group.
 * Mirrors complete.lua: clears blocked + active state, recalculates
 * ready score so the dispatcher can pick the group up immediately.
 * Error info is intentionally preserved so Skynet can show the last
 * error while the group retries. The error key is cleaned up when
 * the group's next job succeeds (COMPLETE_LUA) or when the group
 * is drained / moved to DLQ.
 *
 * KEYS[1] = {queueName}:gq:blocked                 (set)
 * KEYS[2] = {queueName}:gq:group:{groupId}:active  (string)
 * KEYS[3] = {queueName}:gq:group:{groupId}:jobs    (sorted set)
 * KEYS[4] = {queueName}:gq:ready                   (sorted set)
 * KEYS[5] = {queueName}:gq:signal                  (list)
 * KEYS[6] = {queueName}:gq:group:{groupId}:error   (hash — NOT deleted)
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
    local score = 1
    redis.call("ZADD", readyKey, score, groupId)
  else
    redis.call("ZREM", readyKey, groupId)
  end

  redis.call("LPUSH", signalKey, "1")
  redis.call("LTRIM", signalKey, 0, 999)
end

return wasBlocked
`;

/**
 * Lua script to drain a group entirely.
 * Removes all staged jobs, data, active key, error info, and entries from ready/blocked sets.
 *
 * KEYS[1] = {queueName}:gq:group:{groupId}:jobs    (sorted set)
 * KEYS[2] = {queueName}:gq:group:{groupId}:data    (hash)
 * KEYS[3] = {queueName}:gq:group:{groupId}:active  (string)
 * KEYS[4] = {queueName}:gq:ready                   (sorted set)
 * KEYS[5] = {queueName}:gq:blocked                 (set)
 * KEYS[6] = {queueName}:gq:signal                  (list)
 * KEYS[7] = {queueName}:gq:group:{groupId}:error   (hash)
 * KEYS[8] = {queueName}:gq:stats:total-pending     (string counter)
 * ARGV[1] = groupId
 *
 * Returns: number of jobs removed
 */
export const DRAIN_GROUP_LUA = `
local jobsKey         = KEYS[1]
local dataKey         = KEYS[2]
local activeKey       = KEYS[3]
local readyKey        = KEYS[4]
local blockedKey      = KEYS[5]
local signalKey       = KEYS[6]
local errorKey        = KEYS[7]
local totalPendingKey = KEYS[8]
local groupId         = ARGV[1]

local count = redis.call("ZCARD", jobsKey)

redis.call("DEL", jobsKey)
redis.call("DEL", dataKey)
redis.call("DEL", activeKey)
redis.call("DEL", errorKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- Decrement total pending counter by drained jobs (only if counter exists to avoid negative on legacy queues)
if count > 0 and redis.call("EXISTS", totalPendingKey) == 1 then
  redis.call("DECRBY", totalPendingKey, count)
end

return count
`;

/**
 * Lua script to move a blocked group's jobs to a dead letter queue.
 * Copies job data instead of deleting it, then cleans up the original group.
 *
 * KEYS[1] = {queueName}:gq:group:{groupId}:jobs    (sorted set - source)
 * KEYS[2] = {queueName}:gq:group:{groupId}:data    (hash - source)
 * KEYS[3] = {queueName}:gq:group:{groupId}:active  (string)
 * KEYS[4] = {queueName}:gq:ready                   (sorted set)
 * KEYS[5] = {queueName}:gq:blocked                 (set)
 * KEYS[6] = {queueName}:gq:signal                  (list)
 * KEYS[7] = {queueName}:gq:group:{groupId}:error   (hash)
 * KEYS[8] = {queueName}:gq:dlq:{groupId}:jobs      (sorted set - dest)
 * KEYS[9] = {queueName}:gq:dlq:{groupId}:data      (hash - dest)
 * KEYS[10] = {queueName}:gq:dlq:{groupId}:error    (hash - dest)
 * KEYS[11] = {queueName}:gq:dlq                    (set - DLQ index)
 * ARGV[1] = groupId
 * ARGV[2] = TTL in seconds for DLQ keys (e.g. 604800 = 7 days)
 *
 * Returns: number of jobs moved
 */
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
local groupId      = ARGV[1]
local ttl          = tonumber(ARGV[2])

-- Copy jobs (sorted set)
local jobs = redis.call("ZRANGE", srcJobsKey, 0, -1, "WITHSCORES")
local count = #jobs / 2
if count > 0 then
  for i = 1, #jobs, 2 do
    redis.call("ZADD", dstJobsKey, jobs[i+1], jobs[i])
  end
end

-- Copy data (hash) - per-field to avoid unpack stack overflow
local data = redis.call("HGETALL", srcDataKey)
for i = 1, #data, 2 do
  redis.call("HSET", dstDataKey, data[i], data[i+1])
end

-- Copy error info
local errorData = redis.call("HGETALL", srcErrorKey)
for i = 1, #errorData, 2 do
  redis.call("HSET", dstErrorKey, errorData[i], errorData[i+1])
end

-- Set TTL on DLQ keys
if ttl > 0 then
  redis.call("EXPIRE", dstJobsKey, ttl)
  redis.call("EXPIRE", dstDataKey, ttl)
  redis.call("EXPIRE", dstErrorKey, ttl)
end

-- Add to DLQ index (no TTL on index — cleaned up on replay/drain)
redis.call("SADD", dlqIndexKey, groupId)

-- Clean up original group (same as drain)
redis.call("DEL", srcJobsKey)
redis.call("DEL", srcDataKey)
redis.call("DEL", activeKey)
redis.call("DEL", srcErrorKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

/**
 * Lua script to replay a group from DLQ back to the staging area.
 * Moves jobs from DLQ keys back to original group keys.
 *
 * KEYS[1] = {queueName}:gq:dlq:{groupId}:jobs      (sorted set - source)
 * KEYS[2] = {queueName}:gq:dlq:{groupId}:data      (hash - source)
 * KEYS[3] = {queueName}:gq:dlq:{groupId}:error     (hash - source)
 * KEYS[4] = {queueName}:gq:group:{groupId}:jobs     (sorted set - dest)
 * KEYS[5] = {queueName}:gq:group:{groupId}:data     (hash - dest)
 * KEYS[6] = {queueName}:gq:ready                    (sorted set)
 * KEYS[7] = {queueName}:gq:signal                   (list)
 * KEYS[8] = {queueName}:gq:dlq                      (set - DLQ index)
 * ARGV[1] = groupId
 *
 * Returns: number of jobs replayed
 */
export const REPLAY_FROM_DLQ_LUA = `
local dlqJobsKey   = KEYS[1]
local dlqDataKey   = KEYS[2]
local dlqErrorKey  = KEYS[3]
local dstJobsKey   = KEYS[4]
local dstDataKey   = KEYS[5]
local readyKey     = KEYS[6]
local signalKey    = KEYS[7]
local dlqIndexKey  = KEYS[8]
local groupId      = ARGV[1]

-- Copy jobs back
local jobs = redis.call("ZRANGE", dlqJobsKey, 0, -1, "WITHSCORES")
local count = #jobs / 2
if count > 0 then
  for i = 1, #jobs, 2 do
    redis.call("ZADD", dstJobsKey, jobs[i+1], jobs[i])
  end
end

-- Copy data back (batched to avoid unpack stack overflow)
local data = redis.call("HGETALL", dlqDataKey)
for i = 1, #data, 2 do
  redis.call("HSET", dstDataKey, data[i], data[i+1])
end

-- Clean up DLQ keys
redis.call("DEL", dlqJobsKey)
redis.call("DEL", dlqDataKey)
redis.call("DEL", dlqErrorKey)
redis.call("SREM", dlqIndexKey, groupId)

-- Add group to ready set with score 1
if count > 0 then
  redis.call("ZADD", readyKey, 1, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;
