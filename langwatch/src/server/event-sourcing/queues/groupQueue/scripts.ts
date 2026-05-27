import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

// Lua scripts inlined as string constants.
// This avoids loader incompatibilities across turbopack, webpack, vitest, and tsx.

/**
 * Safety-net TTL (ms) refreshed on the per-group jobs/data keys every time they
 * are written or dispatched. A live group is touched far more often than this
 * (max gap between touches is one retry backoff, ~10 min), so the TTL never
 * fires on real work. A group that falls out of the dispatch graph without
 * draining (e.g. the ready set is cleared during incident mitigation) keeps its
 * keys today forever; with the TTL they self-expire instead of accumulating.
 * Interpolated into the Lua source so there is a single source of truth.
 */
export const GROUP_KEY_TTL_MS = 6 * 60 * 60 * 1000;

// Lua helper, prepended to every script that writes group keys. Refreshes the
// safety-net TTL on a group's jobs/data keys, deriving expiry from the LATEST
// pending dispatch score so a job legitimately delayed past the window (e.g. a
// monitor thread-idle timeout hours out) is never reaped before it is due. The
// expiry is the later of (now + window) and (latest scheduled dispatch + window).
export const TTL_HELPER_LUA = `
local function refreshGroupKeyTtl(jobsKey, dataKey, nowMs)
  local latest = redis.call("ZRANGE", jobsKey, -1, -1, "WITHSCORES")
  if not latest[2] then return end
  local ttl = ${GROUP_KEY_TTL_MS}
  local untilDue = (tonumber(latest[2]) - nowMs) + ${GROUP_KEY_TTL_MS}
  if untilDue > ttl then ttl = untilDue end
  redis.call("PEXPIRE", jobsKey, ttl)
  redis.call("PEXPIRE", dataKey, ttl)
end
`;

// Lua helper for the tenant soft-cap "parking" model, prepended to every script
// that writes the ready set. Over-cap groups are moved OUT of ready into a
// per-tenant parked zset ONCE (not re-scored every poll), so the dispatch scan
// never re-sees them and the write volume no longer scales with backlog size.
// They are restored when the tenant's in-flight count drops below the cap.
//
// Invariant: a group is in exactly one of {ready, parked, blocked, active}.
// Every ready-writer routes through addToReadyOrParked so a stage/unblock/retry/
// complete-restage can never clobber a parked group back into the dispatch scan
// (which is what re-creates the over-cap ZADD storm). The parked set and the
// parked-tenants registry share the same hash tag as ready (keyPrefix carries
// it), so all keys stay in one Redis Cluster slot.
export const PARK_HELPER_LUA = `
-- Tenant segment of a groupId (everything before the first '/'), else the id.
local function parkTenantOf(groupId)
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then return string.sub(groupId, 1, slashPos - 1) end
  return groupId
end

-- readyKey is always keyPrefix .. "ready"; recover keyPrefix so the parked keys
-- can be derived without threading an extra ARGV through every script.
local function parkKeyPrefixOf(readyKey)
  return string.sub(readyKey, 1, #readyKey - 5)
end

-- Route a ready-write to the parked set instead when the group is already
-- parked, preserving the parked state (cap-free: only DISPATCH/COMPLETE decide
-- to park/unpark). useLT mirrors the call site's ZADD semantics.
local function addToReadyOrParked(readyKey, groupId, score, useLT)
  local kp = parkKeyPrefixOf(readyKey)
  local parkedKey = kp .. "parked:" .. parkTenantOf(groupId)
  local target = readyKey
  if redis.call("ZSCORE", parkedKey, groupId) then target = parkedKey end
  if useLT then
    redis.call("ZADD", target, "LT", score, groupId)
  else
    redis.call("ZADD", target, score, groupId)
  end
end

-- Move an over-cap group out of ready into its tenant's parked set, preserving
-- its ready score so it keeps priority when restored. Registers the tenant so
-- the dispatch-tail reconcile can find it even if no COMPLETE ever fires.
local function parkGroup(readyKey, groupId)
  local score = redis.call("ZSCORE", readyKey, groupId)
  if not score then return end
  local kp = parkKeyPrefixOf(readyKey)
  local tenantId = parkTenantOf(groupId)
  redis.call("ZREM", readyKey, groupId)
  redis.call("ZADD", kp .. "parked:" .. tenantId, score, groupId)
  redis.call("SADD", kp .. "parked-tenants", tenantId)
end

-- Restore up to "slots" of a tenant's parked groups (lowest score = earliest
-- due first) back into ready. Self-limiting: callers pass slots = cap - active
-- so COMPLETE-unpark and the dispatch-tail reconcile can never over-unpark into
-- a re-park churn (TRAP 3). Returns how many were moved.
local function unparkUpTo(readyKey, tenantId, slots)
  if slots <= 0 then return 0 end
  local kp = parkKeyPrefixOf(readyKey)
  local parkedKey = kp .. "parked:" .. tenantId
  local members = redis.call("ZRANGE", parkedKey, 0, slots - 1, "WITHSCORES")
  local moved = 0
  for i = 1, #members, 2 do
    redis.call("ZREM", parkedKey, members[i])
    redis.call("ZADD", readyKey, tonumber(members[i + 1]), members[i])
    moved = moved + 1
  end
  if redis.call("ZCARD", parkedKey) == 0 then
    redis.call("SREM", kp .. "parked-tenants", tenantId)
  end
  return moved
end
`;

