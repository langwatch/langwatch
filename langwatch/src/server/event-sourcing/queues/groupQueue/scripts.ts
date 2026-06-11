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

/**
 * Max groups any single unpark moves in one Lua eval. The cap=0 kill switch
 * drains a tenant's entire parked set; without a bound, flipping the cap off
 * while a tenant has a huge parked backlog (the May 27 incident parked ~442K)
 * would do one ZRANGE + per-group ZREM/ZADD over the whole set in a single eval
 * and block the single Redis thread — recreating the stall the kill switch
 * exists to stop. Bounding the per-eval work lets the 2s-gated reconcile drain
 * gradually instead. Interpolated into the Lua for a single source of truth.
 */
export const PARK_RECONCILE_MAX_DRAIN = 1000;

/**
 * Cadence (ms) of the dispatch-tail reconcile pass (parked-group restore + the
 * dynamic-cap recompute), gated single-pod via the reconcile-ts marker. The
 * dynamic-cap TTL and the claimant window are both defined as multiples of this,
 * so it is a named const rather than a bare literal in the dispatch scripts —
 * retuning it keeps those relationships intact. Interpolated into the Lua.
 */
export const RECONCILE_INTERVAL_MS = 2000;

/**
 * TTL (ms) on the dynamic water-level cap key (= 5x RECONCILE_INTERVAL_MS). The
 * recompute refreshes this key on every reconcile pass; the TTL spans several
 * intervals so a brief miss does not drop the cap. If the recompute stalls
 * entirely (every pod dead or wedged) the key lapses and dispatch falls back to
 * the static operator cap — fail PROTECTIVE (the low side), never permissive.
 * Interpolated into the Lua so there is a single source of truth.
 */
export const DYNAMIC_CAP_TTL_MS = 5 * RECONCILE_INTERVAL_MS;

/**
 * Hard bound on how many tenants the dynamic-cap recompute processes in one
 * pass. The recompute does O(1) Redis calls per tenant (active ZCARD + parked
 * ZCARD) inside a single eval on the single-threaded Redis; bounding it to the
 * most-recently-active N keeps the worst case at ~3N calls every
 * RECONCILE_INTERVAL_MS (sub-millisecond at N=1000) even if a pathological
 * fan-out leaves thousands of tenants in the demand registry. The N most-recent
 * claimants are the current contention set; older ones have aged out of the
 * window and their in-flight is still enforced directly via tenant_active_z.
 */
export const MAX_DEMANDING_TENANTS = 1000;

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

// Lua helper for the per-tenant in-flight count that backs the soft cap.
//
// Modeled as a ZSET per tenant (member = groupId, score = the slot's expiry in
// ms) instead of a scalar INCR/DECR counter. A scalar counter leaks UP when a
// worker dies UNGRACEFULLY (no COMPLETE to decrement) and never self-heals,
// because dispatch keeps refreshing its TTL — the 2026-05-28 incident, where an
// ElastiCache node replacement dropped every worker's Redis connection mid-job,
// stranding a live tenant permanently at cap with thousands of groups parked.
//
// Each in-flight slot instead carries the SAME expiry as its activeKey heartbeat
// (renewed by REFRESH while the worker lives). A slot whose heartbeat lapses has
// a past score, so it stops counting against the cap once its expiry passes: an
// ungraceful mass death self-heals within the active TTL with no operator reset.
// The live count GCs lapsed members first so dead-worker entries can't grow the
// ZSET unbounded. Keys share the keyPrefix hash tag so they stay in one slot.
// See specs/event-sourcing/tenant-soft-cap.feature (self-heal scenario).
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
//
// Prepends TENANT_ACTIVE_HELPER_LUA so reconcileParked can read the self-healing
// in-flight count; every script that includes PARK_HELPER_LUA gets both.
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
    unparkUpTo(readyKey, tenantId, slots)
  end
