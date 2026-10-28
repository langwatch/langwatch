import { nowInstant } from "@langwatch/time";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_LEASE_SET_TTL_SECONDS,
  BLOB_LEASE_TTL_SECONDS,
  LEGACY_HOLDER_LEASE_GUARD,
  MAX_BLOB_BYTES,
} from "./blobConstants.ts";
import { GQ_BLOB_GRACE_LUA } from "./blobGraceLua.ts";
import { CachedLuaScript, isNoScriptResult } from "./cachedLuaScript.ts";
import { gqJobsDispatchedOverrideTotal, gqJobsRecoveredTotal } from "./metrics.ts";

// Lua scripts inlined as string constants.
// This avoids loader incompatibilities across turbopack, webpack, vitest, and tsx.

/** Safety-net TTL (ms) for group keys, auto-refreshed on writes/dispatch. */
export const GROUP_KEY_TTL_MS = 6 * 60 * 60 * 1000;

/** Max groups per unpark eval; bounds Redis thread load during reconcile. */
export const PARK_RECONCILE_MAX_DRAIN = 1000;

/** Reconcile cadence (ms); defines dynamic-cap TTL and claimant window multiples. */
export const RECONCILE_INTERVAL_MS = 2000;

/** Beacon refresh interval. Three refreshes fit inside {@link WORKER_LIVENESS_TTL_SECONDS}. */
export const WORKER_LIVENESS_REFRESH_MS = 30_000;

/** How often a worker refreshes the active key of a group it holds: three times per its TTL. */
export function activeKeyHeartbeatMs({ activeTtlSec }: { activeTtlSec: number }): number {
  return (activeTtlSec * 1000) / 3;
}

/**
 * Milliseconds per second of active TTL a held group's ready score sits out: half the TTL, past
 * {@link activeKeyHeartbeatMs}, so a live claim's heartbeat always re-scores it before it is due.
 */
export const HELD_RESCORE_MS_PER_TTL_SEC = 500;

/**
 * How soon dispatch looks again at a held group it found due: a heartbeat that ran late, or an
 * owner whose beacon is missing. The claim and each heartbeat put a held group half its active
 * TTL out, past the next heartbeat, so a running group stays out of the due window.
 */
export const CLAIM_RECHECK_MS = 30_000;

/**
 * A missing beacon is acted on only when seen again this long after it was first seen: twice the
 * beacon refresh, so an owner back from a Redis outage republishes in between and keeps its claim
 * (specs/claimed-job-recovery.feature).
 */
export const CLAIM_GONE_CONFIRM_MS = WORKER_LIVENESS_REFRESH_MS * 2;

/** How far back a listed run's jobless group that stays (a failure, say) goes in its candidates. */
const SETTLED_CANDIDATE_DELAY_MS = 3_600_000;

/** How long a listed run's in-flight group stays out of its scan, unless COMPLETE finds work. */
const IN_FLIGHT_CANDIDATE_DELAY_MS = 1_000;

/**
 * How long a listed run's group holding work it can't run yet (parked at its tenant's cap,
 * blocked, or paused) stays out of its scan. Re-reading such groups on every claim kept the
 * listed consumer polling every 50ms over the whole parked backlog.
 */
const WAITING_CANDIDATE_DELAY_MS = 5_000;

/** Dynamic cap TTL (5x RECONCILE_INTERVAL_MS); fails safe to static cap if stale. */
export const DYNAMIC_CAP_TTL_MS = 5 * RECONCILE_INTERVAL_MS;

/** Max tenants in dynamic-cap recompute; bounds per-eval Redis calls O(3N). */
export const MAX_DEMANDING_TENANTS = 1000;

/** Jobs per multi-key write in a drain: well under the few thousand values Lua's unpack spreads. */
export const DRAIN_WRITE_CHUNK_JOBS = 500;

// Lua helper for every script that writes group keys: the safety-net TTL on a group's jobs/data
// keys runs to the later of (now + window) and (LATEST scheduled dispatch + window), so a job
// delayed past the window is never reaped before it is due. A blocked group is operator-held
// (RESTAGE_AND_BLOCK_LUA): its keys stay persistent until unblock refreshes them without the flag.
export const TTL_HELPER_LUA = `
-- A parked group is live work that may wait for hours: its keys carry no TTL
-- (specs/parked-group-retention.feature), like a blocked group's.
local function holdGroupKeys(jobsKey, dataKey)
  redis.call("PERSIST", jobsKey)
  redis.call("PERSIST", dataKey)
end

-- A lane's parked set is keyed by its pause entry, which the group id does not name,
-- so lane-parked-groups counts, per group, the lane sets holding it: one HEXISTS answers
-- however many lanes are paused. parkLaneGroup adds, restoreUnpausedLanes releases.
local function markLaneParked(kp, groupId)
  redis.call("HINCRBY", kp .. "lane-parked-groups", groupId, 1)
end

local function releaseLaneParked(kp, groupId)
  if redis.call("HINCRBY", kp .. "lane-parked-groups", groupId, -1) <= 0 then
    redis.call("HDEL", kp .. "lane-parked-groups", groupId)
  end
end

-- Groups lane-parked before lane-parked-groups existed carry no count. Once per queue, the
-- lanes paused then are remembered (SUNIONSTORE: one entry per lane, not per group), and
-- only those are walked, until restoreUnpausedLanes drains each of them.
local function inLaneParkedBeforeCounting(kp, groupId)
  if redis.call("SET", kp .. "lane-parked-groups:counted", "1", "NX") then
    redis.call("SUNIONSTORE", kp .. "uncounted-parked-lanes", kp .. "parked-lanes")
  end
  for _, pauseKey in ipairs(redis.call("SMEMBERS", kp .. "uncounted-parked-lanes")) do
    if redis.call("ZSCORE", kp .. "parked-lane:" .. pauseKey, groupId) then return true end
  end
  return false
end

-- Whether the group sits in its tenant's parked set or in a paused lane's.
local function isParkedGroupAt(kp, groupId)
  local tenantId = groupId
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then tenantId = string.sub(groupId, 1, slashPos - 1) end
  if redis.call("ZSCORE", kp .. "parked:" .. tenantId, groupId) then return true end
  if redis.call("HEXISTS", kp .. "lane-parked-groups", groupId) == 1 then return true end
  return inLaneParkedBeforeCounting(kp, groupId)
end

-- The same, for the group behind jobsKey (<prefix>:gq:group:<id>:jobs); an
-- unrecognised key reads as not parked.
local function isParkedGroup(jobsKey)
  local kp, groupId = string.match(jobsKey, "^(.-:gq:)group:(.+):jobs$")
  if not kp then return false end
  return isParkedGroupAt(kp, groupId)
end

local function refreshGroupKeyTtl(jobsKey, dataKey, nowMs, isBlocked)
  if isBlocked or isParkedGroup(jobsKey) then
    holdGroupKeys(jobsKey, dataKey)
    return
  end
  local latest = redis.call("ZRANGE", jobsKey, -1, -1, "WITHSCORES")
  if not latest[2] then return end
  local ttl = ${GROUP_KEY_TTL_MS}
  local untilDue = (tonumber(latest[2]) - nowMs) + ${GROUP_KEY_TTL_MS}
  if untilDue > ttl then ttl = untilDue end
  redis.call("PEXPIRE", jobsKey, ttl)
  redis.call("PEXPIRE", dataKey, ttl)
end
`;

// Lua helper: per-tenant in-flight count ZSET (self-heals on worker death).
const TENANT_ACTIVE_HELPER_LUA = `
local function tenantActiveAdd(taPrefix, tenantId, groupId, expiryMs)
  redis.call("ZADD", taPrefix .. tenantId, expiryMs, groupId)
end
local function tenantActiveRemove(taPrefix, tenantId, groupId)
  redis.call("ZREM", taPrefix .. tenantId, groupId)
end
-- Live in-flight count = members whose expiry score is strictly in the future
-- (> nowMs). GC the lapsed members first (scores at-or-past nowMs: cheap, only
-- removes already-expired entries) so a burst of dead-worker slots can't grow
-- the ZSET without bound. A slot scored exactly nowMs has just reached its
-- deadline = lapsed (mirrors the activeKey EX TTL, which vanishes at expiry),
-- so it is removed and not counted.
local function tenantActiveCount(taPrefix, tenantId, nowMs)
  local key = taPrefix .. tenantId
  redis.call("ZREMRANGEBYSCORE", key, "-inf", nowMs)
  return redis.call("ZCARD", key)
end
`;

// Lua helper: tenant soft-cap "parking" model. Over-cap groups move to parked
// zset (not ready), preserving score for priority restoration. Includes
// TENANT_ACTIVE_HELPER_LUA for self-healing in-flight count.
export const PARK_HELPER_LUA =
  TENANT_ACTIVE_HELPER_LUA +
  `
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
-- Returns 1 when the group was actually moved out of ready (0 otherwise) so
-- the dispatch scan can keep its page offset aligned with the shrinking zset.
local function parkGroup(readyKey, groupId)
  local score = redis.call("ZSCORE", readyKey, groupId)
  if not score then return 0 end
  local kp = parkKeyPrefixOf(readyKey)
  local tenantId = parkTenantOf(groupId)
  redis.call("ZREM", readyKey, groupId)
  redis.call("ZADD", kp .. "parked:" .. tenantId, score, groupId)
  redis.call("SADD", kp .. "parked-tenants", tenantId)
  holdGroupKeys(kp .. "group:" .. groupId .. ":jobs", kp .. "group:" .. groupId .. ":data")
  return 1
end

-- Restore up to "slots" of a tenant's parked groups (lowest score = earliest
-- due first) back into ready. Self-limiting: callers pass slots = cap - active
-- so COMPLETE-unpark and the dispatch-tail reconcile can never over-unpark into
-- a re-park churn (TRAP 3). Returns how many were moved.
local function unparkUpTo(readyKey, tenantId, slots, nowMs)
  local kp = parkKeyPrefixOf(readyKey)
  -- A paused tenant's groups stay parked OUT of the ready scan regardless of cap
  -- headroom or the cap=0 drain: pause is an explicit operator hold and must win.
  -- Otherwise COMPLETE-unpark / reconcile would restore them into ready and a large
  -- paused backlog would plug the bounded dispatch scan for every other tenant again.
  if redis.call("SISMEMBER", kp .. "paused-jobs", "tenant:" .. tenantId) == 1 then
    return 0
  end
  if slots <= 0 then return 0 end
  -- Bound the per-eval work so no single caller can ZRANGE + ZREM/ZADD an
  -- unbounded set and block the single Redis thread. The reconcile leaves the
  -- tenant registered until its parked set is empty, so the rest drains in
  -- later cycles. (Normal cap>0 unparks pass slots = cap - active, far below
  -- this; the bound only bites the cap=0 kill-switch drain of a huge backlog.)
  if slots > ${PARK_RECONCILE_MAX_DRAIN} then slots = ${PARK_RECONCILE_MAX_DRAIN} end
  local parkedKey = kp .. "parked:" .. tenantId
  local members = redis.call("ZRANGE", parkedKey, 0, slots - 1, "WITHSCORES")
  local moved = 0
  for i = 1, #members, 2 do
    redis.call("ZREM", parkedKey, members[i])
    redis.call("ZADD", readyKey, tonumber(members[i + 1]), members[i])
    refreshGroupKeyTtl(kp .. "group:" .. members[i] .. ":jobs", kp .. "group:" .. members[i] .. ":data", nowMs)
    moved = moved + 1
  end
  if redis.call("ZCARD", parkedKey) == 0 then
    redis.call("SREM", kp .. "parked-tenants", tenantId)
  end
  return moved
end

-- Safety-net reconcile, run by DISPATCH on a cadence (not the normal path:
-- COMPLETE-unpark frees slots as jobs finish). Restores parked groups whose
-- tenant has dropped below cap, covering two cases COMPLETE cannot:
--   * orphan recovery (TRAP 2): a crashed/timed-out tenant never fires COMPLETE,
--     so its in-flight slots lapse out of tenantActiveCount once their expiry
--     scores fall into the past; the live count drops below cap and the parked
--     groups are restored, instead of stranding forever (a new stranding mode).
--   * cap disabled: flipping LANGWATCH_DISPATCH_TENANT_CAP to 0 must not leave
--     groups parked out of the dispatch scan, so drain the whole tenant.
-- Self-limiting via unparkUpTo (bounded by cap - active), so it never over-unparks.
local function reconcileParked(readyKey, keyPrefix, tenantCap, nowMs)
  local tenants = redis.call("SMEMBERS", keyPrefix .. "parked-tenants")
  for _, tenantId in ipairs(tenants) do
    local slots
    if tenantCap > 0 then
      local active = tenantActiveCount(keyPrefix .. "tenant_active_z:", tenantId, nowMs)
      slots = tenantCap - active
    else
      -- Cap disabled: drain the tenant, but in bounded chunks across reconciles
      -- (unparkUpTo caps the per-eval work and keeps the tenant registered until
      -- its parked set is empty), so flipping the kill switch with a huge parked
      -- backlog can't block Redis in one eval.
      slots = ${PARK_RECONCILE_MAX_DRAIN}
    end
    unparkUpTo(readyKey, tenantId, slots, nowMs)
  end
end

-- Lane pause parks like a tenant pause: out of ready, keyed by the matched pause
-- entry, so a paused lane's backlog cannot fill the bounded dispatch scan.
-- Returns 1 when the group left ready, so the scan offset stays aligned.
local function parkLaneGroup(readyKey, groupId, pauseKey)
  local score = redis.call("ZSCORE", readyKey, groupId)
  if not score then return 0 end
  local kp = parkKeyPrefixOf(readyKey)
  redis.call("ZREM", readyKey, groupId)
  if redis.call("ZADD", kp .. "parked-lane:" .. pauseKey, score, groupId) == 1 then
    markLaneParked(kp, groupId)
  end
  redis.call("SADD", kp .. "parked-lanes", pauseKey)
  holdGroupKeys(kp .. "group:" .. groupId .. ":jobs", kp .. "group:" .. groupId .. ":data")
  return 1
end

-- Restores, at their parked scores, the groups of every lane whose pause entry is
-- gone, whoever removed it; bounded per key per eval like unparkUpTo. LT keeps an
-- earlier score a stage wrote meanwhile; an active group's score is COMPLETE's.
local function restoreUnpausedLanes(readyKey, keyPrefix, pausedJobKey, nowMs)
  for _, pauseKey in ipairs(redis.call("SMEMBERS", keyPrefix .. "parked-lanes")) do
    if redis.call("SISMEMBER", pausedJobKey, pauseKey) == 0 then
      local parkedKey = keyPrefix .. "parked-lane:" .. pauseKey
      local members = redis.call("ZRANGE", parkedKey, 0, ${PARK_RECONCILE_MAX_DRAIN} - 1, "WITHSCORES")
      for i = 1, #members, 2 do
        local groupId = members[i]
        if redis.call("ZREM", parkedKey, groupId) == 1 then releaseLaneParked(keyPrefix, groupId) end
        if redis.call("EXISTS", keyPrefix .. "group:" .. groupId .. ":active") == 0 then
          addToReadyOrParked(readyKey, groupId, tonumber(members[i + 1]), true)
        end
        local groupBase = keyPrefix .. "group:" .. groupId
        refreshGroupKeyTtl(groupBase .. ":jobs", groupBase .. ":data", nowMs)
      end
      if redis.call("ZCARD", parkedKey) == 0 then
        redis.call("SREM", keyPrefix .. "parked-lanes", pauseKey)
        redis.call("SREM", keyPrefix .. "uncounted-parked-lanes", pauseKey)
      end
    end
  end
end
`;

/** How long (ms) a tenant is treated as a claimant (prevents newcomer starvation). */
export const CLAIMANT_WINDOW_MS = 8 * RECONCILE_INTERVAL_MS;

// Lua helper: dynamic water-level cap divides global budget fairly across tenants.
const WATER_LEVEL_HELPER_LUA = `
-- Effective per-tenant cap = the dynamic water-level W when present, else the
-- static operator cap. A lapsed/never-written dynamic-cap key (recompute stalled
-- on every pod, or the feature is off) falls back to the static cap = fail
-- PROTECTIVE (the low side), never permissive.
local function effectiveCap(keyPrefix, staticCap)
  local w = redis.call("GET", keyPrefix .. "dynamic-cap")
  if w then
    local n = tonumber(w)
    if n and n >= 1 then return n end
  end
  return staticCap
end

-- Water-fill the global budget across claimants: returns the uniform level W
-- with sum(min(demand_i, W)) = budget. measured = realised demands (in-flight +
-- parked) of tenants that are dispatching. presenceCount = brand-new claimants
-- whose work is still all in ready (measured 0 but freshly enqueued); we treat
-- them as constrained (each pulls a full share W) so a newcomer is not invisible
-- to the fill. A measured tenant below the running share is satisfied and its
-- slack redistributes UP to the constrained ones (max-min, emergent). No
-- contention (everything fits, no presence) -> W = budget (burst to full).
local function waterLevel(measured, presenceCount, budget)
  table.sort(measured)
  local nLeft = #measured + presenceCount
  if nLeft == 0 then return budget end
  local remaining = budget
  for i = 1, #measured do
    local share = remaining / nLeft
    if measured[i] <= share then
      remaining = remaining - measured[i]
      nLeft = nLeft - 1
    else
      local w = math.floor(remaining / nLeft)
      if w < 1 then w = 1 end
      return w
    end
  end
  -- All measured tenants satisfied; the remainder is split among presence
  -- claimants. None left -> nothing is constrained -> W = the whole budget.
  if nLeft <= 0 then return budget end
  local w = math.floor(remaining / nLeft)
  if w < 1 then w = 1 end
  return w
end

-- Recompute W from the tenants with demand and store it under dynamic-cap with a
-- TTL (a stalled recompute lapses to the static cap = fail-protective). Reads the
-- demanding-tenants RECENCY ZSET (member=tenant, score=last enqueue/dispatch ms),
-- avoiding the keyspace SCAN that once pegged Redis. Per tenant: measured =
-- in-flight (tenant_active_z, GC-d) + parked; fresh = active within the claimant
-- window. fresh & measured 0 = presence claimant (newcomer still in ready);
-- stale & measured 0 = drained, GC. Deliberately omits the exact ready COUNT (no
-- per-tenant ready index); ready PRESENCE via fresh membership is all the fill
-- needs to stop a newcomer reading 0 demand and pinning W at the full budget.
local function recomputeDynamicCap(keyPrefix, budget, nowMs)
  local registryKey = keyPrefix .. "demanding-tenants"
  -- Bound the registry SIZE by RANK (not by recency) so a churn of distinct
  -- tenants cannot grow it unbounded, WITHOUT time-evicting a tenant that is
  -- quiet-but-still-working: keep the most-recent 2*MAX by enqueue recency. This
  -- is a no-op under normal load; only the least-recently-active tail is dropped
  -- under extreme fan-out (and that tail is the least likely to still contend).
  local size = redis.call("ZCARD", registryKey)
  if size > 2 * ${MAX_DEMANDING_TENANTS} then
    redis.call("ZREMRANGEBYRANK", registryKey, 0, size - 2 * ${MAX_DEMANDING_TENANTS} - 1)
  end
  -- Water-fill over at most MAX_DEMANDING_TENANTS most-recent claimants, bounding
  -- the pass to ~3N Redis calls. Classify each by LIVE demand, consulting
  -- tenant_active_z + parked BEFORE any recency eviction: a tenant with
  -- active+parked>0 stays counted (measured) EVEN IF it stopped enqueuing more
  -- than a window ago — dropping a still-draining tenant from the fill would
  -- inflate W and let the others expand past their fair share under sustained
  -- contention. Only a stale AND fully-idle member (no in-flight, none parked = a
  -- drained phantom) is GC'd; a fresh idle member is a brand-new claimant whose
  -- burst is still entirely in ready (presence).
  local members = redis.call("ZREVRANGE", registryKey, 0, ${MAX_DEMANDING_TENANTS} - 1, "WITHSCORES")
  local measured = {}
  local presenceCount = 0
  for i = 1, #members, 2 do
    local tenantId = members[i]
    local lastActive = tonumber(members[i + 1]) or 0
    local d = tenantActiveCount(keyPrefix .. "tenant_active_z:", tenantId, nowMs)
            + redis.call("ZCARD", keyPrefix .. "parked:" .. tenantId)
    if d > 0 then
      measured[#measured + 1] = d
    elseif (nowMs - lastActive) <= ${CLAIMANT_WINDOW_MS} then
      presenceCount = presenceCount + 1
    else
      redis.call("ZREM", registryKey, tenantId)
    end
  end
  local w = waterLevel(measured, presenceCount, budget)
  redis.call("SET", keyPrefix .. "dynamic-cap", w, "PX", ${DYNAMIC_CAP_TTL_MS})
end

-- Unpark up to "slots" groups from the least-served (fewest in-flight) over-cap
-- tenant that is not paused, so the work-conserving override can fill otherwise-
-- idle slots from the most-starved over-cap tenant. Candidate set is the parked
-- tenants ONLY, so a work-less phantom claimant (no parked groups) is never
-- chosen and a free slot is never wasted on a tenant with nothing to run.
local function unparkLeastServedParked(readyKey, keyPrefix, pausedJobKey, nowMs, slots)
  local tenants = redis.call("SMEMBERS", keyPrefix .. "parked-tenants")
  local best = nil
  local bestCount = nil
  for _, t in ipairs(tenants) do
    if redis.call("SISMEMBER", pausedJobKey, "tenant:" .. t) == 0 then
      local c = tenantActiveCount(keyPrefix .. "tenant_active_z:", t, nowMs)
      if bestCount == nil or c < bestCount then
        best = t
        bestCount = c
      end
    end
  end
  if best then unparkUpTo(readyKey, best, slots, nowMs) end
end
`;