const STAGE_LUA = TTL_HELPER_LUA + PARK_HELPER_LUA + `
local groupJobsKey    = KEYS[1]
local readyKey        = KEYS[2]
local signalKey       = KEYS[3]
local dedupKey        = KEYS[4]
local dataKey         = KEYS[5]
local totalPendingKey = KEYS[6]
local activeKey       = KEYS[7]
local blockedKey      = KEYS[8]

local stagedJobId    = ARGV[1]
local groupId        = ARGV[2]
local dispatchAfter  = tonumber(ARGV[3])
local dedupId        = ARGV[4]
local dedupTtlMs     = tonumber(ARGV[5])
local jobDataJson    = ARGV[6]
local shouldExtend   = tonumber(ARGV[7])
local shouldReplace  = tonumber(ARGV[8])
local nowMs          = tonumber(ARGV[9])

-- Skip ready-score updates while the group is processing (active key set) or
-- blocked. In those states the ready score is owned by REFRESH_LUA / COMPLETE_LUA
-- (active) or by UNBLOCK (blocked). Lowering it here would re-expose the group
-- to ZRANGEBYSCORE before the next heartbeat refreshes it.
local function shouldUpdateReady()
  if redis.call("EXISTS", activeKey) == 1 then return false end
  if redis.call("SISMEMBER", blockedKey, groupId) == 1 then return false end
  return true
end

if dedupId ~= "" and dedupTtlMs > 0 then
  local existingJobId = redis.call("GET", dedupKey)
  if existingJobId then
    local rank = redis.call("ZRANK", groupJobsKey, existingJobId)
    if rank then
      -- Still in staging: squash in place (net zero pending count change)
      if shouldExtend == 1 then
        redis.call("ZADD", groupJobsKey, dispatchAfter, existingJobId)
      end
      if shouldReplace == 1 then
        redis.call("HSET", dataKey, existingJobId, jobDataJson)
      end
      redis.call("SET", dedupKey, existingJobId, "PX", dedupTtlMs)
      -- Score = earliest pending dispatchAfter (LT keeps the smallest score per group)
      if shouldUpdateReady() then
        addToReadyOrParked(readyKey, groupId, dispatchAfter, true)
      end
      refreshGroupKeyTtl(groupJobsKey, dataKey, nowMs)
      redis.call("LPUSH", signalKey, "1")
      redis.call("LTRIM", signalKey, 0, 999)
      return 0
    end
    -- Already dispatched: dedup key is stale, clean it up
    redis.call("DEL", dedupKey)
  end
end

redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
redis.call("HSET", dataKey, stagedJobId, jobDataJson)
refreshGroupKeyTtl(groupJobsKey, dataKey, nowMs)

if dedupId ~= "" and dedupTtlMs > 0 then
  redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
end

-- Score = earliest pending dispatchAfter (LT keeps the smallest score per group)
if shouldUpdateReady() then
  redis.call("ZADD", readyKey, "LT", dispatchAfter, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- New job staged: increment total pending counter
redis.call("INCR", totalPendingKey)

return 1
`;

const STAGE_BATCH_LUA = TTL_HELPER_LUA + `
local readyKey        = KEYS[1]
local signalKey       = KEYS[2]
local totalPendingKey = KEYS[3]

local keyPrefix = ARGV[1]
local count     = tonumber(ARGV[2])
-- nowMs is appended after all per-job args, so it is always the last element.
local nowMs     = tonumber(ARGV[#ARGV])

local newStagedCount = 0
local affectedGroups = {}

for i = 1, count do
  local offset = 2 + (i - 1) * 8
  local stagedJobId   = ARGV[offset + 1]
  local groupId       = ARGV[offset + 2]
  local dispatchAfter = tonumber(ARGV[offset + 3])
  local dedupId       = ARGV[offset + 4]
  local dedupTtlMs    = tonumber(ARGV[offset + 5])
  local jobDataJson   = ARGV[offset + 6]
  local shouldExtend  = tonumber(ARGV[offset + 7])
  local shouldReplace = tonumber(ARGV[offset + 8])

  local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
  local dataKey      = keyPrefix .. "group:" .. groupId .. ":data"
  local dedupKey     = (dedupId ~= "") and (keyPrefix .. "dedup:" .. dedupId) or (keyPrefix .. "dedup:__none__")

  local isDeduped = false
  if dedupId ~= "" and dedupTtlMs > 0 then
    local existingJobId = redis.call("GET", dedupKey)
    if existingJobId then
      local rank = redis.call("ZRANK", groupJobsKey, existingJobId)
      if rank then
        -- Still in staging: squash in place
        if shouldExtend == 1 then
          redis.call("ZADD", groupJobsKey, dispatchAfter, existingJobId)
        end
        if shouldReplace == 1 then
          redis.call("HSET", dataKey, existingJobId, jobDataJson)
        end
        redis.call("SET", dedupKey, existingJobId, "PX", dedupTtlMs)
        isDeduped = true
      else
        -- Already dispatched: dedup key is stale, clean it up
        redis.call("DEL", dedupKey)
      end
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

  refreshGroupKeyTtl(groupJobsKey, dataKey, nowMs)

  -- Track minimum dispatchAfter per affected group
  local existingMin = affectedGroups[groupId]
  if existingMin == nil or dispatchAfter < existingMin then
    affectedGroups[groupId] = dispatchAfter
  end
end

local blockedKey = keyPrefix .. "blocked"
for groupId, minScore in pairs(affectedGroups) do
  -- Score = earliest pending dispatchAfter (LT keeps the smallest).
  -- Skip when the group is processing or blocked — the active heartbeat /
  -- completion / unblock paths own the score in those states. Lowering it
  -- here would re-expose the group to ZRANGEBYSCORE before the next refresh.
  local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
  if redis.call("EXISTS", activeKey) == 0 and redis.call("SISMEMBER", blockedKey, groupId) == 0 then
    redis.call("ZADD", readyKey, "LT", minScore, groupId)
  end
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- Increment total pending counter by number of new (non-deduped) jobs
if newStagedCount > 0 then
  redis.call("INCRBY", totalPendingKey, newStagedCount)
end

return newStagedCount
`;