end
`;

/**
 * How long (ms) a tenant stays a "claimant" after its last enqueue/dispatch.
 * A brand-new tenant whose burst is still entirely in ready (no in-flight, none
 * parked) is invisible to a count-only demand measure, so the water-level would
 * keep W at the full budget and the newcomer would never be admitted (a stable
 * starvation behind a higher-priority incumbent, not a one-tick lag). We instead
 * treat any freshly-active tenant as a claimant that pulls a full fair share.
 * The window is several recompute intervals (= 8x RECONCILE_INTERVAL_MS, longer
 * than the dynamic-cap TTL) so a tenant that briefly goes quiet is not dropped
 * mid-burst; once it stops enqueueing AND drains, it ages out and its reserved
 * share is released. Interpolated into the Lua for one source.
 */
export const CLAIMANT_WINDOW_MS = 8 * RECONCILE_INTERVAL_MS;

// Lua helper for the DYNAMIC per-tenant cap (option C, 2026-05-29 follow-up to
// the fixed soft cap). The hot path is unchanged — it still parks a group when
// its tenant's in-flight count reaches the cap — but the cap is now a water-level
// W recomputed off the existing 2s reconcile pass instead of a fixed constant.
// W water-fills a global in-flight budget G across the tenants with demand: a
// lone tenant gets W=G (bursts to full), N contenders converge to a max-min fair
// share, all emergent with no per-tenant allocation and no new dispatch path.
// Requires tenantActiveCount (from TENANT_ACTIVE_HELPER_LUA via PARK_HELPER_LUA),
// so it is always concatenated after PARK_HELPER_LUA.
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
  if best then unparkUpTo(readyKey, best, slots) end
end
`;

const STAGE_LUA =
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
if globalBudget > 0 then
  redis.call("ZADD", parkKeyPrefixOf(readyKey) .. "demanding-tenants", nowMs, parkTenantOf(groupId))
end

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
  addToReadyOrParked(readyKey, groupId, dispatchAfter, true)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

-- New job staged: increment total pending counter
redis.call("INCR", totalPendingKey)

return 1
`;

const STAGE_BATCH_LUA =
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
  if globalBudget > 0 then
    redis.call("ZADD", keyPrefix .. "demanding-tenants", nowMs, parkTenantOf(groupId))
  end
  -- Score = earliest pending dispatchAfter (LT keeps the smallest).
  -- Skip when the group is processing or blocked — the active heartbeat /
  -- completion / unblock paths own the score in those states. Lowering it
  -- here would re-expose the group to ZRANGEBYSCORE before the next refresh.
  local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
  if redis.call("EXISTS", activeKey) == 0 and redis.call("SISMEMBER", blockedKey, groupId) == 0 then
    addToReadyOrParked(readyKey, groupId, minScore, true)
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

const DISPATCH_LUA =
  PARK_HELPER_LUA +
  WATER_LEVEL_HELPER_LUA +
  `
local readyKey         = KEYS[1]
local blockedKey       = KEYS[2]
local pausedJobKey     = KEYS[3]
local totalPendingKey  = KEYS[4]

local keyPrefix    = ARGV[1]
local nowMs        = tonumber(ARGV[2])
local activeTtlSec = tonumber(ARGV[3])
-- Static operator soft-cap (post-2026-05-11 incident follow-up). 0 = explicit
-- kill switch (LANGWATCH_DISPATCH_TENANT_CAP=0): no cap, no parking. > 0 is the
-- per-tenant in-flight ceiling AND the fail-protective fallback for the dynamic
-- cap below. The tenantId is the groupId prefix (segment before first '/').
local staticCap    = tonumber(ARGV[4]) or 0
-- Global in-flight budget for the DYNAMIC water-level cap (option C). It is the
-- hard ceiling = pods x concurrency; the water-fill divides the WHOLE capacity.
-- 0 = dynamic disabled, dispatch uses the static cap unchanged (back-compat).
local globalBudget = tonumber(ARGV[5]) or 0

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local activeUntil = nowMs + activeTtlSec * 1000