// Reads routing metadata (pipelineName, jobType, jobName) from a stored job
// value. The canonical envelope exposes it in the tiny header so the payload
// body is never decoded on Redis's thread.
export const ROUTING_META_HELPER_LUA = `
local function gqRoutingMeta(jobDataJson)
  local prefix = string.sub(jobDataJson, 1, 4)
  if prefix == "GQ2|" then
    local barIdx = string.find(jobDataJson, "|", 5, true)
    if barIdx then
      local headerLen = tonumber(string.sub(jobDataJson, 5, barIdx - 1))
      if headerLen and headerLen > 0 then
        local ok, header = pcall(cjson.decode, string.sub(jobDataJson, barIdx + 1, barIdx + headerLen))
        if ok and type(header) == "table" then
          return header["p"], header["t"], header["n"]
        end
      end
    end
    return nil, nil, nil
  end
  return nil, nil, nil
end
`;

// Payload size as seen by worker (pre-compression, pre-offload); must match TS twin.
const PAYLOAD_SIZE_HELPER_LUA = `
local function gqPayloadSize(value)
  local prefix = string.sub(value, 1, 4)
  if prefix == "GQ2|" then
    local barIdx = string.find(value, "|", 5, true)
    if barIdx then
      local headerLen = tonumber(string.sub(value, 5, barIdx - 1))
      if headerLen and headerLen > 0 then
        local ok, header = pcall(cjson.decode, string.sub(value, barIdx + 1, barIdx + headerLen))
        if ok and type(header) == "table" then
          local s = header["s"]
          -- Non-negative integer within JS's safe-integer range, which is what
          -- the TS twin's Number.isSafeInteger admits — the same set, or the
          -- two ends of one budget disagree on a value. NaN fails the >= 0
          -- test, and the upper bound is what rejects infinity: cjson decodes
          -- 1e999 to inf, and math.floor(inf) == inf would pass an integer
          -- check on its own.
          if type(s) == "number" and s >= 0 and s <= ${Number.MAX_SAFE_INTEGER} and s == math.floor(s) then
            return s
          end
          if header["e"] ~= "j" then
            return ${MAX_BLOB_BYTES}
          end
        end
      end
    end
  end
  return #value
end
`;

// GQ2 blob-lease lifecycle: leases move atomically with blob refs.
export const BLOB_LEASE_HELPER_LUA =
  GQ_BLOB_GRACE_LUA +
  `
local function gqTenantOf(groupId)
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then return string.sub(groupId, 1, slashPos - 1) end
  return groupId
end

local function gqParseLease(value)
  local prefix = string.sub(value, 1, 4)
  if prefix ~= "GQ2|" then return nil end
  local barIdx = string.find(value, "|", 5, true)
  if not barIdx then return nil end
  local headerLen = tonumber(string.sub(value, 5, barIdx - 1))
  if not headerLen or headerLen <= 0 then return nil end
  local ok, header = pcall(cjson.decode, string.sub(value, barIdx + 1, barIdx + headerLen))
  if not ok or type(header) ~= "table" then return nil end
  local ref = header["ref"]
  if type(ref) == "table" and type(header["h"]) == "string"
     and type(ref["projectId"]) == "string" and type(ref["hash"]) == "string" then
    return {
      projectId = ref["projectId"],
      hash = ref["hash"],
      tier = ref["tier"],
      holderId = header["h"],
    }
  end
  return nil
end

local function gqRedisNowMs()
  local now = redis.call("TIME")
  return (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
end

local function gqTakeLease(keyPrefix, lease, nowMs)
  local leaseKey = keyPrefix .. "blobleases:" .. lease.projectId .. "/" .. lease.hash
  redis.call("ZREMRANGEBYSCORE", leaseKey, "-inf", nowMs)
  redis.call("ZADD", leaseKey, nowMs + (${BLOB_LEASE_TTL_SECONDS} * 1000), lease.holderId)
  redis.call("EXPIRE", leaseKey, ${BLOB_LEASE_SET_TTL_SECONDS})

  -- Rolling-deploy compatibility: previous-release code still SREMs this set
  -- and UNLINKs on empty. The guard makes "last holder" unobservable while new
  -- leases exist; the mirrored token lets an old pod process the value safely.
  local legacyKey = keyPrefix .. "blobholders:" .. lease.projectId .. "/" .. lease.hash
  redis.call("SADD", legacyKey, "${LEGACY_HOLDER_LEASE_GUARD}", lease.holderId)
  redis.call("EXPIRE", legacyKey, ${BLOB_LEASE_SET_TTL_SECONDS})
  if lease.tier == "redis" then
    redis.call("EXPIRE", keyPrefix .. "blob:" .. lease.projectId .. "/" .. lease.hash, ${BLOB_BACKSTOP_TTL_SECONDS})
  end
end

-- Take the replacement lease and release the displaced lease in the caller's
-- atomic stage eval. Tenant-mismatched refs are left to their backstops.
local function gqSquashTransferLeases(keyPrefix, tenant, newValue, oldValue)
  local newLease = gqParseLease(newValue)
  local oldLease = gqParseLease(oldValue)
  local nowMs = gqRedisNowMs()
  if newLease and newLease.projectId == tenant then
    gqTakeLease(keyPrefix, newLease, nowMs)
  end
  if not oldLease then return 0 end
  if oldLease.projectId ~= tenant then return 0 end
  -- A same-set same-token pair is a renewal: gqTakeLease already moved its deadline.
  if newLease and newLease.projectId == oldLease.projectId
     and newLease.hash == oldLease.hash and newLease.holderId == oldLease.holderId then
    return 0
  end
  local oldLeaseKey = keyPrefix .. "blobleases:" .. oldLease.projectId .. "/" .. oldLease.hash
  redis.call("ZREM", oldLeaseKey, oldLease.holderId)
  redis.call("ZREMRANGEBYSCORE", oldLeaseKey, "-inf", nowMs)
  local oldLegacyKey = keyPrefix .. "blobholders:" .. oldLease.projectId .. "/" .. oldLease.hash
  redis.call("SREM", oldLegacyKey, oldLease.holderId)
  -- Same grace window the standalone release eval applies: a displaced blob
  -- nothing leases any more must not sit on the full backstop.
  local oldBlobKey = ""
  if oldLease.tier == "redis" then
    oldBlobKey = keyPrefix .. "blob:" .. oldLease.projectId .. "/" .. oldLease.hash
  end
  gqGraceExpireIfUnleased(oldLeaseKey, oldLegacyKey, oldBlobKey)
  if redis.call("ZCARD", oldLeaseKey) == 0 then redis.call("DEL", oldLeaseKey) end
  return 0
end

`;

/**
 * Set of groups that may hold a pending job. Deliberately a SUPERSET: missing
 * a group mid-transition is the real risk, so over-inclusion is preferred —
 * reconcile safely prunes whatever it observes empty.
 */
export const PENDING_INDEX_HELPER_LUA = `
local function gqMarkPending(keyPrefix, groupId)
  redis.call("SADD", keyPrefix .. "pending-groups", groupId)
end
`;

/**
 * A claim's record, `group:<id>:claimed`: "token", plus "s:<id>" score and "d:<id>" body per job
 * the claim holds. A later claim that finds it with the active key gone puts the jobs back
 * (specs/claimed-job-recovery.feature). No token means a caller from before the record existed.
 */
export const CLAIMED_RECORD_HELPER_LUA = `
local function gqOwnsClaim(claimedKey, activeKey, stagedJobId, claimToken)
  local currentActive = redis.call("GET", activeKey)
  if claimToken == nil or claimToken == "" then
    return currentActive == stagedJobId
  end
  if redis.call("HGET", claimedKey, "token") ~= claimToken then return false end
  return currentActive == false or currentActive == stagedJobId
end

-- One command per bounded slice of items, summing the replies.
local function gqCallPerSlice(command, key, items, perCall)
  local total = 0
  for first = 1, #items, perCall do
    total = total + redis.call(command, key, unpack(items, first, math.min(first + perCall - 1, #items)))
  end
  return total
end

-- fields: flat "s:<id>", score, "d:<id>", body; bounded HSETs, then one expiry.
local function gqHoldClaimedJobs(claimedKey, fields)
  if #fields == 0 then return end
  gqCallPerSlice("HSET", claimedKey, fields, ${DRAIN_WRITE_CHUNK_JOBS * 4})
  redis.call("PEXPIRE", claimedKey, ${GROUP_KEY_TTL_MS})
end

-- Back to the front of the group in their original order; one INCR per job re-entering jobs.
local function gqRecoverClaimedJobs(claimedKey, jobsKey, dataKey, totalPendingKey)
  local flat = redis.call("HGETALL", claimedKey)
  if #flat == 0 then return 0 end
  local scores = {}
  local bodies = {}
  for i = 1, #flat, 2 do
    local kind = string.sub(flat[i], 1, 2)
    if kind == "s:" then scores[string.sub(flat[i], 3)] = flat[i + 1] end
    if kind == "d:" then bodies[string.sub(flat[i], 3)] = flat[i + 1] end
  end
  local recovered = 0
  for stagedJobId, score in pairs(scores) do
    local body = bodies[stagedJobId]
    if body and redis.call("ZADD", jobsKey, "NX", score, stagedJobId) == 1 then
      redis.call("HSET", dataKey, stagedJobId, body)
      redis.call("INCR", totalPendingKey)
      recovered = recovered + 1
    end
  end
  redis.call("DEL", claimedKey)
  return recovered
end
`;

/**
 * The poison guard's marker, `group:<id>:claim`: recorded with a claim and released with its
 * outcome, so neither costs a round trip of its own. See {@link CLAIM_GUARD_LUA} for why a death
 * is counted only when the previous owner publishes neither `alive` nor `retired`.
 */
export const CLAIM_MARKER_HELPER_LUA = `
local function gqRecordClaimMarker(claimKey, keyPrefix, workerId, stagedJobId, ttlSec, claimToken)
  local previous  = redis.call("HMGET", claimKey, "owner", "deaths")
  local prevOwner = previous[1]
  local deaths    = tonumber(previous[2] or "0") or 0
  local observed  = "none"
  if prevOwner then
    if prevOwner == workerId then
      observed = "self"
    else
      -- GET returns false for a missing key: no beacon at all is the death.
      local state = redis.call("GET", keyPrefix .. "worker:" .. prevOwner)
      if state then
        observed = state
      else
        observed = "gone"
        deaths = deaths + 1
      end
    end
  end
  redis.call("HSET", claimKey, "owner", workerId, "deaths", tostring(deaths), "stagedJobId", stagedJobId, "token", claimToken or "")
  redis.call("EXPIRE", claimKey, ttlSec)
  return deaths, observed
end

-- Compare-and-delete: a paused worker must not erase a new owner's marker and its death count.
-- A token binds the release to its own claim; a marker or caller without one compares the owner.
local function gqReleaseClaimMarker(claimKey, workerId, claimToken)
  if workerId == nil or workerId == "" then return 0 end
  local marker = redis.call("HMGET", claimKey, "owner", "token")
  if marker[1] ~= workerId then return 0 end
  local markerToken = marker[2] or ""
  if claimToken and claimToken ~= "" and markerToken ~= "" and markerToken ~= claimToken then
    return 0
  end
  return redis.call("DEL", claimKey)
end

-- The held claim's owner is gone: the marker is this very claim's (its token is the claimed
-- record's) and its owner has published no beacon at all at two looks CLAIM_GONE_CONFIRM_MS
-- apart by Redis's clock, not the workers'. The first look only records the suspicion; an alive
-- or retired owner, or the owner's heartbeat, clears it.
local function gqClaimOwnerGone(keyPrefix, groupId, claimedKey)
  local claimKey = keyPrefix .. "group:" .. groupId .. ":claim"
  local marker = redis.call("HMGET", claimKey, "owner", "token")
  if not marker[1] or not marker[2] or marker[2] == "" then return false end
  if redis.call("HGET", claimedKey, "token") ~= marker[2] then return false end
  local suspectKey = claimKey .. ":suspect"
  if redis.call("EXISTS", keyPrefix .. "worker:" .. marker[1]) == 1 then
    redis.call("DEL", suspectKey)
    return false
  end
  local time = redis.call("TIME")
  local nowMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local seen = marker[2] .. "|"
  local suspect = redis.call("GET", suspectKey)
  if suspect and string.sub(suspect, 1, #seen) == seen then
    return nowMs - (tonumber(string.sub(suspect, #seen + 1)) or nowMs) >= ${CLAIM_GONE_CONFIRM_MS}
  end
  redis.call("SET", suspectKey, seen .. nowMs, "PX", ${CLAIM_GONE_CONFIRM_MS * 3})
  return false
end
`;

/**
 * A group's failure state as one token: its error timestamp and whether it is blocked.
 * Stored at registration and compared at inspection, which separates this preflight's own
 * damage from an earlier release's wedge (specs/event-sourcing/migration-preflight-barrier).
 */
const PREFLIGHT_GROUP_STATE_LUA = `
local function gqPreflightGroupState(keyPrefix, blockedKey, groupId)
  local errorKey = keyPrefix .. "group:" .. groupId .. ":error"
  local stamp = ""
  if redis.call("EXISTS", errorKey) == 1 then
    stamp = redis.call("HGET", errorKey, "timestamp") or "present"
  end
  return stamp .. "|" .. redis.call("SISMEMBER", blockedKey, groupId)
end
`;

/**
 * Forgets a target holding nothing the barrier counts: no job, no claim, no new failure, never
 * blocked. Staging re-registers it, so a list keeps only its outstanding groups however long it
 * runs (specs/listed-run-memory.feature). Its keys sit beside `targetKey`, in the same slot.
 */
const SETTLED_TARGET_HELPER_LUA =
  PREFLIGHT_GROUP_STATE_LUA +
  `
local function gqForgetSettledTarget(keyPrefix, blockedKey, targetKey, groupId)
  local groupPrefix = keyPrefix .. "group:" .. groupId
  if redis.call("ZCARD", groupPrefix .. ":jobs") > 0 then return false end
  if redis.call("EXISTS", groupPrefix .. ":active", groupPrefix .. ":claimed") > 0 then return false end
  local baselineKey = targetKey .. ":baseline"
  local baseStamp, baseBlocked = string.match(redis.call("HGET", baselineKey, groupId) or "|0", "^(.*)|([01])$")
  if baseBlocked ~= "0" then return false end
  local stamp, isBlocked = string.match(gqPreflightGroupState(keyPrefix, blockedKey, groupId), "^(.*)|([01])$")
  if isBlocked ~= "0" or (stamp ~= "" and stamp ~= baseStamp) then return false end
  redis.call("SREM", targetKey, groupId)
  redis.call("HDEL", baselineKey, groupId)
  redis.call("ZREM", targetKey .. ":candidates", groupId)
  redis.call("SREM", targetKey .. ":live", groupId)
  return true
end
`;

/**
 * The ready score of a group that may still be collecting jobs: its first job plus the
 * settling window, or its oldest job's own score once it holds a full batch. A window of
 * 0 returns the job's score, as before. specs/settling-window.feature
 */
const SETTLE_HELPER_LUA = `
local function gqSettledReadyScore(jobsKey, dispatchAfter, nowMs, settleWindowMs, settleMaxBatch)
  if settleWindowMs <= 0 then return dispatchAfter end
  if redis.call("ZCARD", jobsKey) >= settleMaxBatch then
    local head = redis.call("ZRANGE", jobsKey, 0, 0, "WITHSCORES")
    if #head >= 2 then return tonumber(head[2]) end
    return dispatchAfter
  end
  return math.max(dispatchAfter, nowMs + settleWindowMs)
end
`;