const DISPATCH_LUA = `
local readyKey         = KEYS[1]
local blockedKey       = KEYS[2]
local pausedJobKey     = KEYS[3]
local totalPendingKey  = KEYS[4]

local keyPrefix    = ARGV[1]
local nowMs        = tonumber(ARGV[2])
local activeTtlSec = tonumber(ARGV[3])
-- Tenant soft-cap (post-2026-05-11 incident follow-up). When > 0, the
-- scheduler refuses to dispatch a group whose tenant already has >=
-- tenantCap groups in flight. Defaults to 50 in TS (see
-- DEFAULT_TENANT_CAP); operators can set LANGWATCH_DISPATCH_TENANT_CAP=0
-- as an explicit kill switch, or to a higher integer to retune.
-- The tenantId is derived from groupId prefix (segment before first '/').
local tenantCap    = tonumber(ARGV[4]) or 0

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local activeUntil = nowMs + activeTtlSec * 1000

-- Pull only groups whose earliest job is due now (legacy entries with score=1 also pass).
-- Active groups carry future scores (nowMs + activeTtlSec*1000) and are excluded.
-- Page through the ready zset so a head full of paused / blocked / legacy-drift
-- entries does not cause dispatch to return nil while eligible work exists later.
local pageSize = 200
-- Default scan budget bounds the worst-case cost of a single dispatch
-- call. When the tenant soft-cap is enabled we widen it so a head full
-- of one tenant's over-cap groups (which we correctly skip but still
-- count against the budget) cannot starve other tenants deeper in the
-- zset. This is the explicit cost of the cap: more work per poll, in
-- exchange for cross-tenant fairness.
local scanBudget = 1000
if tenantCap > 0 then scanBudget = 10000 end
local offset = 0

-- Cache tenant cap lookups within this EVAL to avoid redundant GETs.
local tenantCapCache = {}

while offset < scanBudget do
  local groups = redis.call("ZRANGEBYSCORE", readyKey, "-inf", nowMs, "LIMIT", offset, pageSize)
  if #groups == 0 then return nil end

  for _, groupId in ipairs(groups) do
    if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
      -- Tenant soft-cap check (no-op when tenantCap == 0).
      local tenantOverCap = false
      local tenantCountKey = nil
      if tenantCap > 0 then
        local slashPos = string.find(groupId, "/", 1, true)
        if slashPos and slashPos > 1 then
          local tenantId = string.sub(groupId, 1, slashPos - 1)
          tenantCountKey = keyPrefix .. "tenant_active:" .. tenantId
          local cached = tenantCapCache[tenantId]
          if cached == nil then
            local n = tonumber(redis.call("GET", tenantCountKey)) or 0
            cached = n >= tenantCap
            tenantCapCache[tenantId] = cached
          end
          if cached then
            tenantOverCap = true
            -- Defer over-cap group past the dispatch window so subsequent
            -- polls reach other tenants without re-scanning this group.
            -- 5s ≈ one poll cycle; group becomes eligible again naturally.
            redis.call("ZADD", readyKey, nowMs + 5000, groupId)
          end
        end
      end

      local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
      -- Defensive activeKey check — covers legacy state during migration
      -- and the small race between ZADD ready and ZADD active.
      local activeJob = redis.call("GET", activeKey)
      if (not activeJob) and (not tenantOverCap) then
        local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
        local results = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, 1)

        if #results >= 2 then
          local stagedJobId = results[1]
          local originalScore = results[2]

          -- Check pause status before dequeuing
          local paused = false
          if hasPauses then
            -- Tenant-level pause: derived from groupId prefix (everything
            -- before the first "/"). Added post-2026-05-11 incident so an
            -- operator can halt ALL processing for a runaway tenant without
            -- touching pipeline names. Pause key format: "tenant:<tenantId>".
            local slashIdx = string.find(groupId, "/", 1, true)
            local tenantId = slashIdx and string.sub(groupId, 1, slashIdx - 1) or groupId
            if redis.call("SISMEMBER", pausedJobKey, "tenant:" .. tenantId) == 1 then
              paused = true
            end

            if not paused then
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
          end

          if not paused then
            redis.call("ZREM", jobsKey, stagedJobId)
            redis.call("DECR", totalPendingKey)
            redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

            -- Mark group as actively-processing in ready zset (future score suppresses redispatch).
            -- If process crashes, heartbeat stops, score becomes past, group becomes dispatchable again.
            redis.call("ZADD", readyKey, activeUntil, groupId)

            -- Tenant in-flight counter (back-compat: only when cap is set).
            if tenantCap > 0 and tenantCountKey then
              redis.call("INCR", tenantCountKey)
              redis.call("EXPIRE", tenantCountKey, activeTtlSec)
            end

            local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
            local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
            redis.call("HDEL", dataKey, stagedJobId)

            return {stagedJobId, groupId, jobDataJson or "", originalScore}
          end
        else
          -- Group is in ready but has no due jobs — drift cleanup.
          local pendingCount = redis.call("ZCARD", jobsKey)
          if pendingCount == 0 then
            redis.call("ZREM", readyKey, groupId)
          else
            -- All jobs are future-scheduled; re-score ready with earliest job's score
            local nextScore = redis.call("ZRANGE", jobsKey, 0, 0, "WITHSCORES")
            if #nextScore >= 2 then
              redis.call("ZADD", readyKey, tonumber(nextScore[2]), groupId)
            end
          end
        end
      end
    end
  end

  if #groups < pageSize then return nil end
  offset = offset + pageSize
end

return nil
`;