-- Restore parked over-cap groups + recompute the water-level on a cadence (TRAP 2
-- orphan recovery + cap=0 drain). COMPLETE-unpark handles the normal slot-freeing
-- as jobs finish; this only backstops what it can't: a crashed/timed-out tenant
-- that never fires COMPLETE (its in-flight slots lapse out of the live count as
-- their expiry scores pass = back under cap = unpark), and flipping the cap off
-- (drain everything parked). Time-gated and single-pod via reconcile-ts, so the
-- water-fill rides the same proven cadence at near-zero marginal cost.
local reconcileTsKey = keyPrefix .. "reconcile-ts"
local lastReconcile = tonumber(redis.call("GET", reconcileTsKey)) or 0
if (nowMs - lastReconcile) >= ${RECONCILE_INTERVAL_MS} then
  redis.call("SET", reconcileTsKey, nowMs)
  -- Recompute W before reconciling so unpark uses the fresh cap. Only when the
  -- cap is on (staticCap=0 is the kill switch) and a budget is configured.
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

-- Effective per-tenant cap for this dispatch: the dynamic water-level when a
-- budget is configured, else the static cap. staticCap=0 (kill switch) always
-- wins and disables parking entirely.
local tenantCap = staticCap
if staticCap > 0 and globalBudget > 0 then
  tenantCap = effectiveCap(keyPrefix, staticCap)
end

-- Scan ready in priority order and dispatch ONE due job. effCap gates the
-- per-tenant in-flight cap (0 = cap off). bypassPark skips the over-cap PARKING
-- decision (used by the work-conserving override) while STILL recording the
-- in-flight slot, so an override dispatch is counted against its tenant.
-- Page through the ready zset so a head full of paused / blocked / legacy-drift
-- entries does not return nil while eligible work exists later.
local function scanAndDispatch(effCap, bypassPark)
  local pageSize = 200
  -- Widen the scan budget when the cap is on so a head full of one tenant's
  -- over-cap groups (correctly skipped but still counted) cannot starve tenants
  -- deeper in the zset. The explicit cost of the cap: more work per poll.
  local scanBudget = 1000
  if effCap > 0 then scanBudget = 10000 end
  local offset = 0
  -- Cache tenant cap lookups within this scan to avoid redundant GETs.
  local tenantCapCache = {}

  while offset < scanBudget do
    local groups = redis.call("ZRANGEBYSCORE", readyKey, "-inf", nowMs, "LIMIT", offset, pageSize)
    if #groups == 0 then return nil end

    for _, groupId in ipairs(groups) do
      if redis.call("SISMEMBER", blockedKey, groupId) == 0 then
        -- Tenant cap check (no-op when effCap == 0). capTenantId is resolved
        -- regardless of bypassPark so the in-flight slot is still recorded; only
        -- the PARK decision is skipped under bypassPark.
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
                -- Park the over-cap group OUT of ready (once) so subsequent polls
                -- reach other tenants without re-scanning it. Restored when the
                -- tenant's in-flight count drops below cap (COMPLETE / reconcile).
                parkGroup(readyKey, groupId)
              end
            end
          end
        end

        -- Tenant-level pause: park the group OUT of ready (like over-cap) rather
        -- than skip it in place. A paused tenant can hold a huge due-now backlog;
        -- left in ready it sits at the front and the bounded scan burns its whole
        -- budget skipping it, starving every other tenant (the 2026-05-27 stall).
        local tenantPaused = false
        if hasPauses then
          if redis.call("SISMEMBER", pausedJobKey, "tenant:" .. parkTenantOf(groupId)) == 1 then
            tenantPaused = true
            parkGroup(readyKey, groupId)
          end
        end

        local activeKey = keyPrefix .. "group:" .. groupId .. ":active"
        -- Defensive activeKey check — covers legacy state during migration
        -- and the small race between ZADD ready and ZADD active.
        local activeJob = redis.call("GET", activeKey)
        if (not activeJob) and (not tenantOverCap) and (not tenantPaused) then
          local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
          local results = redis.call("ZRANGEBYSCORE", jobsKey, "-inf", nowMs, "WITHSCORES", "LIMIT", 0, 1)

          if #results >= 2 then
            local stagedJobId = results[1]
            local originalScore = results[2]

            -- Check pause status before dequeuing
            local paused = false
            if hasPauses then
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

              -- Tenant in-flight slot (self-healing ZSET; only when cap is set).
              -- Recorded even under bypassPark so override dispatches are counted.
              if effCap > 0 and capTenantId then
                tenantActiveAdd(keyPrefix .. "tenant_active_z:", capTenantId, groupId, activeUntil)
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
end