// Every script's first line declares Redis 7 flags (ARCHITECTURE.md §9): `#!lua` is refused whole
// at the memory cap, `allow-oom` marks a script that frees memory or must run to drain.
const STAGE_LUA =
  "#!lua\n" +
  SETTLE_HELPER_LUA +
  PENDING_INDEX_HELPER_LUA +
  BLOB_LEASE_HELPER_LUA +
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  `
local groupJobsKey    = KEYS[1]
local readyKey        = KEYS[2]
local signalKey       = KEYS[3]
local dedupKey        = KEYS[4]
local dataKey         = KEYS[5]
local totalPendingKey = KEYS[6]
local activeKey       = KEYS[7]
local blockedKey      = KEYS[8]
local claimedKey      = KEYS[9]

local stagedJobId    = ARGV[1]
local groupId        = ARGV[2]
local dispatchAfter  = tonumber(ARGV[3])
local dedupId        = ARGV[4]
local dedupTtlMs     = tonumber(ARGV[5])
local jobDataJson    = ARGV[6]
local shouldExtend   = tonumber(ARGV[7])
local shouldReplace  = tonumber(ARGV[8])
local nowMs          = tonumber(ARGV[9])
-- Global in-flight budget; when set (>0), record this tenant as a live claimant
-- in the demanding-tenants recency ZSET so the water-level recompute counts its
-- demand even while its first burst is still entirely in ready (not yet
-- dispatched). Enqueue-only freshness is the true "actively submitting" signal:
-- a tenant that stops enqueuing ages out of the window even while it drains, so
-- a bursted-then-idle tenant cannot linger as a phantom claimant.
local globalBudget   = tonumber(ARGV[10]) or 0
-- A claim re-staging what it holds; a worker whose claim another worker recovered stages nothing.
local claimToken     = ARGV[12] or ""
-- A fresh send's settling window and the batch that ends it early; absent (a restage) settles nothing.
local settleWindowMs = tonumber(ARGV[13]) or 0
local settleMaxBatch = tonumber(ARGV[14]) or 1
if claimToken ~= "" and redis.call("HGET", claimedKey, "token") ~= claimToken then
  return {-1, ""}
end
if globalBudget > 0 then
  redis.call("ZADD", parkKeyPrefixOf(readyKey) .. "demanding-tenants", nowMs, parkTenantOf(groupId))
end
-- Opt-in (default 0 = unchanged behavior). When 1, a dedup key whose job has
-- already been DISPATCHED but whose TTL is still alive HONORS the dispatch and
-- squashes the new job instead of DEL+restaging, so a late re-trigger after
-- dispatch cannot re-run the command (fixes #3912 double evaluations).
local shouldSurviveDispatch = tonumber(ARGV[11]) or 0

-- Skip ready-score updates while the group is processing (active key set) or
-- blocked. In those states the ready score is owned by REFRESH_LUA / COMPLETE_LUA
-- (active) or by UNBLOCK (blocked). Lowering it here would re-expose the group
-- to ZRANGEBYSCORE before the next heartbeat refreshes it.
-- Read once, and only by a path that writes the group; the TTL helper needs it too.
local blockedState = nil
local function isBlocked()
  if blockedState == nil then blockedState = redis.call("SISMEMBER", blockedKey, groupId) == 1 end
  return blockedState
end
local function shouldUpdateReady()
  if isBlocked() then return false end
  if redis.call("EXISTS", activeKey) == 1 then return false end
  return true
end

if dedupId ~= "" and dedupTtlMs > 0 then
  local existingJobId = redis.call("GET", dedupKey)
  if existingJobId then
    local rank = redis.call("ZRANK", groupJobsKey, existingJobId)
    if rank then
      -- Still in staging: squash in place (net zero pending count change). The
      -- squash drops one payload on the floor. On replace the OLD stored value
      -- is displaced and its blob lease is moved to the replacement HERE, in
      -- the same eval as the displacement — a fire-and-forget transfer after
      -- the eval can reorder against a concurrent squash of the same dedup id
      -- and leave a phantom lifecycle entry (the 2026-07-09 leak). Without replace the
      -- NEW value we were just handed is the one discarded; it was never
      -- staged, so no lease is recorded for it. Content-addressed bytes remain
      -- governed by the leases of jobs sharing them and the TTL backstop.
      local orphanedValue = jobDataJson
      if shouldExtend == 1 then
        redis.call("ZADD", groupJobsKey, dispatchAfter, existingJobId)
        gqMarkPending(parkKeyPrefixOf(readyKey), groupId)
      end
      if shouldReplace == 1 then
        orphanedValue = redis.call("HGET", dataKey, existingJobId) or ""
        redis.call("HSET", dataKey, existingJobId, jobDataJson)
        gqSquashTransferLeases(parkKeyPrefixOf(readyKey), parkTenantOf(groupId), jobDataJson, orphanedValue)
      else
      end
      redis.call("SET", dedupKey, existingJobId, "PX", dedupTtlMs)
      -- Score = earliest pending dispatchAfter (LT keeps the smallest score per group)
      if shouldUpdateReady() then
        addToReadyOrParked(readyKey, groupId, gqSettledReadyScore(groupJobsKey, dispatchAfter, nowMs, settleWindowMs, settleMaxBatch), true)
      end
      refreshGroupKeyTtl(groupJobsKey, dataKey, nowMs, isBlocked())
      redis.call("LPUSH", signalKey, "1")
      redis.call("LTRIM", signalKey, 0, 999)
      return {0, orphanedValue}
    end
    -- Already dispatched. Default: the dedup key is stale, clean it up and let a
    -- new job stage (the historical TOCTOU behavior). When shouldSurviveDispatch is
    -- set, HONOR the still-alive TTL instead — squash the new job and report its
    -- payload as the orphaned value so a late re-trigger after dispatch cannot
    -- re-run it (#3912).
    -- The discarded value was never staged, so no lease is recorded for it.
    if shouldSurviveDispatch == 1 then
      return {0, jobDataJson}
    end
    redis.call("DEL", dedupKey)
  end
end

local inserted = redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
gqMarkPending(parkKeyPrefixOf(readyKey), groupId)
redis.call("HSET", dataKey, stagedJobId, jobDataJson)
local stagedLease = gqParseLease(jobDataJson)
if stagedLease and stagedLease.projectId == parkTenantOf(groupId) then
  gqTakeLease(parkKeyPrefixOf(readyKey), stagedLease, gqRedisNowMs())
end
refreshGroupKeyTtl(groupJobsKey, dataKey, nowMs, isBlocked())

if dedupId ~= "" and dedupTtlMs > 0 then
  redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
end

-- Score = earliest pending dispatchAfter (LT keeps the smallest score per group)
if shouldUpdateReady() then
  addToReadyOrParked(readyKey, groupId, gqSettledReadyScore(groupJobsKey, dispatchAfter, nowMs, settleWindowMs, settleMaxBatch), true)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- Counter conservation (specs/pending-counter-conservation
-- .feature): INCR only when the ZADD actually inserted a member. A re-send of
-- the same stagedJobId (at-least-once event delivery) updates the member in
-- place; an unconditional INCR here has no compensating DECR and drifts the
-- counter upward permanently. Mirrors RETRY_RESTAGE_LUA's inserted guard.
if inserted == 1 then
  redis.call("INCR", totalPendingKey)
end

-- A genuinely new stage displaces nothing; its lease was taken with the HSET.
return {1, ""}
`;

const STAGE_BATCH_LUA =
  "#!lua\n" +
  SETTLE_HELPER_LUA +
  PENDING_INDEX_HELPER_LUA +
  BLOB_LEASE_HELPER_LUA +
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  `
local readyKey        = KEYS[1]
local signalKey       = KEYS[2]
local totalPendingKey = KEYS[3]

local keyPrefix = ARGV[1]
local count     = tonumber(ARGV[2])
-- nowMs and globalBudget are appended after all per-job args: globalBudget is
-- always last, nowMs just before it. globalBudget>0 enables the dynamic cap, in
-- which case each enqueued group's tenant is recorded as a live claimant in the
-- demanding-tenants recency ZSET (see STAGE_LUA for the enqueue-only rationale).
local globalBudget = tonumber(ARGV[#ARGV]) or 0
local nowMs        = tonumber(ARGV[#ARGV - 1])

local newStagedCount = 0
local affectedGroups = {}
-- Per-job (index-aligned) displaced values; "" for a genuine new stage.
-- Mirrors STAGE_LUA's single-job report. Leases are transferred in this eval.
local orphanedValues = {}
-- Per-job (index-aligned) outcome: 0 squashed by dedup, 1 a new member, 2 an existing id restaged.
local outcomes = {}
-- Per group: the smallest settling window and batch among its jobs (see STAGE_LUA).
local settleWindows = {}
local settleBatches = {}
-- Per group: blocked or not, read once; ready bookkeeping and the TTL helper both need it.
local blockedKey = keyPrefix .. "blocked"
local blockedGroups = {}
local function isGroupBlocked(groupId)
  if blockedGroups[groupId] == nil then
    blockedGroups[groupId] = redis.call("SISMEMBER", blockedKey, groupId) == 1
  end
  return blockedGroups[groupId]
end

for i = 1, count do
  -- Per-job stride is 11: stagedJobId..shouldReplace (8) + shouldSurviveDispatch
  -- + settleWindowMs + settleMaxBatch. nowMs/globalBudget stay appended once after
  -- the loop and are read end-relative, so they are unaffected by the stride.
  local offset = 2 + (i - 1) * 11
  local stagedJobId   = ARGV[offset + 1]
  local groupId       = ARGV[offset + 2]
  local dispatchAfter = tonumber(ARGV[offset + 3])
  local dedupId       = ARGV[offset + 4]
  local dedupTtlMs    = tonumber(ARGV[offset + 5])
  local jobDataJson   = ARGV[offset + 6]
  local shouldExtend  = tonumber(ARGV[offset + 7])
  local shouldReplace = tonumber(ARGV[offset + 8])
  -- Opt-in (default 0 = unchanged). See STAGE_LUA: when 1, a dispatched-but-TTL-
  -- alive dedup key squashes the new job instead of being cleaned up (#3912).
  local shouldSurviveDispatch = tonumber(ARGV[offset + 9]) or 0
  local settleWindowMs = tonumber(ARGV[offset + 10]) or 0
  local settleMaxBatch = tonumber(ARGV[offset + 11]) or 1

  local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
  local dataKey      = keyPrefix .. "group:" .. groupId .. ":data"
  local dedupKey     = (dedupId ~= "") and (keyPrefix .. "dedup:" .. dedupId) or (keyPrefix .. "dedup:__none__")

  local isDeduped = false
  local orphanedValue = ""
  -- True only for the post-dispatch squash (already-dispatched dedup honored):
  -- that item stages no job AND the deduped job is already gone, so it must NOT
  -- contribute this group to the post-loop ready bookkeeping (see below).
  local squashedPostDispatch = false
  if dedupId ~= "" and dedupTtlMs > 0 then
    local existingJobId = redis.call("GET", dedupKey)
    if existingJobId then
      local rank = redis.call("ZRANK", groupJobsKey, existingJobId)
      if rank then
        -- Still in staging: squash in place. On replace the OLD stored value is
        -- displaced and its lease moved to the replacement here, atomic with the
        -- displacement (see STAGE_LUA); else the NEW value we were handed is
        -- dropped, was never staged, and gets no lease.
        orphanedValue = jobDataJson
        if shouldExtend == 1 then
          redis.call("ZADD", groupJobsKey, dispatchAfter, existingJobId)
          gqMarkPending(keyPrefix, groupId)
        end
        if shouldReplace == 1 then
          orphanedValue = redis.call("HGET", dataKey, existingJobId) or ""
          redis.call("HSET", dataKey, existingJobId, jobDataJson)
          gqSquashTransferLeases(keyPrefix, parkTenantOf(groupId), jobDataJson, orphanedValue)
        else
        end
        redis.call("SET", dedupKey, existingJobId, "PX", dedupTtlMs)
        isDeduped = true
      else
        -- Already dispatched. Default: the dedup key is stale, clean it up and let
        -- a new job stage (the historical TOCTOU behavior). When shouldSurviveDispatch
        -- is set, HONOR the still-alive TTL instead — squash the new job (mark it
        -- deduped and report its payload as orphaned, mirroring the in-staging
        -- squash above) so a late re-trigger after dispatch cannot re-run it (#3912).
        if shouldSurviveDispatch == 1 then
          orphanedValue = jobDataJson
          isDeduped = true
          squashedPostDispatch = true
        else
          redis.call("DEL", dedupKey)
        end
      end
    end
  end

  if not isDeduped then
    -- Counter conservation: count only members the ZADD actually inserted
    -- (see STAGE_LUA). A duplicate stagedJobId — re-delivered event id, or
    -- the same payload twice in one batch — updates in place and must not
    -- inflate newStagedCount, which feeds the total-pending INCRBY below.
    local inserted = redis.call("ZADD", groupJobsKey, dispatchAfter, stagedJobId)
    gqMarkPending(keyPrefix, groupId)
    redis.call("HSET", dataKey, stagedJobId, jobDataJson)
    local stagedLease = gqParseLease(jobDataJson)
    if stagedLease and stagedLease.projectId == gqTenantOf(groupId) then
      gqTakeLease(keyPrefix, stagedLease, gqRedisNowMs())
    end
    if dedupId ~= "" and dedupTtlMs > 0 then
      redis.call("SET", dedupKey, stagedJobId, "PX", dedupTtlMs)
    end
    if inserted == 1 then
      newStagedCount = newStagedCount + 1
      outcomes[i] = 1
    else
      outcomes[i] = 2
    end
  else
    outcomes[i] = 0
  end
  orphanedValues[i] = orphanedValue

  refreshGroupKeyTtl(groupJobsKey, dataKey, nowMs, isGroupBlocked(groupId))

  -- Track minimum dispatchAfter per affected group. A post-dispatch squash is
  -- skipped: it staged no job and the deduped job already left staging, so
  -- adding the group here would reinsert a drained (empty) group into ready /
  -- demanding-tenants after the loop. A normal stage and an in-staging squash
  -- (rank found — that job IS staged) still register, so the group stays ready.
  if not squashedPostDispatch then
    local existingMin = affectedGroups[groupId]
    if existingMin == nil or dispatchAfter < existingMin then
      affectedGroups[groupId] = dispatchAfter
    end
    if settleWindows[groupId] == nil or settleWindowMs < settleWindows[groupId] then
      settleWindows[groupId] = settleWindowMs
    end
    if settleBatches[groupId] == nil or settleMaxBatch < settleBatches[groupId] then
      settleBatches[groupId] = settleMaxBatch
    end
  end
end

for groupId, minScore in pairs(affectedGroups) do
  if globalBudget > 0 then
    redis.call("ZADD", keyPrefix .. "demanding-tenants", nowMs, parkTenantOf(groupId))
  end
  -- Score = earliest pending dispatchAfter (LT keeps the smallest).
  -- Skip when the group is processing or blocked — the active heartbeat /
  -- completion / unblock paths own the score in those states. Lowering it
  -- here would re-expose the group to ZRANGEBYSCORE before the next refresh.
  local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
  if not isGroupBlocked(groupId) and redis.call("EXISTS", activeKey) == 0 then
    local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
    local score = gqSettledReadyScore(jobsKey, minScore, nowMs, settleWindows[groupId], settleBatches[groupId])
    addToReadyOrParked(readyKey, groupId, score, true)
  end
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- Increment total pending counter by number of new (non-deduped) jobs
if newStagedCount > 0 then
  redis.call("INCRBY", totalPendingKey, newStagedCount)
end

return {newStagedCount, orphanedValues, outcomes}
`;