const DISPATCH_BATCH_LUA = `
local readyKey         = KEYS[1]
local blockedKey       = KEYS[2]
local pausedJobKey     = KEYS[3]
local totalPendingKey  = KEYS[4]

local keyPrefix      = ARGV[1]
local nowMs          = tonumber(ARGV[2])
local activeTtlSec   = tonumber(ARGV[3])
local maxJobs        = tonumber(ARGV[4])
-- Tenant soft-cap (post-2026-05-11 follow-up). See DISPATCH_LUA comment.
local tenantCap      = tonumber(ARGV[5]) or 0

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local activeUntil = nowMs + activeTtlSec * 1000
local results = {}
local dispatched = 0

-- Pull only groups whose earliest job is due now. Active groups carry future
-- scores so they are naturally excluded. Over-fetch by 3x (min 30) per page to
-- leave headroom for blocked/paused/legacy-drift groups, then page through up
-- to scanBudget total entries so a head full of paused/blocked groups does
-- not starve runnable groups deeper in the zset.
local pageSize = maxJobs * 3
if pageSize < 30 then pageSize = 30 end
local scanBudget = pageSize * 5
-- See DISPATCH_LUA: widen scan budget when the tenant cap is on so a
-- head full of one over-cap tenant cannot starve other tenants.
if tenantCap > 0 then scanBudget = pageSize * 50 end
local offset = 0

-- Cache tenant cap lookups within this EVAL to avoid redundant GETs.
-- When 1,800 groups belong to one over-cap tenant, this turns 1,800
-- GET calls into 1 GET + 1,799 table lookups.
local tenantCapCache = {}

while offset < scanBudget and dispatched < maxJobs do
  local groups = redis.call("ZRANGEBYSCORE", readyKey, "-inf", nowMs, "LIMIT", offset, pageSize)
  if #groups == 0 then break end

  for _, groupId in ipairs(groups) do
    if dispatched >= maxJobs then break end

    -- Tenant soft-cap check (no-op when tenantCap == 0).
    -- Checked before SISMEMBER so over-cap groups skip with 0 Redis commands
    -- (the cap result is cached per-tenant in a Lua table).
    local tenantOverCap = false
    local tenantCountKey = nil
    if tenantCap > 0 then
      local slashPos = string.find(groupId, "/", 1, true)
      if slashPos and slashPos > 1 then
        local tenantId = string.sub(groupId, 1, slashPos - 1)
        tenantCountKey = keyPrefix .. "tenant_active:" .. tenantId
        local cached = tenantCapCache[tenantId]
        if cached == nil then
          local n = tonumber(redis.call("GET", tenantCountKey)) or 0
          cached = n >= tenantCap
          tenantCapCache[tenantId] = cached
        end
        if cached then
          tenantOverCap = true
          redis.call("ZADD", readyKey, nowMs + 5000, groupId)
        end
      end
    end

    if not tenantOverCap then
      if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
        local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
        -- Defensive activeKey check — covers legacy state during migration
        -- and the small race between ZADD ready and ZADD active.
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
            -- Tenant-level pause: derived from groupId prefix (everything
            -- before the first "/"). Added post-2026-05-11 incident so an
            -- operator can halt ALL processing for a runaway tenant without
            -- touching pipeline names. Pause key format: "tenant:<tenantId>".
            local slashIdx = string.find(groupId, "/", 1, true)
            local tenantId = slashIdx and string.sub(groupId, 1, slashIdx - 1) or groupId
            if redis.call("SISMEMBER", pausedJobKey, "tenant:" .. tenantId) == 1 then
              paused = true
            end

            if not paused then
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
          end

          if not paused then
            redis.call("ZREM", jobsKey, stagedJobId)
            redis.call("DECR", totalPendingKey)
            redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

            -- Mark group as actively-processing in ready zset (future score suppresses redispatch).
            redis.call("ZADD", readyKey, activeUntil, groupId)

            -- Tenant in-flight counter (back-compat: only when cap is set).
            if tenantCap > 0 and tenantCountKey then
              redis.call("INCR", tenantCountKey)
              redis.call("EXPIRE", tenantCountKey, activeTtlSec)
              -- Invalidate cache — count changed, may now be at cap
              local slashPos2 = string.find(groupId, "/", 1, true)
              if slashPos2 then
                tenantCapCache[string.sub(groupId, 1, slashPos2 - 1)] = nil
              end
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
        else
          -- Group is in ready but has no due jobs — drift cleanup.
          local pendingCount = redis.call("ZCARD", jobsKey)
          if pendingCount == 0 then
            redis.call("ZREM", readyKey, groupId)
          else
            -- All jobs are future-scheduled; re-score ready with earliest job's score
            local nextScore = redis.call("ZRANGE", jobsKey, 0, 0, "WITHSCORES")
            if #nextScore >= 2 then
              redis.call("ZADD", readyKey, tonumber(nextScore[2]), groupId)
            end
          end
        end
      end
    end
    end
  end

  if #groups < pageSize then break end
  offset = offset + pageSize
end

return results
`;