local r = scanAndDispatch(tenantCap, false)
if r then return r end

-- Work-conserving override: nothing was admittable under the cap, but over-cap
-- work is parked while this slot would otherwise idle. Fairness binds ONLY under
-- contention; a slot free here means no contention, so exceed the per-tenant cap
-- W (never the global ceiling G — that is bounded by this pod's free slots)
-- rather than idle, which is the static-cap idle-behind-cap waste this feature
-- removes. Unpark the least-served over-cap tenant and dispatch it, parking
-- bypassed for the pass. Only when the cap is active (tenantCap>0).
if globalBudget > 0 and tenantCap > 0 and redis.call("SCARD", keyPrefix .. "parked-tenants") > 0 then
  unparkLeastServedParked(readyKey, keyPrefix, pausedJobKey, nowMs, 1)
  return scanAndDispatch(tenantCap, true)
end

return nil
`;

const DISPATCH_BATCH_LUA =
  PARK_HELPER_LUA +
  WATER_LEVEL_HELPER_LUA +
  `
local readyKey         = KEYS[1]
local blockedKey       = KEYS[2]
local pausedJobKey     = KEYS[3]
local totalPendingKey  = KEYS[4]

local keyPrefix      = ARGV[1]
local nowMs          = tonumber(ARGV[2])
local activeTtlSec   = tonumber(ARGV[3])
local maxJobs        = tonumber(ARGV[4])
-- Static operator soft-cap (0 = kill switch). See DISPATCH_LUA comment.
local staticCap      = tonumber(ARGV[5]) or 0
-- Global in-flight budget = hard ceiling for the dynamic water-level cap.
-- 0 = dynamic disabled, static cap unchanged (back-compat). See DISPATCH_LUA.
local globalBudget   = tonumber(ARGV[6]) or 0

local hasPauses = redis.call("SCARD", pausedJobKey) > 0
local activeUntil = nowMs + activeTtlSec * 1000
local results = {}

-- Restore parked over-cap groups + recompute the water-level on a cadence (TRAP 2
-- orphan recovery + cap=0 drain) — see DISPATCH_LUA for the rationale. Time- and
-- SCARD-gated so it is a no-op at the cap=0 steady state; the water-fill rides
-- the same single-pod reconcile-ts cadence at near-zero marginal cost.
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

-- Effective per-tenant cap: dynamic water-level when a budget is configured,
-- else the static cap. staticCap=0 (kill switch) wins and disables parking.
local tenantCap = staticCap
if staticCap > 0 and globalBudget > 0 then
  tenantCap = effectiveCap(keyPrefix, staticCap)
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
  local tenantCapCache = {}

  while offset < scanBudget and dispatched < maxJobs do
    local groups = redis.call("ZRANGEBYSCORE", readyKey, "-inf", nowMs, "LIMIT", offset, pageSize)
    if #groups == 0 then break end

    for _, groupId in ipairs(groups) do
      if dispatched >= maxJobs then break end

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
              parkGroup(readyKey, groupId)
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
          parkGroup(readyKey, groupId)
        end
      end

      if not tenantOverCap and not tenantPaused then
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

              -- Tenant in-flight slot (self-healing ZSET; only when cap is set).
              -- Recorded even under bypassPark so override dispatches are counted.
              if effCap > 0 and capTenantId then
                tenantActiveAdd(keyPrefix .. "tenant_active_z:", capTenantId, groupId, activeUntil)
                -- Invalidate cache — count changed, may now be at cap
                tenantCapCache[capTenantId] = nil
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

  return dispatched
end

local dispatched = scanBatch(tenantCap, false, 0)

-- Work-conserving override: spare local slots remain (dispatched < maxJobs) but
-- nothing more was admittable under the cap, while over-cap work sits parked.
-- Fairness binds only under contention; spare capacity = no contention, so fill
-- the idle slots from the least-served over-cap tenant rather than return short
-- and idle the fleet (the static-cap idle-behind-cap sin). Bounded to the
-- remaining slots; this pod's free-slot budget keeps the fleet total at G.
if globalBudget > 0 and tenantCap > 0 and dispatched < maxJobs and redis.call("SCARD", keyPrefix .. "parked-tenants") > 0 then
  unparkLeastServedParked(readyKey, keyPrefix, pausedJobKey, nowMs, maxJobs - dispatched)
  dispatched = scanBatch(tenantCap, true, dispatched)
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

const COMPLETE_LUA =
  PARK_HELPER_LUA +
  WATER_LEVEL_HELPER_LUA +
  `
local activeKey       = KEYS[1]
local jobsKey         = KEYS[2]
local readyKey        = KEYS[3]
local signalKey       = KEYS[4]
local statsKey        = KEYS[5]
local errorKey        = KEYS[6]

local groupId      = ARGV[1]
local stagedJobId  = ARGV[2]
local jobName      = ARGV[3]
-- Tenant in-flight ZSET key prefix. When the soft-cap is enabled in
-- DISPATCH_LUA, completing a job must remove this group's slot from the
-- per-tenant ZSET so freed slots are picked up by other tenants. Passing the
-- prefix in (not a derived tenantId) lets us keep the cap optional without
-- breaking back-compat with older call sites.
local tenantCountKeyPrefix = ARGV[4]
-- Static operator soft-cap (same value DISPATCH_LUA reads). When > 0, a
-- completion frees a slot that may let one of the tenant's parked over-cap
-- groups resume, so we unpark up to the freed headroom. 0 = cap disabled.
local staticCap = tonumber(ARGV[5]) or 0
local nowMs = tonumber(ARGV[6])

local currentActive = redis.call("GET", activeKey)
if currentActive ~= stagedJobId then
  return 0
end

redis.call("DEL", activeKey)

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
  unparkUpTo(readyKey, tenantId, tenantCap - active)
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

const REFRESH_LUA =
  TTL_HELPER_LUA +
  `
local activeKey    = KEYS[1]
local readyKey     = KEYS[2]
local stagedJobId           = ARGV[1]
local activeTtlSec          = tonumber(ARGV[2])
local groupId               = ARGV[3]
local nowMs                 = tonumber(ARGV[4])
-- Tenant in-flight ZSET key prefix (soft-cap). When provided, this group's
-- slot expiry score is bumped alongside the activeKey TTL so long-running
-- groups keep counting against the cap mid-execution (a stale-scored slot
-- would lapse out of the live count and let the same tenant grab another).
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
-- Same shape as COMPLETE_LUA's ARGV[4]: when non-empty, removes this
-- group's slot from the per-tenant in-flight ZSET so the soft cap doesn't
-- leak slots when a group exhausts retries. Without this the slot would
-- count against the cap until its expiry score lapses on its own.
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
local ok, data = pcall(cjson.decode, jobDataJson)
if ok and data then
  local jn = data["__jobName"]
  if jn and jn ~= "" then
    redis.call("INCR", statsKey .. ":" .. jn)
  end
end

return 1
`;

const RETRY_RESTAGE_LUA =
  TTL_HELPER_LUA +
  PARK_HELPER_LUA +
  `
local activeKey       = KEYS[1]
local totalPendingKey = KEYS[2]

local keyPrefix             = ARGV[1]
local groupId               = ARGV[2]
local stagedJobId           = ARGV[3]
local newStagedJobId        = ARGV[4]
local dispatchAfterMs       = tonumber(ARGV[5])
local jobDataJson           = ARGV[6]
local retryTtlSec           = tonumber(ARGV[7])
-- Tenant in-flight ZSET key prefix (soft-cap). Keeps this group's slot
-- expiry score aligned with the activeKey TTL across backoff retries so an
-- in-flight retry's slot doesn't lapse out of the live count.
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
--    eligible exactly when the backoff window expires. Route through the
--    parked-aware write so the invariant holds (an active group entering retry
--    is never itself parked, so this normally writes straight to ready).
local readyKey = keyPrefix .. "ready"
addToReadyOrParked(readyKey, groupId, dispatchAfterMs, false)

-- 4. Set active key TTL to match backoff period.
--    While the key exists the group is locked (preserves FIFO ordering).
--    When it expires the dispatcher picks up the retry job on its next poll.
redis.call("EXPIRE", activeKey, retryTtlSec)

-- 5. Bump this slot's expiry score in lockstep with the activeKey TTL so the
-- soft cap stays accurate during backoff windows. XX (below) only updates an
-- existing slot, so we never re-create a slot COMPLETE_LUA legitimately freed.
if tenantCountKeyPrefix and tenantCountKeyPrefix ~= "" then
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    -- Bump this slot's expiry to the backoff window so an in-flight retry keeps
    -- its tenant slot. XX = only if still in-flight, never re-create a freed slot.
    redis.call("ZADD", tenantCountKeyPrefix .. string.sub(groupId, 1, slashPos - 1), "XX", nowMs + retryTtlSec * 1000, groupId)
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
 * Global in-flight budget for the dynamic water-level cap (option C, 2026-05-29).
 * 0 (the default) disables the dynamic cap: dispatch falls back to the fixed
 * per-tenant `readTenantCap()` and behaves exactly as before — the feature ships
 * inert and is enabled per-environment by setting this to the fleet's true
 * ceiling (pods x GLOBAL_QUEUE_CONCURRENCY). The water-fill then divides that
 * whole capacity across competing tenants, so a lone tenant gets the full budget
 * (bursts to fleet) while N contenders converge to a max-min fair share.
 *
 * Semantics:
 *   - env unset / empty / non-numeric / negative -> DEFAULT_GLOBAL_BUDGET (0, off)
 *   - env = positive integer -> that integer (enabled)
 */
export const DEFAULT_GLOBAL_BUDGET = 0;

export function readGlobalBudget(): number {
  const raw = process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET;
  if (raw === undefined || raw === "") return DEFAULT_GLOBAL_BUDGET;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GLOBAL_BUDGET;
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
      dedupId !== ""
        ? `${this.keyPrefix}dedup:${dedupId}`
        : `${this.keyPrefix}dedup:__none__`;

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
      String(readGlobalBudget()),
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
    // Appended after all per-job args: nowMs then globalBudget last, so the Lua
    // reads globalBudget as ARGV[#ARGV] and nowMs as ARGV[#ARGV-1] regardless of
    // job count.
    args.push(String(Date.now()));
    args.push(String(readGlobalBudget()));

    const result = await this.redis.eval(
      STAGE_BATCH_LUA,
      3,
      readyKey,
      signalKey,
      totalPendingKey,
      ...args,
    );

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
      String(readGlobalBudget()),
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
      String(readGlobalBudget()),
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
      `${this.keyPrefix}tenant_active_z:`,
      String(readTenantCap()),
      String(Date.now()),
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
      `${this.keyPrefix}tenant_active_z:`,
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
      `${this.keyPrefix}tenant_active_z:`,
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
      `${this.keyPrefix}tenant_active_z:`,
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
   * Earliest dispatch-after score in the ready set, or null when empty.
   * The dispatcher clamps its BRPOP fallback to this so groups staged
   * with a dispatch delay wake when due: their send-time signals fire
   * (and get drained) while the job is still inside its delay window,
   * and nothing re-signals at the due time.
   */
  async getEarliestReadyScore(): Promise<number | null> {
    const result = await this.redis.zrange(
      `${this.keyPrefix}ready`,
      0,
      0,
      "WITHSCORES",
    );
    if (result.length < 2) return null;
    const score = Number(result[1]);
    return Number.isFinite(score) ? score : null;
  }

  /**
   * Get the key prefix for metrics/recovery scans.
   */
  getKeyPrefix(): string {
    return this.keyPrefix;
  }
}