const DISPATCH_BATCH_LUA =
  "#!lua flags=allow-oom\n" +
  PENDING_INDEX_HELPER_LUA +
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  WATER_LEVEL_HELPER_LUA +
  ROUTING_META_HELPER_LUA +
  CLAIMED_RECORD_HELPER_LUA +
  CLAIM_MARKER_HELPER_LUA +
  SETTLED_TARGET_HELPER_LUA +
  `
local function gqCandidateScore(keyPrefix, blockedKey, groupId, readyScore, nowMs)
  local groupPrefix = keyPrefix .. "group:" .. groupId
  if redis.call("EXISTS", groupPrefix .. ":claimed") > 0 then return nowMs + ${IN_FLIGHT_CANDIDATE_DELAY_MS} end
  -- A retry backoff drops the claim, keeps :active and moves the ready score to its due time.
  if redis.call("EXISTS", groupPrefix .. ":active") > 0 then
    return math.max(nowMs + ${IN_FLIGHT_CANDIDATE_DELAY_MS}, tonumber(readyScore) or 0)
  end
  if redis.call("ZCARD", groupPrefix .. ":jobs") == 0 then return nowMs + ${SETTLED_CANDIDATE_DELAY_MS} end
  -- Work out of ready is parked or paused; work in ready may still be blocked.
  if not readyScore or redis.call("SISMEMBER", blockedKey, groupId) == 1 then
    return nowMs + ${WAITING_CANDIDATE_DELAY_MS}
  end
  if tonumber(readyScore) > nowMs then return tonumber(readyScore) end
  return nowMs
end

local readyKey         = KEYS[1]
local blockedKey       = KEYS[2]
local pausedJobKey     = KEYS[3]
local totalPendingKey  = KEYS[4]
local allowedGroupsKey = KEYS[5]

local keyPrefix      = ARGV[1]
local nowMs          = tonumber(ARGV[2])
local activeTtlSec   = tonumber(ARGV[3])
local maxJobs        = tonumber(ARGV[4])
-- Static operator soft-cap (post-2026-05-11 incident follow-up). 0 = explicit
-- kill switch (LANGWATCH_DISPATCH_TENANT_CAP=0): no cap, no parking. > 0 is the
-- per-tenant in-flight ceiling AND the fail-protective fallback for the dynamic
-- cap below. The tenantId is the groupId prefix (segment before first '/').
local staticCap      = tonumber(ARGV[5]) or 0
-- Global in-flight budget for the DYNAMIC water-level cap (option C). It is the
-- hard ceiling = pods x concurrency; the water-fill divides the WHOLE capacity.
-- 0 = dynamic disabled, dispatch uses the static cap unchanged (back-compat).
local globalBudget   = tonumber(ARGV[6]) or 0
local restrictedDispatch = ARGV[7] == "1"
-- A listed run's group set, whose settled groups leave it as the scan meets them.
local settledTargetKey = nil
if restrictedDispatch and ARGV[8] and ARGV[8] ~= "" then settledTargetKey = ARGV[8] end
-- Cross-group batches (ARCHITECTURE §9): maxJobs counts batches, each up to groupsPerBatch
-- ready groups of one tenant and one listed handler. 1 claims every group alone, as before.
local groupsPerBatch = tonumber(ARGV[9]) or 1
if groupsPerBatch < 1 or restrictedDispatch then groupsPerBatch = 1 end
local batchRoutes = {}
if groupsPerBatch > 1 and ARGV[10] then
  for route in string.gmatch(ARGV[10], "[^\\n]+") do batchRoutes[route] = true end
end
-- Every group claimed this eval, whatever batch it joined: one eval's work stays bounded.
local maxGroups = tonumber(ARGV[11]) or 0
if maxGroups <= 0 then maxGroups = maxJobs * groupsPerBatch end
-- The poison guard's marker rides each claim, but only while this worker's own beacon says
-- "alive": a marker no beacon vouches for would read to every peer as a death. "" = no marker.
local guardWorkerId = ARGV[12] or ""
local guardTtlSec = tonumber(ARGV[13]) or 0
if guardWorkerId ~= "" and (guardTtlSec <= 0 or redis.call("GET", keyPrefix .. "worker:" .. guardWorkerId) ~= "alive") then
  guardWorkerId = ""
end
-- The claiming worker: a group whose job it handed back is passed over (#9148). "" = none.
local claimWorkerId = ARGV[14] or ""
-- The soonest a group passed over for this worker comes due to it again; nil = none passed over.
local passOverUntilMs = nil
local claimedGroups = 0
-- Open batches by tenant and handler, and how many more groups they can still take.
local openBatches = {}
local openRoom = 0
local openRoomByTenant = {}

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local activeUntil = nowMs + activeTtlSec * 1000
local results = {}
-- Jobs put back from a dead worker's claimed record, reported for gq_jobs_recovered_total.
local recoveredTotal = 0

-- Restore parked over-cap groups + recompute the water-level on a cadence (TRAP 2
-- orphan recovery + cap=0 drain). COMPLETE-unpark handles the normal slot-freeing
-- as jobs finish; this only backstops what it can't: a crashed/timed-out tenant
-- that never fires COMPLETE (its in-flight slots lapse out of the live count as
-- their expiry scores pass = back under cap = unpark), and flipping the cap off
-- (drain everything parked). Time- and SCARD-gated so it is a no-op at the cap=0
-- steady state and single-pod via reconcile-ts; the water-fill rides the same
-- proven cadence at near-zero marginal cost.
local reconcileTsKey = keyPrefix .. "reconcile-ts"
local lastReconcile = tonumber(redis.call("GET", reconcileTsKey)) or 0
if (nowMs - lastReconcile) >= ${RECONCILE_INTERVAL_MS} then
  redis.call("SET", reconcileTsKey, nowMs)
  if staticCap > 0 and globalBudget > 0 then
    recomputeDynamicCap(keyPrefix, globalBudget, nowMs)
  end
  if redis.call("SCARD", keyPrefix .. "parked-tenants") > 0 then
    local reconcileCap = staticCap
    if staticCap > 0 and globalBudget > 0 then
      reconcileCap = effectiveCap(keyPrefix, staticCap)
    end
    reconcileParked(readyKey, keyPrefix, reconcileCap, nowMs)
  end
end

-- Not on the reconcile cadence: an unpause restores its lane on the next dispatch.
if redis.call("SCARD", keyPrefix .. "parked-lanes") > 0 then
  restoreUnpausedLanes(readyKey, keyPrefix, pausedJobKey, nowMs)
end

-- Effective per-tenant cap: dynamic water-level when a budget is configured,
-- else the static cap. staticCap=0 (kill switch) wins and disables parking.
local tenantCap = staticCap
if staticCap > 0 and globalBudget > 0 then
  tenantCap = effectiveCap(keyPrefix, staticCap)
end

-- A listed run's group this scan parked waits out its delay before the run's scan looks again.
local function deferCandidate(groupId)
  if restrictedDispatch then
    redis.call("ZADD", allowedGroupsKey, nowMs + ${WAITING_CANDIDATE_DELAY_MS}, groupId)
  end
end

-- Scan ready in priority order and dispatch up to maxJobs, appending to results.
-- effCap gates the per-tenant cap (0 = off). bypassPark skips the over-cap PARK
-- decision (work-conserving override) while still recording the in-flight slot.
-- Returns the new dispatched total.
local function scanBatch(effCap, bypassPark, dispatched)
  -- Over-fetch 3x (min 30) per page for blocked/paused/legacy-drift headroom,
  -- then page through up to scanBudget so a head full of paused/blocked groups
  -- does not starve runnable groups deeper in the zset. Widen the budget when
  -- the cap is on so a head full of one over-cap tenant cannot starve others.
  local pageSize = maxJobs * 3
  if pageSize < 30 then pageSize = 30 end
  local scanBudget = pageSize * 5
  if effCap > 0 then scanBudget = pageSize * 50 end
  local offset = 0
  -- Work bound: total entries EXAMINED this eval, independent of the offset.
  -- The offset stalls when a whole page is parked out of ready (the zset
  -- shifts left under it); bounding on the offset alone would then let one
  -- eval park an unbounded backlog and block the single Redis thread.
  local scanned = 0
  local tenantCapCache = {}
  local function canClaimMore()
    return claimedGroups < maxGroups and (dispatched < maxJobs or openRoom > 0)
  end

  while scanned < scanBudget and canClaimMore() do
    local groups
    if not restrictedDispatch then
      groups = redis.call("ZRANGEBYSCORE", readyKey, "-inf", nowMs, "LIMIT", offset, pageSize)
    else
      -- Below nowMs only: each examined group leaves or is re-scored to nowMs or later, so a
      -- call looks at a candidate once instead of re-reading the same head until its budget.
      groups = redis.call("ZRANGEBYSCORE", allowedGroupsKey, "-inf", "(" .. ARGV[2], "LIMIT", offset, pageSize)
    end
    if #groups == 0 then break end
    scanned = scanned + #groups

    -- Groups this page removed from the due window (parked, dispatched, or
    -- drift-cleaned). Removals shift the zset left under the offset-based
    -- pagination, so the offset must advance only past entries that STAYED
    -- (blocked / job-paused / active). Advancing by the raw pageSize skipped
    -- the shifted entries — with a small page and a head full of one over-cap
    -- tenant, the scan could page past a quiet tenant's only group and return
    -- empty while eligible work existed.
    local removed = 0
    local removedAllowed = 0

    for _, groupId in ipairs(groups) do
      if not canClaimMore() then break end

      -- A listed run's target holding nothing leaves it (staging a job re-registers it); moving
      -- the other examined ones to the tail gives waiting targets a bounded path through them.
      local readyScore = nil
      local groupDue = true
      if restrictedDispatch then
        readyScore = redis.call("ZSCORE", readyKey, groupId)
        groupDue = readyScore and tonumber(readyScore) <= nowMs
        if settledTargetKey and gqForgetSettledTarget(keyPrefix, blockedKey, settledTargetKey, groupId) then
          groupDue = false
        else
          -- Re-queued by when it can next run: a waiting group at its due time, a failed one an
          -- hour back, so a retried job is not stuck behind every group the run already finished.
          redis.call("ZADD", allowedGroupsKey, gqCandidateScore(keyPrefix, blockedKey, groupId, readyScore, nowMs), groupId)
        end
        removedAllowed = removedAllowed + 1
      end
      -- A held group that came due (a late heartbeat, a dead owner) is checked ahead of the cap
      -- and pause checks, which must never park a running group. Its owner gone, the active key
      -- and the dead claim's tenant slot go and the recovery below puts its jobs back; else it is
      -- looked at again at the recheck or when the active key lapses (a retry's hold), if sooner.
      local heldMs = groupDue and redis.call("PTTL", keyPrefix .. "group:" .. groupId .. ":active") or -2
      if heldMs > 0 then
        if gqClaimOwnerGone(keyPrefix, groupId, keyPrefix .. "group:" .. groupId .. ":claimed") then
          redis.call("DEL", keyPrefix .. "group:" .. groupId .. ":active", keyPrefix .. "group:" .. groupId .. ":claim:suspect")
          local heldTenant = parkTenantOf(groupId)
          tenantActiveRemove(keyPrefix .. "tenant_active_z:", heldTenant, groupId)
          tenantCapCache[heldTenant] = nil
        else
          redis.call("ZADD", readyKey, "XX", nowMs + math.min(heldMs, ${CLAIM_RECHECK_MS}), groupId)
          removed = removed + 1
          groupDue = false
        end
      end
      if groupDue then

      -- Tenant cap check (no-op when effCap == 0). capTenantId resolved
      -- regardless of bypassPark so the slot is still recorded; only the PARK
      -- decision is skipped under bypassPark.
      local tenantOverCap = false
      local capTenantId = nil
      if effCap > 0 then
        local slashPos = string.find(groupId, "/", 1, true)
        if slashPos and slashPos > 1 then
          capTenantId = string.sub(groupId, 1, slashPos - 1)
          if not bypassPark then
            local cached = tenantCapCache[capTenantId]
            if cached == nil then
              cached = tenantActiveCount(keyPrefix .. "tenant_active_z:", capTenantId, nowMs) >= effCap
              tenantCapCache[capTenantId] = cached
            end
            if cached then
              tenantOverCap = true
              removed = removed + parkGroup(readyKey, groupId)
              deferCandidate(groupId)
            end
          end
        end
      end
      -- Tenant-level pause: park OUT of ready instead of skip-in-place so a large
      -- paused backlog cannot plug the bounded scan and starve others.
      local tenantPaused = false
      if hasPauses then
        if redis.call("SISMEMBER", pausedJobKey, "tenant:" .. parkTenantOf(groupId)) == 1 then
          tenantPaused = true
          removed = removed + parkGroup(readyKey, groupId)
          deferCandidate(groupId)
        end
      end

      if not tenantOverCap and not tenantPaused then
        if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
          local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
          -- Defensive activeKey check — covers legacy state during migration
          -- and the small race between ZADD ready and ZADD active.
          local activeJob = redis.call("GET", activeKey)
          -- Each worker that handed this group's job back leaves it ready for a peer asleep in its
          -- signal wait, until its own entry lapses; a completion clears them all (#9148).
          local passedOver = false
          if not activeJob and claimWorkerId ~= "" then
            local handedBackUntil = tonumber(redis.call("ZSCORE", keyPrefix .. "group:" .. groupId .. ":handed-back-by", claimWorkerId))
            if handedBackUntil and handedBackUntil > nowMs then
              passedOver = true
              if not passOverUntilMs or handedBackUntil < passOverUntilMs then passOverUntilMs = handedBackUntil end
            end
          end

          if not activeJob and not passedOver then
          local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
          local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
          local claimedKey = keyPrefix .. "group:" .. groupId .. ":claimed"
          -- No active key but a claimed record: the worker that claimed died. Its
          -- jobs go back to the front of the group before anything is claimed.
          local recovered = gqRecoverClaimedJobs(claimedKey, jobsKey, dataKey, totalPendingKey)
          if recovered > 0 then
            recoveredTotal = recoveredTotal + recovered
            gqMarkPending(keyPrefix, groupId)
            refreshGroupKeyTtl(jobsKey, dataKey, nowMs)
          end
          local jobResults = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, 1)

          if #jobResults >= 2 then
            local stagedJobId = jobResults[1]
            local originalScore = jobResults[2]
            -- One HGET per group: false (no body) is a value too, which the claim below reuses.
            -- With slots full and no batch of this tenant open, nothing can claim it unread.
            local headFetched = false
            local headJson = nil
            local p, t, n = nil, nil, nil
            if hasPauses or (groupsPerBatch > 1 and (dispatched < maxJobs or (openRoomByTenant[parkTenantOf(groupId)] or 0) > 0)) then
              headJson = redis.call("HGET", dataKey, stagedJobId)
              headFetched = true
              if headJson then p, t, n = gqRoutingMeta(headJson) end
            end

            -- Check pause status before dequeuing. A paused lane parks the group
            -- out of ready under the matched entry (specs/queue-pausing).
            local paused = false
            if hasPauses then
              if headJson then
                local pIsStr = type(p) == "string"
                local tIsStr = type(t) == "string"
                local nIsStr = type(n) == "string"
                local pausedBy = nil
                if pIsStr then
                  if redis.call("SISMEMBER", pausedJobKey, p) == 1 then pausedBy = p
                  elseif tIsStr and redis.call("SISMEMBER", pausedJobKey, p .. "/" .. t) == 1 then pausedBy = p .. "/" .. t
                  elseif tIsStr and nIsStr and redis.call("SISMEMBER", pausedJobKey, p .. "/" .. t .. "/" .. n) == 1 then pausedBy = p .. "/" .. t .. "/" .. n
                  end
                end
                if pausedBy then
                  paused = true
                  removed = removed + parkLaneGroup(readyKey, groupId, pausedBy)
                  deferCandidate(groupId)
                end
              end
            end

            -- The batch this group joins: an open one of its tenant and handler, else a new slot.
            -- With every slot taken and no batch of its own open, it stays ready for the next claim.
            local batchKey = nil
            if groupsPerBatch > 1 and headJson and not paused then
              if type(p) == "string" and type(t) == "string" and type(n) == "string" and batchRoutes[p .. "/" .. t .. "/" .. n] then
                batchKey = parkTenantOf(groupId) .. "|" .. p .. "/" .. t .. "/" .. n
              end
            end
            local batchSlot = nil
            local openBatch = batchKey and openBatches[batchKey]
            if openBatch and openBatch.count < groupsPerBatch then
              batchSlot = openBatch.slot
            elseif dispatched < maxJobs then
              batchSlot = dispatched + 1
            end

            if not paused and batchSlot then
              if batchSlot > dispatched then
                dispatched = dispatched + 1
                if batchKey then
                  openBatches[batchKey] = {slot = batchSlot, count = 1}
                  openRoom = openRoom + groupsPerBatch - 1
                  local tenant = parkTenantOf(groupId)
                  openRoomByTenant[tenant] = (openRoomByTenant[tenant] or 0) + groupsPerBatch - 1
                end
              else
                openBatch.count = openBatch.count + 1
                openRoom = openRoom - 1
                local tenant = parkTenantOf(groupId)
                openRoomByTenant[tenant] = openRoomByTenant[tenant] - 1
              end
              claimedGroups = claimedGroups + 1
              redis.call("ZREM", jobsKey, stagedJobId)
              redis.call("DECR", totalPendingKey)
              redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)

              -- Held: half the active TTL out, past the first heartbeat, so a live claim never comes
              -- due while a dead owner's does, long before its active key lapses.
              redis.call("ZADD", readyKey, nowMs + activeTtlSec * ${HELD_RESCORE_MS_PER_TTL_SEC}, groupId)
              if restrictedDispatch then
                redis.call("ZADD", allowedGroupsKey, nowMs + ${IN_FLIGHT_CANDIDATE_DELAY_MS}, groupId)
              end

              -- Tenant in-flight slot (self-healing ZSET; only when cap is set).
              -- Recorded even under bypassPark so override dispatches are counted.
              if effCap > 0 and capTenantId then
                tenantActiveAdd(keyPrefix .. "tenant_active_z:", capTenantId, groupId, activeUntil)
                -- Invalidate cache — count changed, may now be at cap
                tenantCapCache[capTenantId] = nil
              end

              local jobDataJson = headJson
              if not headFetched then jobDataJson = redis.call("HGET", dataKey, stagedJobId) end
              -- The body moves into this claim's record rather than being deleted, so a death
              -- before completion cannot lose it. Recovery above left no earlier record to clear.
              local claimToken = tostring(nowMs) .. "." .. tostring(redis.call("INCR", keyPrefix .. "claim-seq"))
              if jobDataJson then
                redis.call("HDEL", dataKey, stagedJobId)
                redis.call("HSET", claimedKey, "token", claimToken, "s:" .. stagedJobId, originalScore, "d:" .. stagedJobId, jobDataJson)
              else
                redis.call("HSET", claimedKey, "token", claimToken)
              end
              redis.call("PEXPIRE", claimedKey, ${GROUP_KEY_TTL_MS})

              results[#results + 1] = stagedJobId
              results[#results + 1] = groupId
              results[#results + 1] = jobDataJson or ""
              results[#results + 1] = tostring(originalScore)
              results[#results + 1] = claimToken
              -- The retry-chain counter rides back with the claim; only the claim holder writes it.
              local groupAttempt = redis.call("GET", keyPrefix .. "group:" .. groupId .. ":attempt")
              results[#results + 1] = groupAttempt or ""
              results[#results + 1] = tostring(batchSlot)
              -- Confirmed deaths and the previous owner's state, or "" "" with no marker written.
              if guardWorkerId ~= "" then
                local deaths, observed = gqRecordClaimMarker(keyPrefix .. "group:" .. groupId .. ":claim", keyPrefix, guardWorkerId, stagedJobId, guardTtlSec, claimToken)
                results[#results + 1] = tostring(deaths)
                results[#results + 1] = observed
              else
                results[#results + 1] = ""
                results[#results + 1] = ""
              end
              -- The activeUntil re-score above moved the group out of the due
              -- window: it no longer occupies a slot in the next page read.
              removed = removed + 1
            end
          else
            -- Group is in ready but has no due jobs — drift cleanup. Both
            -- branches take the group out of the due window (ZREM, or a
            -- re-score to the earliest pending job which is necessarily in
            -- the future — a due job would have dispatched above).
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
            removed = removed + 1
          end
      end
      end
      end
      end
    end

    if #groups < pageSize then break end
    -- Advance only past the entries that stayed in the due window; the removed
    -- ones shifted everything after them left by exactly that many positions.
    if not restrictedDispatch then
      offset = offset + #groups - removed
    else
      offset = offset + #groups - removedAllowed
    end
  end

  return dispatched
end

local dispatched = scanBatch(tenantCap, false, 0)

-- Slots this eval filled by overriding the cap, reported alongside the results.
-- Without it a high parked count is unreadable: "the cap is throttling work"
-- and "the fleet is saturated so the override had no slot to give" produce the
-- same gauge, and only this number tells them apart.
local overrideDispatched = 0

-- Work-conserving override: spare local slots remain (dispatched < maxJobs) but
-- nothing more was admittable under the cap, while over-cap work sits parked.
-- Fairness binds only under contention; spare capacity = no contention, so fill
-- the idle slots from the least-served over-cap tenant rather than return short
-- and idle the fleet (the static-cap idle-behind-cap sin). Bounded to the
-- remaining slots; this pod's free-slot budget keeps the fleet total at G.
-- Not on a listed run's claim: its scan only runs the run's groups, so the groups it would
-- unpark go straight back to parked on the next full dispatch.
if not restrictedDispatch and globalBudget > 0 and tenantCap > 0 and dispatched < maxJobs and redis.call("SCARD", keyPrefix .. "parked-tenants") > 0 then
  unparkLeastServedParked(readyKey, keyPrefix, pausedJobKey, nowMs, maxJobs - dispatched)
  local beforeOverride = dispatched
  dispatched = scanBatch(tenantCap, true, dispatched)
  overrideDispatched = dispatched - beforeOverride
end

return {results, overrideDispatched, recoveredTotal, passOverUntilMs or 0}
`;

/**
 * Pops up to maxJobs additional DUE jobs without touching active/ready/
 * blocked/signal state. Safe only while the caller holds the group's active
 * slot. Stops at a job-count or byte cap; an oversized job stays staged, never dropped.
 */