/**
 * Pop up to maxJobs additional DUE jobs from a single group's pending queue,
 * WITHOUT touching the group's active/ready/blocked/signal state.
 *
 * Safe to call only while the caller already holds the group's active slot
 * (dispatch sets group:<id>:active and excludes active groups from dispatch),
 * so no other worker can concurrently dequeue from this group. Used to coalesce
 * a backed-up group's queued events into a single fold load/apply/store cycle.
 *
 * Mirrors the per-job bookkeeping DISPATCH does for the jobs it removes:
 * ZREM from the jobs zset, HDEL the job data, and DECR total-pending. It does
 * NOT mark anything active and does NOT re-score ready — the caller's active
 * job remains the one that frees the group on COMPLETE.
 */
const DRAIN_GROUP_LUA = `
local jobsKey         = KEYS[1]
local dataKey         = KEYS[2]
local totalPendingKey = KEYS[3]

local nowMs   = tonumber(ARGV[1])
local maxJobs = tonumber(ARGV[2])

local results = {}
if maxJobs <= 0 then
  return results
end

local entries = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, maxJobs)
local i = 1
while i < #entries do
  local stagedJobId   = entries[i]
  local originalScore = entries[i + 1]
  i = i + 2

  redis.call("ZREM", jobsKey, stagedJobId)
  local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
  redis.call("HDEL", dataKey, stagedJobId)
  redis.call("DECR", totalPendingKey)

  results[#results + 1] = stagedJobId
  results[#results + 1] = jobDataJson or ""
  results[#results + 1] = tostring(originalScore)
end

return results
`;

const COMPLETE_LUA = `
local activeKey       = KEYS[1]
local jobsKey         = KEYS[2]
local readyKey        = KEYS[3]
local signalKey       = KEYS[4]
local statsKey        = KEYS[5]
local errorKey        = KEYS[6]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]
local jobName      = ARGV[3]
-- Tenant in-flight key prefix (post-2026-05-11 follow-up). When the
-- soft-cap is enabled in DISPATCH_LUA, completing a job must DECR the
-- counter so freed slots are picked up by other tenants. Passing the
-- prefix in (not a derived tenantId) lets us keep the cap optional
-- without breaking back-compat with older call sites.
local tenantCountKeyPrefix = ARGV[4]

local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

redis.call("DEL", activeKey)

-- Decrement tenant in-flight counter when the soft-cap is enabled.
if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    local tenantId = string.sub(groupId, 1, slashPos - 1)
    local key = tenantCountKeyPrefix .. tenantId
    local n = tonumber(redis.call("GET", key)) or 0
    if n > 1 then
      redis.call("DECR", key)
    else
      redis.call("DEL", key)
    end
  end
end

local pendingCount = redis.call("ZCARD", jobsKey)
if pendingCount > 0 then
  -- Re-score ready with earliest pending job's dispatchAfter so dispatch sees
  -- it again as soon as that job is due (could be past or future).
  local nextJob = redis.call("ZRANGE", jobsKey, 0, 0, "WITHSCORES")
  if #nextJob >= 2 then
    redis.call("ZADD", readyKey, tonumber(nextJob[2]), groupId)
  else
    redis.call("ZREM", readyKey, groupId)
  end
else
  redis.call("ZREM", readyKey, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- Increment completed counter for Skynet
redis.call("INCR", statsKey)

-- Increment per-job-name completed counter
if jobName and jobName ~= "" then
  redis.call("INCR", statsKey .. ":" .. jobName)
end

-- Clear any leftover error from previous failures now that the job succeeded
redis.call("DEL", errorKey)

return 1
`;

const REFRESH_LUA = TTL_HELPER_LUA + `
local activeKey    = KEYS[1]
local readyKey     = KEYS[2]
local stagedJobId           = ARGV[1]
local activeTtlSec          = tonumber(ARGV[2])
local groupId               = ARGV[3]
local nowMs                 = tonumber(ARGV[4])
-- Tenant counter prefix (post-2026-05-11 soft-cap). When provided, the
-- tenant_active counter's TTL is refreshed alongside the activeKey TTL
-- so long-running groups don't expire their tenant slot mid-execution
-- (which would let the same tenant grab another slot, drifting cap up).
local tenantCountKeyPrefix  = ARGV[5]

local currentActive = redis.call("GET", activeKey)
if currentActive == stagedJobId then
  redis.call("EXPIRE", activeKey, activeTtlSec)
  -- Keep the pending-sibling jobs/data keys alive while this group is actively
  -- processing: a long-running active job must not let staged siblings expire
  -- under the safety-net TTL. Derive the group keys from activeKey (strip the
  -- ":active" suffix) so no extra args are needed.
  local groupBase = string.sub(activeKey, 1, #activeKey - 7)
  refreshGroupKeyTtl(groupBase .. ":jobs", groupBase .. ":data", nowMs)
  -- Refresh ready-zset score so it stays "active" until heartbeat stops or completion.
  -- Only update if the group is currently in ready — if RESTAGE_AND_BLOCK_LUA fired
  -- while this heartbeat was in flight, the group has been removed and we must not
  -- reinsert it (would violate "blocked => not in ready").
  if redis.call("ZSCORE", readyKey, groupId) then
    redis.call("ZADD", readyKey, nowMs + activeTtlSec * 1000, groupId)
  end
  if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
    local slashPos = string.find(groupId, "/", 1, true)
    if slashPos and slashPos > 1 then
      local tenantId = string.sub(groupId, 1, slashPos - 1)
      local key = tenantCountKeyPrefix .. tenantId
      if redis.call("EXISTS", key) == 1 then
        redis.call("EXPIRE", key, activeTtlSec)
      end
    end
  end
  return 1
end
return 0
`;

