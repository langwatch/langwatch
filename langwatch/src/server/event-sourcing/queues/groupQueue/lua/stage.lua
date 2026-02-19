-- stage.lua: Atomically stage a job into the group queue
--
-- KEYS[1] = {queueName}:gq:group:{groupId}:jobs        (sorted set: pending jobs)
-- KEYS[2] = {queueName}:gq:ready                        (sorted set: ready groups)
-- KEYS[3] = {queueName}:gq:signal                       (list: dispatcher wakeup)
-- KEYS[4] = {queueName}:gq:dedup:{dedupId}              (string: dedup mapping, optional)
--
-- ARGV[1] = stagedJobId       (unique ID for this staged job)
-- ARGV[2] = groupId           (group key for this job)
-- ARGV[3] = dispatchAfterMs   (score for the sorted set, epoch ms when eligible)
-- ARGV[4] = dedupId           (dedup ID, or empty string if no dedup)
-- ARGV[5] = dedupTtlMs        (dedup TTL in ms, or "0" if no dedup)
-- ARGV[6] = jobDataJson       (serialized job payload)
--
-- Returns: 1 = staged, 0 = deduped (replaced existing)

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

-- Check dedup: if dedupId is set, check for existing job
if dedupId ~= "" and dedupTtlMs > 0 then
  local existingJobId = redis.call("GET", dedupKey)
  if existingJobId then
    -- Replace the existing job's data and update its score (debounce)
    -- Remove old entry and add new one with updated score
    redis.call("ZREM", groupJobsKey, existingJobId)
    redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)

    -- Update dedup mapping to point to new job
    redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)

    -- Store job data as a hash field on the group jobs key's companion
    -- We use a separate hash key for job data: {queueName}:gq:group:{groupId}:data
    local dataKey = string.gsub(groupJobsKey, ":jobs$", ":data")
    -- Remove old job data, add new
    redis.call("HDEL", dataKey, existingJobId)
    redis.call("HSET", dataKey, stagedJobId, jobDataJson)

    -- Update ready set score
    local pendingCount = redis.call("ZCARD", groupJobsKey)
    local score = math.sqrt(pendingCount)
    redis.call("ZADD", readyKey, score, groupId)

    -- Signal dispatcher
    redis.call("LPUSH", signalKey, "1")

    return 0 -- deduped
  end
end

-- No dedup or no existing job: add new job
redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)

-- Store job data
local dataKey = string.gsub(groupJobsKey, ":jobs$", ":data")
redis.call("HSET", dataKey, stagedJobId, jobDataJson)

-- Set dedup mapping if configured
if dedupId ~= "" and dedupTtlMs > 0 then
  redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
end

-- Update ready set score: sqrt(pendingCount)
local pendingCount = redis.call("ZCARD", groupJobsKey)
local score = math.sqrt(pendingCount)
redis.call("ZADD", readyKey, score, groupId)

-- Signal dispatcher that work is available
redis.call("LPUSH", signalKey, "1")

return 1 -- staged