const DRAIN_GROUP_LUA =
  "#!lua flags=allow-oom\n" +
  PAYLOAD_SIZE_HELPER_LUA +
  CLAIMED_RECORD_HELPER_LUA +
  `
local jobsKey         = KEYS[1]
local dataKey         = KEYS[2]
local totalPendingKey = KEYS[3]
local claimedKey      = KEYS[4]

local nowMs        = tonumber(ARGV[1])
local maxJobs      = tonumber(ARGV[2])
local maxBytes     = tonumber(ARGV[3]) or 0
local initialBytes = tonumber(ARGV[4]) or 0
local claimToken   = ARGV[5] or ""

local results = {}
if maxJobs <= 0 then
  return results
end
-- A worker whose claim was recovered by another drains nothing into it.
if claimToken ~= "" and redis.call("HGET", claimedKey, "token") ~= claimToken then
  return results
end

-- Peek candidates in score order. HGET happens before the byte check so a job
-- that would overflow the budget can be measured and then left in staging
-- (we break rather than remove it), preserving score-ordered FIFO for the
-- next dispatch.
local entries = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, maxJobs)
local accumulated = initialBytes
local acceptedIds = {}
local heldFields = {}
local i = 1
while i < #entries do
  local stagedJobId   = entries[i]
  local originalScore = entries[i + 1]
  i = i + 2

  local jobDataJson = redis.call("HGET", dataKey, stagedJobId)
  local size = 0
  if jobDataJson then
    -- Only pay the header parse when the budget can actually bind.
    if maxBytes > 0 then
      size = gqPayloadSize(jobDataJson)
    else
      size = #jobDataJson
    end
  end

  -- Byte bound: stop before the first job that would overflow the budget.
  -- Ordering keeps the batch FIFO, so everything from here on stays staged.
  if maxBytes > 0 and (accumulated + size) > maxBytes then
    break
  end
  accumulated = accumulated + size

  acceptedIds[#acceptedIds + 1] = stagedJobId
  if claimToken ~= "" and jobDataJson then
    heldFields[#heldFields + 1] = "s:" .. stagedJobId
    heldFields[#heldFields + 1] = originalScore
    heldFields[#heldFields + 1] = "d:" .. stagedJobId
    heldFields[#heldFields + 1] = jobDataJson
  end

  results[#results + 1] = stagedJobId
  results[#results + 1] = jobDataJson or ""
  results[#results + 1] = tostring(originalScore)
end

-- The accepted prefix leaves in one write per key. The counter falls by the jobs the zset
-- actually lost: a job without a body still occupied it.
if #acceptedIds > 0 then
  local removed = gqCallPerSlice("ZREM", jobsKey, acceptedIds, ${DRAIN_WRITE_CHUNK_JOBS})
  gqCallPerSlice("HDEL", dataKey, acceptedIds, ${DRAIN_WRITE_CHUNK_JOBS})
  if removed > 0 then redis.call("DECRBY", totalPendingKey, removed) end
  gqHoldClaimedJobs(claimedKey, heldFields)
end

return results
`;

// The stranded-group reaper's delete. Its discovery reads memberships one call at a time,
// so this eval asks them all again and deletes only a group that is still in no dispatch
// set and still stale: one staged or parked since discovery keeps its jobs.
const DELETE_STRANDED_GROUP_LUA =
  "#!lua flags=allow-oom\n" +
  TTL_HELPER_LUA +
  `
local jobsKey    = KEYS[1]
local dataKey    = KEYS[2]
local readyKey   = KEYS[3]
local blockedKey = KEYS[4]
local activeKey  = KEYS[5]

local keyPrefix = ARGV[1]
local groupId   = ARGV[2]
local cutoffMs  = tonumber(ARGV[3])

if redis.call("ZSCORE", readyKey, groupId) then return 0 end
if redis.call("EXISTS", activeKey) == 1 then return 0 end
if redis.call("SISMEMBER", blockedKey, groupId) == 1 then return 0 end
if isParkedGroupAt(keyPrefix, groupId) then return 0 end
local newest = redis.call("ZRANGE", jobsKey, -1, -1, "WITHSCORES")
if not newest[2] or tonumber(newest[2]) >= cutoffMs then return 0 end
redis.call("DEL", jobsKey, dataKey)
return 1
`;

const COMPLETE_LUA =
  "#!lua flags=allow-oom\n" +
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  WATER_LEVEL_HELPER_LUA +
  CLAIMED_RECORD_HELPER_LUA +
  CLAIM_MARKER_HELPER_LUA +
  `
local activeKey       = KEYS[1]
local jobsKey         = KEYS[2]
local readyKey        = KEYS[3]
local signalKey       = KEYS[4]
local statsKey        = KEYS[5]
local errorKey        = KEYS[6]
local claimedKey      = KEYS[7]
local failStreakKey   = KEYS[8]
local attemptKey      = KEYS[9]
-- The listed run's candidates the job was sent under, if any: a group left with work rejoins its scan.
local candidatesKey   = KEYS[10]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]
local jobName      = ARGV[3]
-- Tenant in-flight ZSET key prefix. When the soft-cap is enabled in
-- DISPATCH_BATCH_LUA, completing a job must remove this group's slot from the
-- per-tenant ZSET so freed slots are picked up by other tenants. Passing the
-- prefix in (not a derived tenantId) lets us keep the cap optional without
-- breaking back-compat with older call sites.
local tenantCountKeyPrefix = ARGV[4]
-- Static operator soft-cap (same value DISPATCH_BATCH_LUA reads). When > 0, a
-- completion frees a slot that may let one of the tenant's parked over-cap
-- groups resume, so we unpark up to the freed headroom. 0 = cap disabled.
local staticCap = tonumber(ARGV[5]) or 0
local nowMs = tonumber(ARGV[6])
-- "1" when the slot is being freed because the job was DISCARDED, not processed
-- (#5538). The group must still advance — that is why this is COMPLETE and not a
-- park — but a discarded job is not a completion: it must not INCR the completed
-- counters and must not clear the group's stored error. Absent/"" = a genuine
-- success, so older call sites keep their exact behaviour.
local isDropped = ARGV[7] == "1"
-- The claim's token. A former owner whose claim another worker recovered no
-- longer matches, so its late completion changes nothing (no double-complete).
local claimToken = ARGV[8] or ""
-- "1" when the group's retry chain ends here: its failure streak and attempt count go with the slot.
local endsRetryChain = ARGV[9] == "1"

if not gqOwnsClaim(claimedKey, activeKey, stagedJobId, claimToken) then
  return 0
end
-- The poison guard's marker goes with the accepted outcome, bound to its claim; "" (an older
-- caller, or the guard off) leaves it to the caller's own release.
gqReleaseClaimMarker(string.sub(activeKey, 1, #activeKey - 7) .. ":claim", ARGV[10] or "", claimToken)

redis.call("DEL", claimedKey)
redis.call("DEL", activeKey)
-- The job is done with, so no worker that handed it back passes the group over any longer (#9148).
redis.call("DEL", string.sub(activeKey, 1, #activeKey - 7) .. ":handed-back-by")
if endsRetryChain then
  redis.call("DEL", failStreakKey, attemptKey)
end

-- Free the tenant in-flight slot when the soft-cap is enabled.
if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    tenantActiveRemove(tenantCountKeyPrefix, string.sub(groupId, 1, slashPos - 1), groupId)
  end
end

-- Freed slot: restore up to (cap - now-active) of this tenant's parked groups
-- so over-cap work deferred by DISPATCH resumes the moment capacity opens. This
-- is the normal-case unpark; the dispatch reconcile only backstops orphans.
-- Self-limiting (TRAP 3): bounded to current headroom so COMPLETE-unpark and the
-- reconcile can't over-unpark into re-park churn. The LPUSH below wakes a waiter.
if staticCap > 0 then
  -- Use the dynamic water-level for the unpark headroom when it is set (DISPATCH
  -- is the source of W; COMPLETE only reads it), so a completion frees as many
  -- parked groups as the live cap allows. Falls back to the static cap when W is
  -- absent = fail-protective.
  local tenantCap = effectiveCap(parkKeyPrefixOf(readyKey), staticCap)
  local tenantId = parkTenantOf(groupId)
  local active = tenantActiveCount(tenantCountKeyPrefix, tenantId, nowMs)
  unparkUpTo(readyKey, tenantId, tenantCap - active, nowMs)
end

local pendingCount = redis.call("ZCARD", jobsKey)
if pendingCount > 0 then
  -- Re-score ready with earliest pending job's dispatchAfter so dispatch sees
  -- it again as soon as that job is due (could be past or future). Route through
  -- the parked-aware write so the invariant holds even though a completing
  -- (active) group is never itself parked.
  local nextJob = redis.call("ZRANGE", jobsKey, 0, 0, "WITHSCORES")
  if #nextJob >= 2 then
    addToReadyOrParked(readyKey, groupId, tonumber(nextJob[2]), false)
    if candidatesKey then
      redis.call("ZADD", candidatesKey, "XX", "LT", tonumber(nextJob[2]), groupId)
    end
  else
    redis.call("ZREM", readyKey, groupId)
  end
else
  redis.call("ZREM", readyKey, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- A discarded job is not a completion. Counting it as one made the drop worse
-- than invisible: it inflated the success rate AND wiped the group's stored
-- error, so ops saw a win where an event had just been thrown away (#5538).
if not isDropped then
  -- Increment completed counter for Skynet
  redis.call("INCR", statsKey)

  -- Increment per-job-name completed counter
  if jobName and jobName ~= "" then
    redis.call("INCR", statsKey .. ":" .. jobName)
  end

  -- Clear any leftover error from previous failures now that the job succeeded
  redis.call("DEL", errorKey)
end

return 1
`;

const REFRESH_LUA =
  "#!lua flags=allow-oom\n" +
  TTL_HELPER_LUA +
  CLAIMED_RECORD_HELPER_LUA +
  `
local activeKey    = KEYS[1]
local readyKey     = KEYS[2]
local claimedKey   = KEYS[3]
local stagedJobId           = ARGV[1]
local activeTtlSec          = tonumber(ARGV[2])
local groupId               = ARGV[3]
local nowMs                 = tonumber(ARGV[4])
-- Tenant in-flight ZSET key prefix (soft-cap). When provided, this group's
-- slot expiry score is bumped alongside the activeKey TTL so long-running
-- groups keep counting against the cap mid-execution (a stale-scored slot
-- would lapse out of the live count and let the same tenant grab another).
local tenantCountKeyPrefix  = ARGV[5]
local claimToken            = ARGV[6] or ""

-- SET, not EXPIRE: an owner whose key lapsed before anyone recovered its claim takes it back.
if gqOwnsClaim(claimedKey, activeKey, stagedJobId, claimToken) then
  redis.call("SET", activeKey, stagedJobId, "EX", activeTtlSec)
  if claimToken ~= "" then
    redis.call("PEXPIRE", claimedKey, ${GROUP_KEY_TTL_MS})
  end
  -- Keep the pending-sibling jobs/data keys alive while this group is actively
  -- processing: a long-running active job must not let staged siblings expire
  -- under the safety-net TTL. Derive the group keys from activeKey (strip the
  -- ":active" suffix) so no extra args are needed.
  local groupBase = string.sub(activeKey, 1, #activeKey - 7)
  refreshGroupKeyTtl(groupBase .. ":jobs", groupBase .. ":data", nowMs)
  redis.call("DEL", groupBase .. ":claim:suspect")
  -- Refresh ready-zset score so it stays "active" until heartbeat stops or completion.
  -- Only update if the group is currently in ready — if RESTAGE_AND_BLOCK_LUA fired
  -- while this heartbeat was in flight, the group has been removed and we must not
  -- reinsert it (would violate "blocked => not in ready").
  if redis.call("ZSCORE", readyKey, groupId) then
    redis.call("ZADD", readyKey, nowMs + activeTtlSec * ${HELD_RESCORE_MS_PER_TTL_SEC}, groupId)
  end
  if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
    local slashPos = string.find(groupId, "/", 1, true)
    if slashPos and slashPos > 1 then
      -- Bump this in-flight slot's expiry in lockstep with the activeKey
      -- heartbeat. XX = only if the slot still exists, so we never re-create a
      -- slot COMPLETE legitimately freed.
      redis.call("ZADD", tenantCountKeyPrefix .. string.sub(groupId, 1, slashPos - 1), "XX", nowMs + activeTtlSec * 1000, groupId)
    end
  end
  return 1
end
return 0
`;

const RESTAGE_AND_BLOCK_LUA =
  "#!lua flags=allow-oom\n" +
  PENDING_INDEX_HELPER_LUA +
  BLOB_LEASE_HELPER_LUA +
  ROUTING_META_HELPER_LUA +
  CLAIMED_RECORD_HELPER_LUA +
  CLAIM_MARKER_HELPER_LUA +
  `
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
-- Same shape as COMPLETE_LUA's ARGV[4]: when non-empty, removes this
-- group's slot from the per-tenant in-flight ZSET so the soft cap doesn't
-- leak slots when a group exhausts retries. Without this the slot would
-- count against the cap until its expiry score lapses on its own.
local tenantCountKeyPrefix  = ARGV[8]
-- The claim's token; empty (an older caller) blocks unconditionally, as before.
local claimToken            = ARGV[9] or ""

local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"
local activeKey    = keyPrefix .. "group:" .. groupId .. ":active"
local claimedKey   = keyPrefix .. "group:" .. groupId .. ":claimed"

-- 0. A former owner whose claim another worker recovered blocks nothing.
if claimToken ~= "" and not gqOwnsClaim(claimedKey, activeKey, newStagedJobId, claimToken) then
  return 0
end
-- The poison guard's marker goes with the accepted outcome, as COMPLETE_LUA releases it.
gqReleaseClaimMarker(keyPrefix .. "group:" .. groupId .. ":claim", ARGV[10] or "", claimToken)
redis.call("DEL", claimedKey)

-- 1. Block the group — prevents dispatcher from re-dispatching
redis.call("SADD", blockedKey, groupId)

-- 2. Re-stage the failed job under the id it was dispatched under (ADR-080).
--    Its member was ZREMed at claim time, so this insert lands on an absent one.
local inserted = redis.call("ZADD", groupJobsKey, score, newStagedJobId)
gqMarkPending(keyPrefix, groupId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)
local stagedLease = gqParseLease(jobDataJson)
if stagedLease and stagedLease.projectId == gqTenantOf(groupId) then
  gqTakeLease(keyPrefix, stagedLease, gqRedisNowMs())
end
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

-- 4. Free the in-flight slot. The activeKey expires on its own after
-- activeTtlSec; removing the ZSET slot here frees it immediately rather than
-- waiting for its expiry score to lapse. Mirror COMPLETE_LUA's free path.
redis.call("DEL", activeKey)

if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    redis.call("ZREM", tenantCountKeyPrefix .. string.sub(groupId, 1, slashPos - 1), groupId)
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
local _, _, jn = gqRoutingMeta(jobDataJson)
if jn and jn ~= "" then
  redis.call("INCR", statsKey .. ":" .. jn)
end

return 1
`;

/**
 * Records a claim and returns confirmed deaths, evidence-based not
 * inferred: a marker counts as dead only when its owner publishes neither
 * `alive` nor `retired`. Requires WORKER_LIVENESS_TTL_SECONDS to expire first.
 */
const CLAIM_GUARD_LUA =
  "#!lua\n" +
  CLAIM_MARKER_HELPER_LUA +
  `
local deaths, observed = gqRecordClaimMarker(KEYS[1], ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4]), ARGV[5] or "")
-- The state is returned so the park log can say WHY a group was parked: a crash-loop and a
-- Redis outage that expired healthy beacons both arrive as "gone".
return { deaths, observed }
`;

/**
 * Release a claim marker only if this worker still owns it — a plain DEL
 * risks a paused worker deleting a new owner's marker after redispatch,
 * erasing that group's accrued death count. Same fix as a Redlock release.
 */
const RELEASE_CLAIM_LUA =
  "#!lua flags=allow-oom\n" +
  CLAIM_MARKER_HELPER_LUA +
  `
return gqReleaseClaimMarker(KEYS[1], ARGV[1], ARGV[2] or "")
`;