const RESTAGE_AND_BLOCK_LUA = `
local blockedKey      = KEYS[1]
local readyKey        = KEYS[2]
local statsKey        = KEYS[3]
local totalPendingKey = KEYS[4]

local keyPrefix             = ARGV[1]
local groupId               = ARGV[2]
local newStagedJobId        = ARGV[3]
local score                 = tonumber(ARGV[4])
local jobDataJson           = ARGV[5]
local errorMessage          = ARGV[6]
local errorStack            = ARGV[7]
-- Same shape as COMPLETE_LUA's ARGV[4]: when non-empty, DECRs the
-- tenant_active counter so the soft cap doesn't leak slots when a
-- group exhausts retries. Without this, every exhausted-retry leaves
-- the counter +1 and the cap eventually starves the tenant.
local tenantCountKeyPrefix  = ARGV[8]

local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"
local activeKey    = keyPrefix .. "group:" .. groupId .. ":active"

-- 1. Block the group — prevents dispatcher from re-dispatching
redis.call("SADD", blockedKey, groupId)

-- 2. Re-stage the failed job with a new ID
local inserted = redis.call("ZADD", groupJobsKey, score, newStagedJobId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)
if inserted == 1 then
  redis.call("INCR", totalPendingKey)
end

-- Blocked groups are operator-managed (DLQ triage / manual unblock) and must
-- not be reaped by the group-key safety-net TTL, so clear any TTL set while the
-- group was still in the active flow.
redis.call("PERSIST", groupJobsKey)
redis.call("PERSIST", groupDataKey)

-- 3. Remove from ready set — blocked groups should not be scanned by dispatch.
--    UNBLOCK_LUA re-adds the group when it is unblocked.
redis.call("ZREM", readyKey, groupId)

-- 4. Free the in-flight slot. activeKey would expire on its own after
-- activeTtlSec, but the tenant_active counter wouldn't — Redis key
-- expiration has no callback. Mirror COMPLETE_LUA's free path.
redis.call("DEL", activeKey)

if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    local tenantId = string.sub(groupId, 1, slashPos - 1)
    local key = tenantCountKeyPrefix .. tenantId
    local n = tonumber(redis.call("GET", key)) or 0
    if n > 1 then
      redis.call("DECR", key)
    else
      redis.call("DEL", key)
    end
  end
end

-- 5. Store error info for Skynet visibility
if errorMessage and errorMessage ~= "" then
  local errorKey = keyPrefix .. "group:" .. groupId .. ":error"
  redis.call("HSET", errorKey, "message", errorMessage, "stack", errorStack or "", "timestamp", tostring(score))
end

-- 6. Increment failed counter for Skynet
redis.call("INCR", statsKey)

-- 7. Increment per-job-name failed counter
local ok, data = pcall(cjson.decode, jobDataJson)
if ok and data then
  local jn = data["__jobName"]
  if jn and jn ~= "" then
    redis.call("INCR", statsKey .. ":" .. jn)
  end
end

return 1
`;