const RETRY_RESTAGE_LUA =
  "#!lua\n" +
  PENDING_INDEX_HELPER_LUA +
  BLOB_LEASE_HELPER_LUA +
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  WATER_LEVEL_HELPER_LUA +
  CLAIMED_RECORD_HELPER_LUA +
  CLAIM_MARKER_HELPER_LUA +
  `
local activeKey       = KEYS[1]
local totalPendingKey = KEYS[2]
-- The group's retry chain. Written HERE rather than by the caller beforehand:
-- with the staged job id no longer carrying a /r/<n> marker (ADR-080), this
-- counter is the only attempt carrier a re-staged SIBLING has — a sibling is
-- re-queued with its original envelope and no attempt of its own. A separate
-- SET that failed while this script went on to succeed would hand the next
-- sibling-led claim a fresh budget, restarting a bounded ladder and letting a
-- fold re-apply what the chain had already applied. One script means both land
-- or neither does.
local attemptKey      = KEYS[3]

local keyPrefix             = ARGV[1]
local groupId               = ARGV[2]
local stagedJobId           = ARGV[3]
local newStagedJobId        = ARGV[4]
local dispatchAfterMs       = tonumber(ARGV[5])
local jobDataJson           = ARGV[6]
local retryTtlSec           = tonumber(ARGV[7])
-- Tenant in-flight ZSET key prefix (soft-cap). A group in backoff frees its
-- slot; DISPATCH takes a slot again when the retry actually runs.
local tenantCountKeyPrefix  = ARGV[8]
local nowMs                 = tonumber(ARGV[9])
local attempt               = ARGV[10]
local attemptTtlSec         = tonumber(ARGV[11])
-- Static operator soft-cap, as COMPLETE_LUA reads it. 0 = cap disabled.
local staticCap             = tonumber(ARGV[12]) or 0
local claimToken            = ARGV[13] or ""
local claimedKey            = keyPrefix .. "group:" .. groupId .. ":claimed"

-- 1. Validate this worker still owns the claim; the job goes back to jobs below,
--    so the claimed record is done with.
if not gqOwnsClaim(claimedKey, activeKey, stagedJobId, claimToken) then
  return 0
end
-- The poison guard's marker goes with the accepted outcome, as COMPLETE_LUA releases it.
gqReleaseClaimMarker(keyPrefix .. "group:" .. groupId .. ":claim", ARGV[14] or "", claimToken)
redis.call("DEL", claimedKey)

-- 1b. Record the attempt on the group's retry chain. After the guard, so a
--     worker that has lost the slot cannot advance a chain it no longer owns.
if attempt ~= "" then
  redis.call("SET", attemptKey, attempt, "EX", attemptTtlSec)
end

-- 1c. A hand-back adds its worker to the group's record, scored by when that worker's pass-over
--     lapses on its own clock; the key outlives its longest entry (#9148). A retry adds nobody.
local handedBackBy = ARGV[15] or ""
local passOverMs = tonumber(ARGV[16]) or 0
if handedBackBy ~= "" and passOverMs > 0 then
  local handedBackKey = keyPrefix .. "group:" .. groupId .. ":handed-back-by"
  redis.call("ZADD", handedBackKey, nowMs + passOverMs, handedBackBy)
  if redis.call("PTTL", handedBackKey) < passOverMs then redis.call("PEXPIRE", handedBackKey, passOverMs) end
end

-- 2. Re-stage job with future score (backoff delay)
local groupJobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
local groupDataKey = keyPrefix .. "group:" .. groupId .. ":data"
local inserted = redis.call("ZADD", groupJobsKey, dispatchAfterMs, newStagedJobId)
gqMarkPending(keyPrefix, groupId)
redis.call("HSET", groupDataKey, newStagedJobId, jobDataJson)
local stagedLease = gqParseLease(jobDataJson)
if stagedLease and stagedLease.projectId == gqTenantOf(groupId) then
  gqTakeLease(keyPrefix, stagedLease, gqRedisNowMs())
end
if inserted == 1 then
  redis.call("INCR", totalPendingKey)
end
refreshGroupKeyTtl(groupJobsKey, groupDataKey, nowMs)

-- 3. Update ready set score = future dispatch time so the group becomes
--    eligible exactly when the backoff window expires. Route through the
--    parked-aware write so the invariant holds (an active group entering retry
--    is never itself parked, so this normally writes straight to ready).
local readyKey = keyPrefix .. "ready"
addToReadyOrParked(readyKey, groupId, dispatchAfterMs, false)

-- 4. Set the active key to the staged-job id with a TTL matching the backoff
--    period. While the key exists the group is locked (preserves FIFO
--    ordering); when it expires the dispatcher picks up the retry on its next
--    poll.
--
--    THIS TTL IS WHAT MAKES THE BACKOFF REAL, and nothing here defends it.
--    A REFRESH from the worker's heartbeat would reset it to the full
--    activeTtlSec and push the ready score out with it, delaying the retry by
--    up to activeTtlSec instead of the backoff. This used to be prevented
--    here: the re-stage rotated the active key to a NEW id, so a late beat
--    naming the retired id no longer matched. Since ADR-080 the id is reused,
--    so newStagedJobId equals stagedJobId and this write invalidates nothing.
--    The ONLY protection is that the caller stops the heartbeat before issuing
--    this script (stopHeartbeat() in groupQueue.ts, ordered ahead of
--    retryRestage on the same connection). Do not move that call later on the
--    assumption that this line still guards it.
redis.call("SET", activeKey, newStagedJobId, "EX", retryTtlSec)

-- 5. A group waiting out its backoff runs nothing, so it frees its tenant slot
--    and unparks into the headroom, exactly as COMPLETE_LUA does. The active key
--    above still locks the group, so its jobs keep their order (ARCHITECTURE §9).
if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    tenantActiveRemove(tenantCountKeyPrefix, string.sub(groupId, 1, slashPos - 1), groupId)
  end
  if staticCap > 0 then
    local tenantCap = effectiveCap(parkKeyPrefixOf(readyKey), staticCap)
    local tenantId = parkTenantOf(groupId)
    local active = tenantActiveCount(tenantCountKeyPrefix, tenantId, nowMs)
    unparkUpTo(readyKey, tenantId, tenantCap - active, nowMs)
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
  /** Names this claim alone; every outcome passes it so a former owner changes nothing. */
  claimToken: string;
  /** The group's retry-chain counter read inside the claim; absent, the worker reads it itself. */
  groupAttempt?: number;
  /** The cross-group batch this claim joined; claims sharing it run as one call. */
  batchSlot?: number;
  /** The poison guard's marker written with the claim; absent, the worker records it itself. */
  claimGuard?: ClaimMarkerRecord;
}

/** One dispatch call: the clock, the slots to fill and who claims. */
export interface DispatchBatchClaim {
  nowMs: number;
  activeTtlSec: number;
  /** Worker slots to fill: claimed groups alone, or cross-group batches under `groupBatch`. */
  maxJobs: number;
  allowedGroupsKey?: string;
  /** The listed run whose candidates these are: the scan forgets its settled groups. */
  listKey?: string;
  /** Up to `maxGroups` ready groups per slot, of one tenant and one of `routes`. */
  groupBatch?: { maxGroups: number; routes: readonly string[]; maxClaims: number };
  /** Writes this worker's poison-guard marker with each claim, while its beacon is alive. */
  claimGuardWorkerId?: string;
  /** The claiming worker: a group whose job it handed back is passed over meanwhile. */
  workerId?: string;
}

/** A dispatch call's claims, and when the soonest group it passed over comes due to it again. */
export interface ClaimedBatch {
  claims: DispatchResult[];
  /** On the claiming worker's clock; null when the call passed no group over. */
  passedOverUntilMs: number | null;
}

/** One group's completion; its claim token fences it, as it fences every outcome. */
export interface GroupCompletion {
  groupId: string;
  stagedJobId: string;
  jobName?: string;
  /** The dispatch's token; without it the active key alone decides ownership, as before. */
  claimToken?: string;
  /** The listed run's candidates the job was sent under; a group with more work rejoins it. */
  candidatesKey?: string;
  /** Clears the group's failure streak and retry-chain attempt with the slot, in one step. */
  endsRetryChain?: boolean;
  /** A DISCARDED job (#5538): the group advances, but no completed count and no error clear. */
  dropped?: boolean;
}

/** One group's lease renewal while its job runs. */
export interface GroupHeartbeat {
  groupId: string;
  stagedJobId: string;
  /** With it, a lapsed key is taken back while the claim is still this worker's. */
  claimToken?: string;
  /** Withdraws the NOSCRIPT fallback, see {@link CachedLuaScript.runCancellable}. */
  isCancelled?: () => boolean;
}

/** One group's job re-staged with backoff, its retry chain advanced in the same step. */
export interface GroupRetryRestage {
  groupId: string;
  stagedJobId: string;
  newStagedJobId: string;
  dispatchAfterMs: number;
  jobDataJson: string;
  backoffMs: number;
  /** The dispatch's token; without it the active key alone decides ownership, as before. */
  claimToken?: string;
  /** Recorded on the group's retry chain in the same atomic step. */
  attempt: number;
  attemptTtlSec: number;
  /** A hand-back: `workerId` passes the group over for `ttlMs`, or until the job completes. */
  passOver?: { workerId: string; ttlMs: number };
}

/**
 * A claim marker as recorded: confirmed deaths, and the previous owner's state for the park log.
 */
export interface ClaimMarkerRecord {
  deaths: number;
  /** none, self, alive, retired or gone. */
  lastOwnerState: string;
}

/** Ready groups claimed together for one cross-group call (ARCHITECTURE §9). */
export interface GroupBatchDispatch {
  groups: DispatchResult[];
}

/** What the dispatcher hands a worker slot: one claimed group, or a cross-group batch. */
export type DispatchedWork = DispatchResult | GroupBatchDispatch;

/** The routing trio as the dispatch script compares it: `pipeline/type/name`. */
export function groupBatchRouteKey(route: {
  pipelineName: string;
  jobType: string;
  jobName: string;
}): string {
  return `${route.pipelineName}/${route.jobType}/${route.jobName}`;
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
 * Default tenant soft-cap: half the 100 slots a worker pod held before the
 * default rose to 1,000 (2026-10-12), protecting against noisy-neighbour
 * starvation while still bounding a runaway on a single-pod install.
 */
export const DEFAULT_TENANT_CAP = 50;

/**
 * Poison guard: a group parks once this many claims found their predecessor's
 * worker dead. A death is CONFIRMED, never inferred — see {@link CLAIM_GUARD_LUA}:
 * a leftover marker counts only when its owner is neither alive nor retired.
 */
export const DEFAULT_CONFIRMED_DEATH_THRESHOLD = 3;

/**
 * The claim marker self-expires so a group cannot be parked by evidence from
 * an outage hours in the past. Refreshed on every claim, so an actively
 * crash-looping group never loses its count.
 */
export const CLAIM_MARKER_TTL_SECONDS = 60 * 60;

/**
 * How long a worker's `alive` beacon survives without a refresh. Must exceed
 * {@link WORKER_LIVENESS_REFRESH_MS} enough that a lost write or GC pause doesn't
 * read as a death — the one piece of evidence that alone CAN park a group.
 */
export const WORKER_LIVENESS_TTL_SECONDS = 90;

/**
 * How long a graceful shutdown's `retired` tombstone survives. Must outlive the
 * claim marker: a marker left by a pod that retired an hour ago must still
 * resolve to "shut down cleanly" rather than decaying into "died".
 */
export const WORKER_RETIRED_TTL_SECONDS = CLAIM_MARKER_TTL_SECONDS * 2;

/**
 * Deliberately high: only a group failing this many times with zero
 * interleaved successes is unambiguously a runaway. Counts failures ACROSS
 * jobs, since per-job `maxAttempts` misses a producer outpacing drain.
 */
export const DEFAULT_GROUP_QUARANTINE_THRESHOLD = 500;

/**
 * The failure streak self-expires so a group failing sparsely never accumulates
 * to the threshold from blips hours apart. Refreshed on every failure so an
 * actively-churning group keeps its count; a success clears it outright.
 */
export const GROUP_QUARANTINE_TTL_SECONDS = 15 * 60;

/**
 * Splits one dispatch may perform before bisection hands the remainder to
 * retry/backoff. Sized to cover every useful descent (8 splits isolates one
 * bad payload in a 256 batch) while cutting off the pathological ~2N-call walk.
 */
export const DEFAULT_BISECTION_SPLITS_PER_DISPATCH = 32;

/**
 * Global in-flight budget for the dynamic water-level cap (option C, 2026-05-29).
 * 0 (default) disables it; a positive value is the fleet's ceiling that
 * water-fill divides across tenants for a max-min fair share.
 */
export const DEFAULT_GLOBAL_BUDGET = 0;

/**
 * Set holding every active group-queue name. Producers register on
 * construction so the ops dashboard enumerates queues with O(1) SMEMBERS;
 * the hash tag keeps the set in one Redis Cluster slot.
 */
export const GROUP_QUEUE_REGISTRY_KEY = "{gq-registry}:names";

/**
 * All Redis keys share the `{queueName}` hash tag; Lua derives per-group keys
 * dynamically instead of passing them via KEYS[], safe because they inherit
 * the same hash tag and so land in the same Cluster slot.
 */

// EVALSHA-cached forms of the scripts above: the source is sent to Redis
// once per node, every later call ships a 40-byte sha instead of the full
// 11-23 KB script body (see CachedLuaScript).
const stageScript = new CachedLuaScript(STAGE_LUA);
const stageBatchScript = new CachedLuaScript(STAGE_BATCH_LUA);
const dispatchBatchScript = new CachedLuaScript(DISPATCH_BATCH_LUA);

/** Fields per dispatched job in the dispatch script's flat reply; read only by its own caller. */
const DISPATCH_TUPLE_SIZE = 9;

/**
 * Calls of one script sent in one pipeline. Bounds a reply and the time one flush holds the
 * connection; a cross-group batch (16 groups) fits in one.
 */
const MAX_PIPELINED_SCRIPT_CALLS = 64;

/** One script call's keys and arguments, as {@link CachedLuaScript.run} takes them. */
interface ScriptCall {
  numKeys: number;
  keysAndArgs: (string | number)[];
  /** Withdraws the NOSCRIPT re-run, as {@link CachedLuaScript.runCancellable} does. */
  isCancelled?: () => boolean;
}

/** The counter as the worker would read it: missing or unreadable is no chain yet. */
function groupAttemptOf(raw: unknown): number {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** The marker the dispatch script wrote with the claim; "" means it wrote none. */
function claimMarkerOf(rawDeaths: unknown, rawState: unknown): ClaimMarkerRecord | undefined {
  if (typeof rawDeaths !== "string" || rawDeaths === "") return undefined;
  const deaths = Number.parseInt(rawDeaths, 10);
  return {
    deaths: Number.isFinite(deaths) ? deaths : 0,
    lastOwnerState: typeof rawState === "string" ? rawState : "",
  };
}

/** A script's 1/0 reply as the caller's boolean, keeping each call's own failure. */
function answeredOne(result: PromiseSettledResult<unknown>): PromiseSettledResult<boolean> {
  return result.status === "fulfilled"
    ? { status: "fulfilled", value: result.value === 1 }
    : result;
}

const REGISTER_PREFLIGHT_TARGETS_LUA =
  "#!lua\n" +
  PREFLIGHT_GROUP_STATE_LUA +
  `
local targetKey = KEYS[1]
local candidatesKey = KEYS[2]
local signalKey = KEYS[3]
local blockedKey = KEYS[4]
local baselineKey = KEYS[5]
local registrationsKey = KEYS[6]
local liveKey = KEYS[7]
local openListsKey = KEYS[8]
local keyPrefix = ARGV[1]
local ttlSec = tonumber(ARGV[2])
local scoreBase = tonumber(ARGV[3])
local openUntilMs = tonumber(ARGV[4])
for index = 5, #ARGV do
  local groupId = ARGV[index]
  redis.call("SADD", targetKey, groupId)
  -- The groups that may still hold work, pruned as they settle, so pacing counts only those.
  redis.call("SADD", liveKey, groupId)
  -- Registration puts a target ahead of the dispatch loop's wall-clock
  -- rotation scores. This also re-activates a target when an older worker
  -- stages it without knowing the preflight protocol.
  redis.call("ZADD", candidatesKey, scoreBase + index - 4, groupId)
  -- HSETNX: only the first registration may say what was already wedged here.
  redis.call("HSETNX", baselineKey, groupId, gqPreflightGroupState(keyPrefix, blockedKey, groupId))
end
-- Every registration, a repeat included, moves this on: a paged inspection
-- that sees it move ran beside new work and is not taken as settled.
redis.call("INCR", registrationsKey)
redis.call("EXPIRE", targetKey, ttlSec)
redis.call("EXPIRE", candidatesKey, ttlSec)
redis.call("EXPIRE", baselineKey, ttlSec)
redis.call("EXPIRE", registrationsKey, ttlSec)
redis.call("EXPIRE", liveKey, ttlSec)
-- An open list lapses with its groups, an hour after its last registration, not its opening;
-- XX never reopens a closed list, nor lists a preflight's allow-list.
redis.call("ZADD", openListsKey, "XX", "GT", openUntilMs, targetKey)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)
return #ARGV - 4
`;
const registerPreflightTargetsScript = new CachedLuaScript(REGISTER_PREFLIGHT_TARGETS_LUA);

/**
 * Inspects one slice of a preflight's target groups: the ids passed in ARGV, or, when none
 * are, the whole set if it holds at most `maxGroups` (one atomic look, as small sets always
 * had). A larger set returns `{-1}` untouched, so no call ever walks more than `maxGroups`.
 */
const INSPECT_PREFLIGHT_PAGE_LUA =
  "#!lua flags=no-writes,allow-oom\n" +
  PREFLIGHT_GROUP_STATE_LUA +
  `
local targetKey = KEYS[1]
local blockedKey = KEYS[2]
local baselineKey = KEYS[3]
local keyPrefix = ARGV[1]
local maxIds = tonumber(ARGV[2])
local maxGroups = tonumber(ARGV[3])
local groups = {}
if #ARGV > 3 then
  for index = 4, #ARGV do groups[#groups + 1] = ARGV[index] end
else
  if redis.call("SCARD", targetKey) > maxGroups then return {-1} end
  groups = redis.call("SMEMBERS", targetKey)
end
local pending = 0
local active = 0
local failed = 0
local blocked = 0
local held = 0
local pendingGroups = 0
local failedIds = {}
local blockedIds = {}
local pendingIds = {}
local heldIds = {}
local function gqNameGroup(ids, groupId)
  if #ids < maxIds then ids[#ids + 1] = groupId end
end
for _, groupId in ipairs(groups) do
  local groupPrefix = keyPrefix .. "group:" .. groupId
  -- A target registered outside the preflight protocol has no baseline, and
  -- reads as unwedged: an unexplained failure refuses rather than settles.
  local baseStamp, baseBlocked = string.match(redis.call("HGET", baselineKey, groupId) or "|0", "^(.*)|([01])$")
  if not baseBlocked then baseStamp, baseBlocked = "", "0" end
  local stamp, isBlocked = string.match(gqPreflightGroupState(keyPrefix, blockedKey, groupId), "^(.*)|([01])$")
  if baseBlocked == "1" then
    -- Already blocked when the preflight adopted it: its jobs cannot dispatch
    -- and never will, so counting them would only hang the barrier out.
    held = held + 1
    gqNameGroup(heldIds, groupId)
  else
    local groupPending = redis.call("ZCARD", groupPrefix .. ":jobs")
    local groupActive = redis.call("EXISTS", groupPrefix .. ":active")
    pending = pending + groupPending
    active = active + groupActive
    if groupPending > 0 or groupActive == 1 then
      pendingGroups = pendingGroups + 1
      gqNameGroup(pendingIds, groupId)
    end
    if isBlocked == "1" then
      blocked = blocked + 1
      gqNameGroup(blockedIds, groupId)
    end
  end
  if stamp ~= "" and stamp ~= baseStamp then
    failed = failed + 1
    gqNameGroup(failedIds, groupId)
  end
end
return {pending, active, failed, blocked, #groups, held, pendingGroups, failedIds, blockedIds, pendingIds, heldIds}
`;
const inspectPreflightPageScript = new CachedLuaScript(INSPECT_PREFLIGHT_PAGE_LUA);

/** One slice of a list's live groups: their waiting and running jobs; settled groups leave. */
const COUNT_LISTED_OUTSTANDING_LUA =
  "#!lua flags=allow-oom\n" +
  SETTLED_TARGET_HELPER_LUA +
  `
local liveKey = KEYS[1]
local blockedKey = KEYS[2]
local targetKey = KEYS[3]
local keyPrefix = ARGV[1]
local outstanding = 0
for index = 2, #ARGV do
  local groupId = ARGV[index]
  local groupPrefix = keyPrefix .. "group:" .. groupId
  local pending = redis.call("ZCARD", groupPrefix .. ":jobs")
  local active = redis.call("EXISTS", groupPrefix .. ":active")
  if pending == 0 and active == 0 then
    redis.call("SREM", liveKey, groupId)
    gqForgetSettledTarget(keyPrefix, blockedKey, targetKey, groupId)
  elseif redis.call("SISMEMBER", blockedKey, groupId) == 0 then
    outstanding = outstanding + pending + active
  end
end
return outstanding
`;
const countListedOutstandingScript = new CachedLuaScript(COUNT_LISTED_OUTSTANDING_LUA);

/** The most target groups one inspection or registration script call touches. */
export const PREFLIGHT_GROUPS_PER_CALL = 500;

/** How long a preflight's or a listed run's groups stay recorded after their last registration. */
const LISTED_GROUPS_TTL_SEC = 3600;

/** How many group ids a single refusal names before it says "and N more". */
export const PREFLIGHT_NAMED_GROUP_LIMIT = 20;

/**
 * What the barrier sees across a preflight's target groups. `heldFromBefore`
 * groups were already blocked when the preflight adopted them and are excluded
 * from `pending`/`active`; the id lists are what an operator acts on.
 */
export type PreflightTargetsState = {
  pending: number;
  active: number;
  failed: number;
  blocked: number;
  groups: number;
  heldFromBefore: number;
  pendingGroups: number;
  failedGroupIds: string[];
  blockedGroupIds: string[];
  pendingGroupIds: string[];
  heldFromBeforeGroupIds: string[];
  /** A group registered while a paged look ran: the counts may have missed its new work. */
  changedDuringInspection: boolean;
};

/** Adds one inspected slice's reply to the running totals, naming at most the refusal limit. */
export function addPreflightPage({
  state,
  reply,
}: {
  state: PreflightTargetsState;
  reply: readonly unknown[];
}): PreflightTargetsState {
  const count = (index: number): number => Number(reply[index] ?? 0);
  const names = ({ index, kept }: { index: number; kept: readonly string[] }): string[] => {
    const value: unknown = reply[index];
    const added = Array.isArray(value) ? value.map(String) : [];
    return [...kept, ...added].slice(0, PREFLIGHT_NAMED_GROUP_LIMIT);
  };
  return {
    pending: state.pending + count(0),
    active: state.active + count(1),
    failed: state.failed + count(2),
    blocked: state.blocked + count(3),
    groups: state.groups + count(4),
    heldFromBefore: state.heldFromBefore + count(5),
    pendingGroups: state.pendingGroups + count(6),
    failedGroupIds: names({ index: 7, kept: state.failedGroupIds }),
    blockedGroupIds: names({ index: 8, kept: state.blockedGroupIds }),
    pendingGroupIds: names({ index: 9, kept: state.pendingGroupIds }),
    heldFromBeforeGroupIds: names({ index: 10, kept: state.heldFromBeforeGroupIds }),
    changedDuringInspection: state.changedDuringInspection,
  };
}

const NO_PREFLIGHT_TARGETS: PreflightTargetsState = {
  pending: 0,
  active: 0,
  failed: 0,
  blocked: 0,
  groups: 0,
  heldFromBefore: 0,
  pendingGroups: 0,
  failedGroupIds: [],
  blockedGroupIds: [],
  pendingGroupIds: [],
  heldFromBeforeGroupIds: [],
  changedDuringInspection: false,
};
const drainGroupScript = new CachedLuaScript(DRAIN_GROUP_LUA);
const completeScript = new CachedLuaScript(COMPLETE_LUA);
const refreshScript = new CachedLuaScript(REFRESH_LUA);
const restageAndBlockScript = new CachedLuaScript(RESTAGE_AND_BLOCK_LUA);
const retryRestageScript = new CachedLuaScript(RETRY_RESTAGE_LUA);
const claimGuardScript = new CachedLuaScript(CLAIM_GUARD_LUA);
const releaseClaimScript = new CachedLuaScript(RELEASE_CLAIM_LUA);
const deleteStrandedGroupScript = new CachedLuaScript(DELETE_STRANDED_GROUP_LUA);

/**
 * Deletes a stranded group's jobs and data keys in one eval that first re-checks it is
 * still in none of ready, active, blocked, its tenant's parked set or a paused lane's,
 * and its newest job still predates `cutoffMs`. Returns whether it deleted them.
 */
export async function deleteStrandedGroup({
  redis,
  keyPrefix,
  groupId,
  cutoffMs,
}: {
  redis: IORedis | Cluster;
  keyPrefix: string;
  groupId: string;
  cutoffMs: number;
}): Promise<boolean> {
  const groupBase = `${keyPrefix}group:${groupId}`;
  const deleted = await deleteStrandedGroupScript.run(
    redis,
    5,
    `${groupBase}:jobs`,
    `${groupBase}:data`,
    `${keyPrefix}ready`,
    `${keyPrefix}blocked`,
    `${groupBase}:active`,
    keyPrefix,
    groupId,
    cutoffMs,
  );
  return deleted === 1;
}

/** One batched job's staging: squashed by dedup, a new member, or an id already staged, updated. */
export type StagedJobOutcome = "deduplicated" | "inserted" | "updated";

const STAGED_JOB_OUTCOMES: Readonly<Record<string, StagedJobOutcome>> = {
  "0": "deduplicated",
  "1": "inserted",
  "2": "updated",
};

/**
 * STAGE_BATCH_LUA's reply: [newStagedCount, orphanedValues[], outcomes[]]. A bare integer or a
 * shorter array comes from a stale cached script mid-deploy, and is read as far as it goes.
 */
function stageBatchReplyOf(result: unknown): {
  newStagedCount: number;
  orphanedValues: string[];
  outcomes: StagedJobOutcome[];
} {
  if (!Array.isArray(result)) {
    return { newStagedCount: Number(result), orphanedValues: [], outcomes: [] };
  }
  const [count, orphans, outcomes] = result as [number, unknown, unknown];
  return {
    newStagedCount: Number(count),
    orphanedValues: Array.isArray(orphans) ? orphans.map((v) => (v == null ? "" : String(v))) : [],
    outcomes: Array.isArray(outcomes)
      ? outcomes.map((code) => STAGED_JOB_OUTCOMES[String(code)] ?? "inserted")
      : [],
  };
}

/** How long a freshly staged group waits for more jobs, and the batch size that ends the wait. */
export interface StageSettling {
  windowMs: number;
  maxBatch: number;
}

/** One job as `stageBatch` stages it: the same fields a single `stage` takes for a fresh send. */
export interface StageBatchJob {
  stagedJobId: string;
  groupId: string;
  dispatchAfterMs: number;
  dedupId: string;
  dedupTtlMs: number;
  jobDataJson: string;
  shouldExtend?: boolean;
  shouldReplace?: boolean;
  shouldSurviveDispatch?: boolean;
  settle?: StageSettling;
}

export class GroupStagingScripts {
  private readonly keyPrefix: string;
  private readonly queueName: string;
  private readonly tenantConcurrencyCap: number;
  private readonly globalConcurrencyBudget: number;
  private readonly claimMarkerOwner: string;

  constructor(
    private readonly redis: IORedis | Cluster,
    queueName: string,
    policy: {
      tenantConcurrencyCap?: number;
      globalConcurrencyBudget?: number;
      /** The worker whose poison-guard marker every outcome script releases; absent, none is. */
      claimMarkerOwner?: string;
    } = {},
  ) {
    // queueName already includes hash tags, e.g. "{pipeline/handler/spanStorage}"
    this.queueName = queueName;
    this.keyPrefix = `${queueName}:gq:`;
    this.tenantConcurrencyCap = policy.tenantConcurrencyCap ?? DEFAULT_TENANT_CAP;
    this.globalConcurrencyBudget = policy.globalConcurrencyBudget ?? DEFAULT_GLOBAL_BUDGET;
    this.claimMarkerOwner = policy.claimMarkerOwner ?? "";
  }

  /**
   * Advertise this queue in the registry set so the ops dashboard discovers it
   * without scanning the keyspace. Idempotent; safe to call once per process.
   */
  async registerQueue(): Promise<void> {
    await this.redis.sadd(GROUP_QUEUE_REGISTRY_KEY, this.queueName);
  }

  /**
   * Stage a job into a group's pending queue, squashing in place when dedup is
   * active; blob leases move INSIDE the eval so a concurrent squash can't leak one.
   * @returns `isNew` and the displaced `orphanedValue` ("" if none).
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
    shouldSurviveDispatch = false,
    claimToken = "",
    settle,
  }: {
    stagedJobId: string;
    groupId: string;
    dispatchAfterMs: number;
    dedupId: string;
    dedupTtlMs: number;
    jobDataJson: string;
    shouldExtend?: boolean;
    shouldReplace?: boolean;
    shouldSurviveDispatch?: boolean;
    /** A claim re-staging a job it holds; staged only while the claim is still this worker's. */
    claimToken?: string;
    /** A fresh send's settling window; a restage omits it and is claimable as before. */
    settle?: StageSettling;
  }): Promise<{ isNew: boolean; orphanedValue: string; claimLost: boolean }> {
    const groupJobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const readyKey = `${this.keyPrefix}ready`;
    const signalKey = `${this.keyPrefix}signal`;
    const dedupKey =
      dedupId !== "" ? `${this.keyPrefix}dedup:${dedupId}` : `${this.keyPrefix}dedup:__none__`;

    const dataKey = `${this.keyPrefix}group:${groupId}:data`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;
    const activeKey = `${this.keyPrefix}group:${groupId}:active`;
    const blockedKey = `${this.keyPrefix}blocked`;
    const claimedKey = `${this.keyPrefix}group:${groupId}:claimed`;

    const result = await stageScript.run(
      this.redis,
      9,
      groupJobsKey,
      readyKey,
      signalKey,
      dedupKey,
      dataKey,
      totalPendingKey,
      activeKey,
      blockedKey,
      claimedKey,
      stagedJobId,
      groupId,
      String(dispatchAfterMs),
      dedupId,
      String(dedupTtlMs),
      jobDataJson,
      String(shouldExtend ? 1 : 0),
      String(shouldReplace ? 1 : 0),
      String(nowInstant().epochMilliseconds),
      String(this.globalConcurrencyBudget),
      // ARGV[11] — appended after globalBudget so no existing index shifts.
      String(shouldSurviveDispatch ? 1 : 0),
      claimToken,
      String(settle?.windowMs ?? 0),
      String(settle?.maxBatch ?? 1),
    );

    // STAGE_LUA returns [code, orphanedValue]. Tolerate a bare
    // integer reply defensively (e.g. a stale cached script during a rolling
    // deploy).
    const [code, orphanedValue] = Array.isArray(result)
      ? (result as [number, unknown])
      : [result as number, ""];
    return {
      isNew: Number(code) === 1,
      claimLost: Number(code) === -1,
      orphanedValue:
        typeof orphanedValue === "string" || typeof orphanedValue === "number"
          ? String(orphanedValue)
          : "",
    };
  }

  /**
   * Stage a batch of jobs into their respective group queues.
   * @returns `newStagedCount`, and index-aligned `orphanedValues` of squashed jobs (`""` where
   *   nothing displaced) and `outcomes` (empty from a script that predates them).
   */
  async stageBatch(jobs: readonly StageBatchJob[]): Promise<{
    newStagedCount: number;
    orphanedValues: string[];
    outcomes: StagedJobOutcome[];
  }> {
    if (jobs.length === 0) return { newStagedCount: 0, orphanedValues: [], outcomes: [] };

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
        // 9th per-job arg (offset + 9 in the Lua). Kept in the per-job block,
        // alongside the other dedup flags, so the trailing nowMs/globalBudget
        // remain end-relative (ARGV[#ARGV-1]/ARGV[#ARGV]).
        String((job.shouldSurviveDispatch ?? false) ? 1 : 0),
        String(job.settle?.windowMs ?? 0),
        String(job.settle?.maxBatch ?? 1),
      );
    }
    // Appended after all per-job args: nowMs then globalBudget last, so the Lua
    // reads globalBudget as ARGV[#ARGV] and nowMs as ARGV[#ARGV-1] regardless of
    // job count.
    args.push(String(nowInstant().epochMilliseconds));
    args.push(String(this.globalConcurrencyBudget));

    const result = await stageBatchScript.run(
      this.redis,
      3,
      readyKey,
      signalKey,
      totalPendingKey,
      ...args,
    );

    return stageBatchReplyOf(result);
  }

  /**
   * Pick the next eligible group and pop its oldest due job. Thin wrapper over
   * {@link dispatchBatch} with maxJobs=1.
   * @returns dispatch result or null if nothing to dispatch
   */
  async dispatch({
    nowMs,
    activeTtlSec,
  }: {
    nowMs: number;
    activeTtlSec: number;
  }): Promise<DispatchResult | null> {
    const results = await this.dispatchBatch({
      nowMs,
      activeTtlSec,
      maxJobs: 1,
    });
    return results[0] ?? null;
  }

  /**
   * Pick eligible groups and dispatch up to maxJobs in a single atomic Lua call.
   * Returns an array of dispatch results (may be empty).
   */
  async dispatchBatch(claim: DispatchBatchClaim): Promise<DispatchResult[]> {
    return (await this.claimBatch(claim)).claims;
  }

  /**
   * {@link dispatchBatch}, with when the soonest group it passed over for `workerId` comes due to
   * that worker again (#9148): the dispatcher waits that long rather than polling a group it skips.
   */
  async claimBatch({
    nowMs,
    activeTtlSec,
    maxJobs,
    allowedGroupsKey,
    listKey,
    groupBatch,
    claimGuardWorkerId,
    workerId,
  }: DispatchBatchClaim): Promise<ClaimedBatch> {
    const readyKey = `${this.keyPrefix}ready`;
    const blockedKey = `${this.keyPrefix}blocked`;
    const pausedJobKey = `${this.keyPrefix}paused-jobs`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    const tenantCap = this.tenantConcurrencyCap;

    const result = await dispatchBatchScript.run(
      this.redis,
      5,
      readyKey,
      blockedKey,
      pausedJobKey,
      totalPendingKey,
      resolveDispatchAllowListRedisKey({
        keyPrefix: this.keyPrefix,
        allowedGroupsKey,
      }),
      this.keyPrefix,
      String(nowMs),
      String(activeTtlSec),
      String(maxJobs),
      String(tenantCap),
      String(this.globalConcurrencyBudget),
      allowedGroupsKey ? "1" : "",
      listKey ?? "",
      String(groupBatch?.maxGroups ?? 1),
      groupBatch?.routes.join("\n") ?? "",
      String(groupBatch?.maxClaims ?? 0),
      claimGuardWorkerId ?? "",
      String(CLAIM_MARKER_TTL_SECONDS),
      workerId ?? "",
    );

    // The script returns [flatResults, overrideDispatched, recovered, passOverUntil]. Counts ride
    // back with the results rather than living in a Redis key because a
    // Prometheus counter has to be per-process: one shared key reported by
    // every pod would multiply under sum(), the way the blocked-groups gauge
    // already does.
    if (!Array.isArray(result)) {
      return { claims: [], passedOverUntilMs: null };
    }

    const [rawResults, rawOverride, rawRecovered, rawPassOver] = result as unknown[];
    const passOverUntil = Number(rawPassOver);
    const passedOverUntilMs =
      Number.isSafeInteger(passOverUntil) && passOverUntil > 0 ? passOverUntil : null;
    const recovered = Number(rawRecovered);
    if (Number.isSafeInteger(recovered) && recovered > 0) {
      gqJobsRecoveredTotal.inc({ queue_name: this.queueName }, recovered);
    }
    const flat = Array.isArray(rawResults) ? rawResults : [];

    // A layout the script cannot produce (partial tuples) means the reply is
    // corrupt: don't count anything from it, and dispatch nothing.
    if (flat.length % DISPATCH_TUPLE_SIZE !== 0) {
      return { claims: [], passedOverUntilMs };
    }

    // Override dispatches are a subset of this batch's dispatches, so the
    // count can never exceed the tuples that came back with it.
    const overrideDispatched = Number(rawOverride);
    if (
      Number.isSafeInteger(overrideDispatched) &&
      overrideDispatched > 0 &&
      overrideDispatched <= flat.length / DISPATCH_TUPLE_SIZE
    ) {
      gqJobsDispatchedOverrideTotal.inc({ queue_name: this.queueName }, overrideDispatched);
    }

    if (flat.length === 0) {
      return { claims: [], passedOverUntilMs };
    }

    const dispatched: DispatchResult[] = [];
    for (let i = 0; i < flat.length; i += DISPATCH_TUPLE_SIZE) {
      dispatched.push({
        stagedJobId: String(flat[i]),
        groupId: String(flat[i + 1]),
        jobDataJson: String(flat[i + 2]),
        originalScore: Number(flat[i + 3]),
        claimToken: String(flat[i + 4]),
        groupAttempt: groupAttemptOf(flat[i + 5]),
        batchSlot: Number(flat[i + 6]),
        claimGuard: claimMarkerOf(flat[i + 7], flat[i + 8]),
      });
    }

    return { claims: dispatched, passedOverUntilMs };
  }

  /**
   * Mark a group job as completed and signal the dispatcher.
   *
   * @returns true if completed, false if stale (active key doesn't match)
   */
  async complete(completion: GroupCompletion): Promise<boolean> {
    const { numKeys, keysAndArgs } = this.completeCall(completion);
    return (await completeScript.run(this.redis, numKeys, ...keysAndArgs)) === 1;
  }

  /**
   * Many groups' completions in one round trip: each its own script call, claim token and
   * answer, so a stale one is fenced alone and a failure fails only its own entry.
   */
  async completeMany(
    completions: readonly GroupCompletion[],
  ): Promise<PromiseSettledResult<boolean>[]> {
    const settled = await this.runPipelined({
      script: completeScript,
      calls: completions.map((completion) => this.completeCall(completion)),
    });
    return settled.map(answeredOne);
  }

  private completeCall({
    groupId,
    stagedJobId,
    jobName,
    dropped = false,
    claimToken = "",
    candidatesKey,
    endsRetryChain = false,
  }: GroupCompletion): ScriptCall {
    // Only a key in this queue's slot: a cluster refuses a script whose keys span two.
    const listedKeys = candidatesKey?.startsWith(this.keyPrefix) ? [candidatesKey] : [];
    return {
      numKeys: 9 + listedKeys.length,
      keysAndArgs: [
        `${this.keyPrefix}group:${groupId}:active`,
        `${this.keyPrefix}group:${groupId}:jobs`,
        `${this.keyPrefix}ready`,
        `${this.keyPrefix}signal`,
        `${this.keyPrefix}stats:completed`,
        `${this.keyPrefix}group:${groupId}:error`,
        this.claimedKey(groupId),
        this.failStreakKey(groupId),
        this.groupAttemptKey(groupId),
        ...listedKeys,
        groupId,
        stagedJobId,
        jobName ?? "",
        `${this.keyPrefix}tenant_active_z:`,
        String(this.tenantConcurrencyCap),
        String(nowInstant().epochMilliseconds),
        dropped ? "1" : "",
        claimToken,
        endsRetryChain ? "1" : "",
        this.claimMarkerOwner,
      ],
    };
  }

  /**
   * One round trip for many calls of one script, each keeping its own keys and reply. A node
   * without the script cached answers NOSCRIPT per call; those re-run alone, which warms it.
   * The pipeline is written before the first await, so it keeps its place on the connection.
   */
  private async runPipelined({
    script,
    calls,
  }: {
    script: CachedLuaScript;
    calls: readonly ScriptCall[];
  }): Promise<PromiseSettledResult<unknown>[]> {
    const chunks: ScriptCall[][] = [];
    for (let index = 0; index < calls.length; index += MAX_PIPELINED_SCRIPT_CALLS) {
      chunks.push(calls.slice(index, index + MAX_PIPELINED_SCRIPT_CALLS));
    }
    const settled = await Promise.all(
      chunks.map((chunk) => this.runPipelinedChunk({ script, calls: chunk })),
    );
    return settled.flat();
  }

  private async runPipelinedChunk({
    script,
    calls,
  }: {
    script: CachedLuaScript;
    calls: readonly ScriptCall[];
  }): Promise<PromiseSettledResult<unknown>[]> {
    const pipeline = this.redis.pipeline();
    for (const call of calls) script.queue(pipeline, call.numKeys, ...call.keysAndArgs);
    const replies = await pipeline.exec();
    return Promise.allSettled(
      calls.map(async (call, index) => {
        const reply = replies?.[index];
        if (!reply) throw new Error("A pipelined script call came back without a reply");
        if (isNoScriptResult(reply)) {
          return script.runCancellable(
            this.redis,
            call.isCancelled ?? null,
            call.numKeys,
            ...call.keysAndArgs,
          );
        }
        const [error, value] = reply;
        if (error) throw error;
        return value;
      }),
    );
  }

  /**
   * Drain up to maxJobs additional DUE jobs without altering active/ready
   * state; only safe while the caller holds the group's active slot. `maxBytes`
   * caps the batch by summed stored size including `initialBytes`; `<= 0` (default) disables it.
   */
  async drainGroupReady({
    groupId,
    nowMs,
    maxJobs,
    maxBytes = 0,
    initialBytes = 0,
    claimToken = "",
  }: {
    groupId: string;
    nowMs: number;
    maxJobs: number;
    maxBytes?: number;
    initialBytes?: number;
    /** Siblings join this claim's record; a lost claim drains nothing. */
    claimToken?: string;
  }): Promise<DrainedJob[]> {
    if (maxJobs <= 0) return [];

    const jobsKey = `${this.keyPrefix}group:${groupId}:jobs`;
    const dataKey = `${this.keyPrefix}group:${groupId}:data`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    const result = await drainGroupScript.run(
      this.redis,
      4,
      jobsKey,
      dataKey,
      totalPendingKey,
      this.claimedKey(groupId),
      String(nowMs),
      String(maxJobs),
      String(maxBytes),
      String(initialBytes),
      claimToken,
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
    activeTtlSec,
    ...heartbeat
  }: GroupHeartbeat & { activeTtlSec: number }): Promise<boolean> {
    const { numKeys, keysAndArgs } = this.refreshCall({ heartbeat, activeTtlSec });
    const result = await refreshScript.runCancellable(
      this.redis,
      heartbeat.isCancelled ?? null,
      numKeys,
      ...keysAndArgs,
    );
    return result === 1;
  }

  /** Many groups' leases renewed in one round trip, each fenced by its own claim token. */
  async heartbeatMany({
    heartbeats,
    activeTtlSec,
  }: {
    heartbeats: readonly GroupHeartbeat[];
    activeTtlSec: number;
  }): Promise<PromiseSettledResult<boolean>[]> {
    const settled = await this.runPipelined({
      script: refreshScript,
      calls: heartbeats.map((heartbeat) => this.refreshCall({ heartbeat, activeTtlSec })),
    });
    return settled.map(answeredOne);
  }

  private refreshCall({
    heartbeat: { groupId, stagedJobId, claimToken = "", isCancelled },
    activeTtlSec,
  }: {
    heartbeat: GroupHeartbeat;
    activeTtlSec: number;
  }): ScriptCall {
    return {
      numKeys: 3,
      keysAndArgs: [
        `${this.keyPrefix}group:${groupId}:active`,
        `${this.keyPrefix}ready`,
        this.claimedKey(groupId),
        stagedJobId,
        String(activeTtlSec),
        groupId,
        String(nowInstant().epochMilliseconds),
        `${this.keyPrefix}tenant_active_z:`,
        claimToken,
      ],
      ...(isCancelled ? { isCancelled } : {}),
    };
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
    claimToken = "",
  }: {
    groupId: string;
    newStagedJobId: string;
    score: number;
    jobDataJson: string;
    errorMessage?: string;
    errorStack?: string;
    /** With it, a former owner whose claim was recovered blocks nothing. */
    claimToken?: string;
  }): Promise<boolean> {
    const blockedKey = `${this.keyPrefix}blocked`;
    const readyKey = `${this.keyPrefix}ready`;
    const statsKey = `${this.keyPrefix}stats:failed`;
    const totalPendingKey = `${this.keyPrefix}stats:total-pending`;

    const result = await restageAndBlockScript.run(
      this.redis,
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
      `${this.keyPrefix}tenant_active_z:`,
      claimToken,
      this.claimMarkerOwner,
    );
    return result === 1;
  }

  /**
   * Re-stage a job with a future dispatch score, keeping the active key alive
   * for FIFO ordering and freeing the tenant slot; TTL matches the backoff.
   * @returns true if re-staged, false if stale (active key doesn't match)
   */
  async retryRestage(retry: GroupRetryRestage): Promise<boolean> {
    const { numKeys, keysAndArgs } = this.retryRestageCall(retry);
    return (await retryRestageScript.run(this.redis, numKeys, ...keysAndArgs)) === 1;
  }

  /** Many groups' retries re-staged in one round trip, each fenced by its own claim token. */
  async retryRestageMany(
    retries: readonly GroupRetryRestage[],
  ): Promise<PromiseSettledResult<boolean>[]> {
    const settled = await this.runPipelined({
      script: retryRestageScript,
      calls: retries.map((retry) => this.retryRestageCall(retry)),
    });
    return settled.map(answeredOne);
  }

  private retryRestageCall({
    groupId,
    stagedJobId,
    newStagedJobId,
    dispatchAfterMs,
    jobDataJson,
    backoffMs,
    attempt,
    attemptTtlSec,
    claimToken = "",
    passOver,
  }: GroupRetryRestage): ScriptCall {
    // TTL = backoff + 2s buffer so the key expires just after the job becomes eligible
    const retryTtlSec = Math.ceil(backoffMs / 1000) + 2;
    return {
      numKeys: 3,
      keysAndArgs: [
        `${this.keyPrefix}group:${groupId}:active`,
        `${this.keyPrefix}stats:total-pending`,
        this.groupAttemptKey(groupId),
        this.keyPrefix,
        groupId,
        stagedJobId,
        newStagedJobId,
        String(dispatchAfterMs),
        jobDataJson,
        String(retryTtlSec),
        `${this.keyPrefix}tenant_active_z:`,
        String(nowInstant().epochMilliseconds),
        String(attempt),
        String(attemptTtlSec),
        String(this.tenantConcurrencyCap),
        claimToken,
        this.claimMarkerOwner,
        passOver?.workerId ?? "",
        String(passOver?.ttlMs ?? 0),
      ],
    };
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

  private claimedKey(groupId: string): string {
    return `${this.keyPrefix}group:${groupId}:claimed`;
  }

  private claimMarkerKey(groupId: string): string {
    return `${this.keyPrefix}group:${groupId}:claim`;
  }

  private workerBeaconKey(workerId: string): string {
    return `${this.keyPrefix}worker:${workerId}`;
  }

  /**
   * Publish this worker's liveness beacon before its first claim, refreshed
   * per {@link WORKER_LIVENESS_REFRESH_MS} — it must exist before claims do,
   * or another worker books this one's leftover markers as deaths.
   */
  async recordWorkerAlive(workerId: string): Promise<void> {
    await this.redis.set(
      this.workerBeaconKey(workerId),
      "alive",
      "EX",
      WORKER_LIVENESS_TTL_SECONDS,
    );
  }

  /**
   * Replace this worker's beacon with a retirement tombstone (planned exit, not
   * a death) that outlives the claim marker so it can't decay to "died". Caller
   * MUST stop the heartbeat first, or a late refresh restores `alive` briefly.
   */
  async retireWorker(workerId: string): Promise<void> {
    await this.redis.set(
      this.workerBeaconKey(workerId),
      "retired",
      "EX",
      WORKER_RETIRED_TTL_SECONDS,
    );
  }

  /**
   * Take ownership of a group's claim; see {@link CLAIM_GUARD_LUA} for why
   * death counts derive from the beacon, not a delete.
   * @returns death count and previous-owner state (none/self/alive/retired/gone) — diagnostic.
   */
  async recordClaim({
    groupId,
    workerId,
    stagedJobId,
    claimToken = "",
  }: {
    groupId: string;
    workerId: string;
    stagedJobId: string;
    /** The claim the marker answers for; its release then names the same claim. */
    claimToken?: string;
  }): Promise<{ deaths: number; lastOwnerState: string }> {
    const result = await claimGuardScript.run(
      this.redis,
      // Declared as a KEY, not derived in Lua: ioredis routes a cluster EVAL by
      // its KEYS, so a zero-key script lands on an arbitrary node and the
      // derived accesses can fall outside the slot that node owns. The beacon
      // key stays derived from `keyPrefix`, which carries the same hash tag.
      1,
      this.claimMarkerKey(groupId),
      this.keyPrefix,
      workerId,
      stagedJobId,
      String(CLAIM_MARKER_TTL_SECONDS),
      claimToken,
    );
    const [deaths, lastOwnerState] = Array.isArray(result) ? result : [];
    return {
      deaths: typeof deaths === "number" ? deaths : 0,
      lastOwnerState: typeof lastOwnerState === "string" ? lastOwnerState : "",
    };
  }

  /**
   * Release this worker's claim marker, if it is still the owner. Deleting it
   * when we are NOT the owner is not harmless, which is why this is a
   * compare-and-delete — see {@link RELEASE_CLAIM_LUA}.
   */
  async releaseClaim({
    groupId,
    workerId,
    claimToken = "",
  }: {
    groupId: string;
    workerId: string;
    /** With it, a marker recorded for another claim of this worker survives. */
    claimToken?: string;
  }): Promise<void> {
    await releaseClaimScript.run(this.redis, 1, this.claimMarkerKey(groupId), workerId, claimToken);
  }

  /**
   * Drop the claim marker whoever owns it. Only for parking: the group leaves
   * dispatch entirely, so the marker must not survive to re-park later, and an
   * ownership check here would let it survive when the guard doesn't apply.
   */
  async discardClaim(groupId: string): Promise<void> {
    await this.redis.del(this.claimMarkerKey(groupId));
  }

  /** Confirmed worker deaths recorded against a group. */
  async getConfirmedDeaths(groupId: string): Promise<number> {
    const raw = await this.redis.hget(this.claimMarkerKey(groupId), "deaths");
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  private failStreakKey(groupId: string): string {
    return `${this.keyPrefix}group:${groupId}:failstreak`;
  }

  /**
   * Per-group retry-chain counter: a re-staged sibling carries no `__attempt`
   * of its own, so without this it would read as a fresh delivery.
   */
  groupAttemptKey(groupId: string): string {
    return `${this.keyPrefix}group:${groupId}:attempt`;
  }

  /**
   * Group-quarantine failure streak: INCR'd on every RETRYABLE failure, cleared
   * on success; counts consecutive failures across jobs, which per-job `maxAttempts` misses.
   * @returns the streak count including this failure
   */
  async recordGroupFailure(groupId: string): Promise<number> {
    const key = this.failStreakKey(groupId);
    const results = await this.redis
      .multi()
      .incr(key)
      .expire(key, GROUP_QUARANTINE_TTL_SECONDS)
      .exec();
    const count = results?.[0]?.[1];
    return typeof count === "number" ? count : 0;
  }

  async clearGroupFailures(groupId: string): Promise<void> {
    await this.redis.del(this.failStreakKey(groupId));
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

    if (!result?.message) {
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
   * The barrier's look at its target groups, at most {@link PREFLIGHT_GROUPS_PER_CALL} per
   * script call: 200k groups in one call held Redis for 70 s. Small sets stay one atomic
   * look; why slices stay sound is in specs/migration/system-migrations-runner.feature.
   */
  async inspectPreflightTargets(targetKey: string): Promise<PreflightTargetsState> {
    const whole = await this.inspectPreflightPage({ targetKey, groupIds: [] });
    if (whole[0] !== -1) return addPreflightPage({ state: NO_PREFLIGHT_TARGETS, reply: whole });

    const registrationsKey = `${targetKey}:registrations`;
    const before = await this.redis.get(registrationsKey);

    let state = NO_PREFLIGHT_TARGETS;
    const seen = new Set<string>();
    let cursor = "0";
    do {
      const [next, members] = await this.redis.sscan(
        targetKey,
        cursor,
        "COUNT",
        PREFLIGHT_GROUPS_PER_CALL,
      );
      cursor = next;
      // SSCAN may return a member twice while the set rehashes; count each group once.
      const fresh = members.filter((groupId) => !seen.has(groupId));
      for (const groupId of fresh) seen.add(groupId);
      for (let start = 0; start < fresh.length; start += PREFLIGHT_GROUPS_PER_CALL) {
        const groupIds = fresh.slice(start, start + PREFLIGHT_GROUPS_PER_CALL);
        const reply = await this.inspectPreflightPage({ targetKey, groupIds });
        state = addPreflightPage({ state, reply });
      }
    } while (cursor !== "0");
    const after = await this.redis.get(registrationsKey);
    return { ...state, changedDuringInspection: before !== after };
  }

  private async inspectPreflightPage({
    targetKey,
    groupIds,
  }: {
    targetKey: string;
    groupIds: readonly string[];
  }): Promise<unknown[]> {
    const reply: unknown = await inspectPreflightPageScript.run(
      this.redis,
      3,
      targetKey,
      `${this.keyPrefix}blocked`,
      `${targetKey}:baseline`,
      this.keyPrefix,
      String(PREFLIGHT_NAMED_GROUP_LIMIT),
      String(PREFLIGHT_GROUPS_PER_CALL),
      ...groupIds,
    );
    return Array.isArray(reply) ? reply : [];
  }

  async registerPreflightTargets({
    targetKey,
    groupIds,
  }: {
    targetKey: string;
    groupIds: readonly string[];
  }): Promise<void> {
    for (let start = 0; start < groupIds.length; start += PREFLIGHT_GROUPS_PER_CALL) {
      await registerPreflightTargetsScript.run(
        this.redis,
        8,
        targetKey,
        `${targetKey}:candidates`,
        this.getSignalKey(),
        `${this.keyPrefix}blocked`,
        `${targetKey}:baseline`,
        `${targetKey}:registrations`,
        `${targetKey}:live`,
        this.openGroupListsKey(),
        this.keyPrefix,
        String(LISTED_GROUPS_TTL_SEC),
        String(start),
        String(nowInstant().epochMilliseconds + LISTED_GROUPS_TTL_SEC * 1000),
        ...groupIds.slice(start, start + PREFLIGHT_GROUPS_PER_CALL),
      );
    }
  }

  /** Opens a list for a `dispatchListed` consumer; every registration keeps it open. */
  async openGroupList({ listKey, nowMs }: { listKey: string; nowMs: number }): Promise<void> {
    await this.redis.zadd(this.openGroupListsKey(), nowMs + LISTED_GROUPS_TTL_SEC * 1000, listKey);
  }

  /** The lists a `dispatchListed` consumer runs now, dropping any that lapsed. */
  async findOpenGroupLists(nowMs: number): Promise<string[]> {
    const key = this.openGroupListsKey();
    await this.redis.zremrangebyscore(key, "-inf", nowMs);
    return this.redis.zrange(key, 0, -1);
  }

  /** Closes a list and removes its groups' record; the jobs themselves stay queued. */
  async closeGroupList(listKey: string): Promise<void> {
    await this.redis.zrem(this.openGroupListsKey(), listKey);
    // UNLINK: a large run's sets are freed off the Redis thread, not inside this call.
    await this.redis.unlink(
      listKey,
      `${listKey}:candidates`,
      `${listKey}:baseline`,
      `${listKey}:registrations`,
      `${listKey}:live`,
    );
  }

  /**
   * The jobs a list's groups still hold, waiting or running, blocked groups aside (they never
   * drain on their own; the run's closing wait names them). Prunes the groups that settled.
   */
  async countListedOutstanding(listKey: string): Promise<number> {
    const liveKey = `${listKey}:live`;
    let outstanding = 0;
    let cursor = "0";
    do {
      const [next, members] = await this.redis.sscan(
        liveKey,
        cursor,
        "COUNT",
        PREFLIGHT_GROUPS_PER_CALL,
      );
      cursor = next;
      for (let start = 0; start < members.length; start += PREFLIGHT_GROUPS_PER_CALL) {
        const reply: unknown = await countListedOutstandingScript.run(
          this.redis,
          3,
          liveKey,
          `${this.keyPrefix}blocked`,
          listKey,
          this.keyPrefix,
          ...members.slice(start, start + PREFLIGHT_GROUPS_PER_CALL),
        );
        outstanding += Number(reply) || 0;
      }
    } while (cursor !== "0");
    return outstanding;
  }

  private openGroupListsKey(): string {
    return `${this.keyPrefix}listed`;
  }

  /**
   * Earliest dispatch-after score in the ready set (strictly after `afterMs`, if given), or null.
   * The dispatcher clamps its BRPOP fallback to this so a group staged with a dispatch delay
   * still wakes when due, since nothing else re-signals it.
   */
  async getEarliestReadyScore({ afterMs }: { afterMs?: number } = {}): Promise<number | null> {
    const readyKey = `${this.keyPrefix}ready`;
    const result =
      afterMs === undefined
        ? await this.redis.zrange(readyKey, 0, 0, "WITHSCORES")
        : await this.redis.zrangebyscore(
            readyKey,
            `(${afterMs}`,
            "+inf",
            "WITHSCORES",
            "LIMIT",
            0,
            1,
          );
    if (result.length < 2) return null;
    const score = Number(result[1]);
    return Number.isFinite(score) ? score : null;
  }

  /** The soonest candidate score after `afterMs` across listed runs' candidates, if any. */
  async getEarliestCandidateScore({
    candidatesKeys,
    afterMs,
  }: {
    candidatesKeys: readonly string[];
    afterMs: number;
  }): Promise<number | null> {
    const scores = await Promise.all(
      candidatesKeys.map(async (key) => {
        const result = await this.redis.zrangebyscore(
          key,
          `(${afterMs}`,
          "+inf",
          "WITHSCORES",
          "LIMIT",
          0,
          1,
        );
        return result.length < 2 ? Number.NaN : Number(result[1]);
      }),
    );
    const finite = scores.filter((score) => Number.isFinite(score));
    return finite.length === 0 ? null : Math.min(...finite);
  }

  /**
   * Get the key prefix for metrics/recovery scans.
   */
  getKeyPrefix(): string {
    return this.keyPrefix;
  }
}

/**
 * Key of the pending-groups index, from a queue's key prefix (`<name>:gq:`).
 * Mirrors what `gqMarkPending` builds; see PENDING_INDEX_HELPER_LUA.
 */
export function pendingGroupsKey(keyPrefix: string): string {
  return `${keyPrefix}pending-groups`;
}

/**
 * Key holding the drift the last reconcile pass measured, from the queue's
 * key prefix. Shared, not per-process — reconcile is single-flighted, so a
 * losing instance's own figure would be a false zero for what it never computed.
 */
export function pendingDriftKey(keyPrefix: string): string {
  return `${keyPrefix}stats:pending-drift`;
}

/** Resolves the fifth dispatch-script key without ever leaving the queue's slot. */
export function resolveDispatchAllowListRedisKey({
  keyPrefix,
  allowedGroupsKey,
}: {
  keyPrefix: string;
  allowedGroupsKey?: string;
}): string {
  return allowedGroupsKey ?? `${keyPrefix}dispatch-all`;
}