const RETRY_RESTAGE_LUA = TTL_HELPER_LUA + `
local activeKey       = KEYS[1]
local totalPendingKey = KEYS[2]

local keyPrefix             = ARGV[1]
local groupId               = ARGV[2]
local stagedJobId           = ARGV[3]
local newStagedJobId        = ARGV[4]
local dispatchAfterMs       = tonumber(ARGV[5])
local jobDataJson           = ARGV[6]
local retryTtlSec           = tonumber(ARGV[7])
-- Tenant counter prefix (post-2026-05-11 soft-cap). Keeps the tenant
-- counter TTL aligned with the activeKey TTL across backoff retries
-- so an in-flight retry doesn't expire its tenant slot.
local tenantCountKeyPrefix  = ARGV[8]
local nowMs                 = tonumber(ARGV[9])

-- 1. Validate active key matches
local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

-- 2. Re-stage job with future score (backoff delay)
local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"
local inserted = redis.call("ZADD", groupJobsKey, dispatchAfterMs, newStagedJobId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)
if inserted == 1 then
  redis.call("INCR", totalPendingKey)
end
refreshGroupKeyTtl(groupJobsKey, groupDataKey, nowMs)

-- 3. Update ready set score = future dispatch time so the group becomes
--    eligible exactly when the backoff window expires.
local readyKey = keyPrefix .. "ready"
redis.call("ZADD", readyKey, dispatchAfterMs, groupId)

-- 4. Set active key TTL to match backoff period.
--    While the key exists the group is locked (preserves FIFO ordering).
--    When it expires the dispatcher picks up the retry job on its next poll.
redis.call("EXPIRE", activeKey, retryTtlSec)

-- 5. Mirror activeKey TTL onto tenant_active counter so the soft cap
-- stays accurate during backoff windows. Only set when the counter
-- exists to avoid silently re-creating a counter that COMPLETE_LUA
-- legitimately decremented to zero.
if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    local tenantId = string.sub(groupId, 1, slashPos - 1)
    local key = tenantCountKeyPrefix .. tenantId
    if redis.call("EXISTS", key) == 1 then
      redis.call("EXPIRE", key, retryTtlSec)
    end
  end
end

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
 * A job drained from a group's pending queue for batch coalescing.
 * Unlike a DispatchResult it carries no groupId (the caller already knows it)
 * and is never marked active — it is folded alongside the active job.
 */
export interface DrainedJob {
  stagedJobId: string;
  jobDataJson: string;
  originalScore: number;
}

/**
 * Default tenant soft-cap when LANGWATCH_DISPATCH_TENANT_CAP is unset.
 *
 * Chosen as `GLOBAL_QUEUE_CONCURRENCY` (the per-worker-pod concurrency
 * default — see groupQueue.ts), which means "no tenant can hold more
 * than one pod's worth of in-flight slots". Sizing rationale:
 *
 *   - On a multi-pod cluster (e.g. 4 pods × 100 concurrency = 400
 *     total slots), a single tenant is capped at 25% of cluster
 *     capacity. Strong protection against noisy-neighbour starvation
 *     like the 2026-05-11 incident, while leaving ample headroom for
 *     legitimate single-tenant bursts at observed peak loads.
 *
 *   - On a 1-pod self-hosted install, the cap equals total cluster
 *     capacity → effectively unlimited for normal use, but still bounds
 *     a pathological runaway loop below catastrophic.
 *
 *   - Operators can still set LANGWATCH_DISPATCH_TENANT_CAP=0 to
 *     disable entirely (incident kill-switch), or set a different
 *     positive integer to retune.
 */
export const DEFAULT_TENANT_CAP = 50;

/**
 * Read the tenant soft-cap from the environment.
 * Post-2026-05-11 incident follow-up; see DISPATCH_LUA comment for design.
 * Symbol is captured in env-create.mjs for schema discoverability; we
 * read process.env directly at call time so tests can mutate it without
 * re-importing the frozen env module.
 *
 * Semantics:
 *   - env unset / empty / non-numeric / negative → DEFAULT_TENANT_CAP (50)
 *   - env = "0" → 0 (explicit kill switch — disable cap entirely)
 *   - env = positive integer → that integer
 */
export function readTenantCap(): number {
  const raw = process.env.LANGWATCH_DISPATCH_TENANT_CAP;
  if (raw === undefined || raw === "") return DEFAULT_TENANT_CAP;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TENANT_CAP;
  return n;
}

/**
 * Set holding every active group-queue name (e.g. "{event-sourcing/jobs}").
 * Producers register themselves here on construction so the ops dashboard can
 * enumerate queues with an O(1) SMEMBERS instead of an O(keyspace)
 * `SCAN MATCH *:gq:ready`, which scanned all ~190K keys to find a single ready
 * set and pegged the Redis main thread once the keyspace grew. The dedicated
 * hash tag keeps the set in a single Redis Cluster slot.
 */
export const GROUP_QUEUE_REGISTRY_KEY = "{gq-registry}:names";

/**
 * TypeScript wrapper for the group queue Lua scripts.
 * All Redis keys use the `{queueName}` hash tag for Redis Cluster compatibility.
 * Lua scripts derive per-group keys dynamically (e.g. keyPrefix .. "group:" .. groupId)
 * instead of passing them via KEYS[]; this is safe because keyPrefix includes the hash
 * tag, so all derived keys hash to the same Redis Cluster slot.
 */
export class GroupStagingScripts {
  private readonly keyPrefix: string;
  private readonly queueName: string;

  constructor(
    private readonly redis: IORedis | Cluster,
    queueName: string,
  ) {
    // queueName already includes hash tags, e.g. "{pipeline/handler/spanStorage}"
    this.queueName = queueName;
    this.keyPrefix = `${queueName}:gq:`;
  }

  /**
   * Advertise this queue in the registry set so the ops dashboard discovers it
   * without scanning the keyspace. Idempotent; safe to call once per process.
   */
  async registerQueue(): Promise<void> {
    await this.redis.sadd(GROUP_QUEUE_REGISTRY_KEY, this.queueName);
  }

  /**
   * Stage a job into a group's pending queue.
   *
   * When dedup is active and the old job is still in staging, squashes in place
   * (reuses the existing stagedJobId, conditionally updates score/data per
   * shouldExtend/shouldReplace). When the old job was already dispatched, the
   * stale dedup key is cleaned up and the new job is staged as genuinely new.
   *
   * @returns true if a new job was staged, false if squashed onto an existing job (dedup)
   */
  async stage({
    stagedJobId,
    groupId,
    dispatchAfterMs,
    dedupId,
    dedupTtlMs,
    jobDataJson,
    shouldExtend = true,
    shouldReplace = true,
  }: {
    stagedJobId: string;
    groupId: string;
    dispatchAfterMs: number;
    dedupId: string;
    dedupTtlMs: number;
    jobDataJson: string;
    shouldExtend?: boolean;
    shouldReplace?: boolean;
  }): Promise<boolean> {
    const groupJobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;
    const dedupKey =
      dedupId !== "" ? `${this.keyPrefix}dedup:${dedupId}` : `${this.keyPrefix}dedup:__none__`;

    const dataKey = `${this.keyPrefix}group:${groupId}:data`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;
    const blockedKey = `${this.keyPrefix}blocked`;

    const result = await this.redis.eval(
      STAGE_LUA,
      8,
      groupJobsKey,
      readyKey,
      signalKey,
      dedupKey,
      dataKey,
      totalPendingKey,
      activeKey,
      blockedKey,
      stagedJobId,
      groupId,
      String(dispatchAfterMs),
      dedupId,
      String(dedupTtlMs),
      jobDataJson,
      String(shouldExtend ? 1 : 0),
      String(shouldReplace ? 1 : 0),
      String(Date.now()),
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
      shouldExtend?: boolean;
      shouldReplace?: boolean;
    }>,
  ): Promise<number> {
    if (jobs.length === 0) return 0;

    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    const args: string[] = [this.keyPrefix, String(jobs.length)];
    for (const job of jobs) {
      args.push(
        job.stagedJobId,
        job.groupId,
        String(job.dispatchAfterMs),
        job.dedupId,
        String(job.dedupTtlMs),
        job.jobDataJson,
        String((job.shouldExtend ?? true) ? 1 : 0),
        String((job.shouldReplace ?? true) ? 1 : 0),
      );
    }
    // Appended last so the Lua reads it as ARGV[#ARGV] regardless of job count.
    args.push(String(Date.now()));

    const result = await this.redis.eval(STAGE_BATCH_LUA, 3, readyKey, signalKey, totalPendingKey, ...args);

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
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    // Tenant soft-cap (post-2026-05-11 follow-up). 0 = disabled.
    // Env var lets operators flip on per-environment without redeploy.
    const tenantCap = readTenantCap();

    const result = await this.redis.eval(
      DISPATCH_LUA,
      4,
      readyKey,
      blockedKey,
      pausedJobKey,
      totalPendingKey,
      this.keyPrefix,
      String(nowMs),
      String(activeTtlSec),
      String(tenantCap),
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
  }: {
    nowMs: number;
    activeTtlSec: number;
    maxJobs: number;
  }): Promise<DispatchResult[]> {
    const readyKey = `${this.keyPrefix}ready`;
    const blockedKey = `${this.keyPrefix}blocked`;
    const pausedJobKey = `${this.keyPrefix}paused-jobs`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    const tenantCap = readTenantCap();

    const result = await this.redis.eval(
      DISPATCH_BATCH_LUA,
      4,
      readyKey,
      blockedKey,
      pausedJobKey,
      totalPendingKey,
      this.keyPrefix,
      String(nowMs),
      String(activeTtlSec),
      String(maxJobs),
      String(tenantCap),
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
    jobName,
  }: {
    groupId: string;
    stagedJobId: string;
    jobName?: string;
  }): Promise<boolean> {
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;
    const jobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;
    const statsKey = `${this.keyPrefix}stats:completed`;
    const errorKey = `${this.keyPrefix}group:${groupId}:error`;

    const result = await this.redis.eval(
      COMPLETE_LUA,
      6,
      activeKey,
      jobsKey,
      readyKey,
      signalKey,
      statsKey,
      errorKey,
      groupId,
      stagedJobId,
      jobName ?? "",
      `${this.keyPrefix}tenant_active:`,
    );

    return result === 1;
  }

  /**
   * Drain up to maxJobs additional DUE jobs from a group's pending queue without
   * altering the group's active/ready state. Only safe while the caller holds
   * the group's active slot. Returns the drained jobs (may be empty).
   */
  async drainGroupReady({
    groupId,
    nowMs,
    maxJobs,
  }: {
    groupId: string;
    nowMs: number;
    maxJobs: number;
  }): Promise<DrainedJob[]> {
    if (maxJobs <= 0) return [];

    const jobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const dataKey = `${this.keyPrefix}group:${groupId}:data`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    const result = await this.redis.eval(
      DRAIN_GROUP_LUA,
      3,
      jobsKey,
      dataKey,
      totalPendingKey,
      String(nowMs),
      String(maxJobs),
    );

    if (!result || !Array.isArray(result) || result.length < 3) {
      return [];
    }

    const drained: DrainedJob[] = [];
    for (let i = 0; i + 3 <= result.length; i += 3) {
      drained.push({
        stagedJobId: String(result[i]),
        jobDataJson: String(result[i + 1]),
        originalScore: Number(result[i + 2]),
      });
    }

    return drained;
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
    const readyKey = `${this.keyPrefix}ready`;

    const result = await this.redis.eval(
      REFRESH_LUA,
      2,
      activeKey,
      readyKey,
      stagedJobId,
      String(activeTtlSec),
      groupId,
      String(Date.now()),
      `${this.keyPrefix}tenant_active:`,
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
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    await this.redis.eval(
      RESTAGE_AND_BLOCK_LUA,
      4,
      blockedKey,
      readyKey,
      statsKey,
      totalPendingKey,
      this.keyPrefix,
      groupId,
      newStagedJobId,
      String(score),
      jobDataJson,
      errorMessage ?? "",
      errorStack ?? "",
      `${this.keyPrefix}tenant_active:`,
    );
  }

  /**
   * Re-stage a job with a future dispatch score (backoff delay) while keeping
   * the active key alive to preserve per-group FIFO ordering. The fastq worker
   * slot is freed immediately.
   *
   * The active key TTL is set to match the backoff period so the key expires
   * naturally. On the next dispatcher poll (≤5s) the retry job is dispatched.
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
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;
    // TTL = backoff + 2s buffer so the key expires just after the job becomes eligible
    const retryTtlSec = Math.ceil(backoffMs / 1000) + 2;

    const result = await this.redis.eval(
      RETRY_RESTAGE_LUA,
      2,
      activeKey,
      totalPendingKey,
      this.keyPrefix,
      groupId,
      stagedJobId,
      newStagedJobId,
      String(dispatchAfterMs),
      jobDataJson,
      String(retryTtlSec),
      `${this.keyPrefix}tenant_active:`,
      String(Date.now()),
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
   * Get the number of groups in the ready set. O(1) via ZCARD.
   */
  async getReadySize(): Promise<number> {
    return this.redis.zcard(`${this.keyPrefix}ready`);
  }

  /**
   * Get the key prefix for metrics/recovery scans.
   */
  getKeyPrefix(): string {
    return this.keyPrefix;
  }
}

