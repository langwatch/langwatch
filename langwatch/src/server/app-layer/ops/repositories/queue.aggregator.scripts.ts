// Lua scripts for live queue inspection. Each script is invoked with a chunk
// of groupIds (collected in Node) so wall-clock work stays bounded per call.
// All keys derive from `keyPrefix` which already carries the {queueName} hash
// tag, so every operation hashes to a single Redis Cluster slot.

// Shared helpers, prefixed onto each script. Centralises the per-job
// classification, retry-count parsing, JSON extraction, and chunked HMGET
// so the two scripts cannot drift on those primitives.
const LUA_PROLOGUE = `
-- Force empty Lua tables to encode as JSON arrays (default is "{}" which is
-- an object — breaks JS-side Array.isArray() and for..of iteration).
if cjson.encode_empty_table_as_object then
  pcall(cjson.encode_empty_table_as_object, false)
end

local function parseRetryCount(jobId)
  local n = string.match(jobId, "/r/(%d+)$")
  if n then
    local num = tonumber(n)
    if num and num < 1000 then return num end
  end
  return cjson.null
end

local function classify(jobId, score, isBlocked, nowMs)
  if isBlocked then return "blocked" end
  if string.match(jobId, "/r/(%d+)$") ~= nil then return "retrying" end
  if score <= nowMs then return "ready" end
  return "scheduled"
end

local function extractMeta(jobDataJson)
  local pipelineName = "unknown"
  local jobType = "unknown"
  local jobName = "unknown"
  local tenantId = "unknown"
  if jobDataJson and jobDataJson ~= false then
    local ok, data = pcall(cjson.decode, jobDataJson)
    if ok and type(data) == "table" then
      if type(data.__pipelineName) == "string" then pipelineName = data.__pipelineName end
      if type(data.__jobType) == "string" then jobType = data.__jobType end
      if type(data.__jobName) == "string" then jobName = data.__jobName end
      if type(data.tenantId) == "string" then
        tenantId = data.tenantId
      elseif type(data.payload) == "table" and type(data.payload.tenantId) == "string" then
        tenantId = data.payload.tenantId
      elseif type(data.event) == "table" and type(data.event.tenantId) == "string" then
        tenantId = data.event.tenantId
      end
    end
  end
  return pipelineName, jobType, jobName, tenantId
end

-- Lua's unpack blows the stack at ~8000 args; chunk HMGET so a single fat
-- group with thousands of pending jobs cannot crash the script.
local function hmgetChunked(dataKey, jobIds)
  local datas = {}
  local CHUNK = 1000
  for s = 1, #jobIds, CHUNK do
    local chunkArgs = {}
    local lim = math.min(s + CHUNK - 1, #jobIds)
    for k = s, lim do chunkArgs[#chunkArgs + 1] = jobIds[k] end
    local part = redis.call("HMGET", dataKey, unpack(chunkArgs))
    for k = 1, #part do datas[#datas + 1] = part[k] end
  end
  return datas
end
`;

/**
 * Aggregate job state for a chunk of groups.
 *
 * KEYS[1] = blockedKey
 *
 * ARGV[1]      = keyPrefix
 * ARGV[2]      = nowMs
 * ARGV[3]      = sliceN (max items kept for oldest/youngest within this chunk)
 * ARGV[4]      = groupCount
 * ARGV[5..]    = groupIds
 *
 * Returns cjson:
 * {
 *   "totals": { ready, scheduled, retrying, active, blocked, stale, jobs, groupsWithJobs, blockedGroupsScanned, activeGroupsScanned },
 *   "byPipeline": { "<name>": { "jobs": N, "groups": N } },
 *   "byJobType":  { "<name>": N },
 *   "byTenant":   { "<id>": { "jobs": N, "groups": N } },
 *   "byState":    { "ready": N, "scheduled": N, ... },
 *   "oldest":     [ { jobId, groupId, score, pipelineName, jobType, jobName, tenantId, retryCount, state } ],
 *   "youngest":   [ ... ],
 *   "perTenantOverdue": { "<tenantId>": { ...jobSummary } } -- max-overdue job per tenant
 * }
 */
const OVERVIEW_CHUNK_LUA = LUA_PROLOGUE + `
local blockedKey = KEYS[1]

local keyPrefix = ARGV[1]
local nowMs     = tonumber(ARGV[2])
local sliceN    = tonumber(ARGV[3])
local groupCount = tonumber(ARGV[4])

local totals = {
  ready = 0, scheduled = 0, retrying = 0, active = 0, blocked = 0, stale = 0,
  jobs = 0, groupsWithJobs = 0,
  blockedGroupsScanned = 0, activeGroupsScanned = 0,
}
local byPipeline = {}
local byJobType  = {}
local byTenant   = {}
local byState    = { ready = 0, scheduled = 0, retrying = 0, active = 0, blocked = 0, stale = 0 }

-- Pair-key sentinels for group-uniqueness counters. Null-byte separator
-- avoids any plausible collision with real pipeline/tenant/group strings.
local pipelineGroupSeen = {}
local tenantGroupSeen   = {}

local oldest   = {}
local youngest = {}
local perTenantOverdue = {}

local function buildSummary(jobId, groupId, score, pipelineName, jobType, jobName, tenantId, state)
  return {
    jobId = jobId,
    groupId = groupId,
    score = score,
    ageMs = nowMs - score,
    pipelineName = pipelineName,
    jobType = jobType,
    jobName = jobName,
    tenantId = tenantId,
    state = state,
    retryCount = parseRetryCount(jobId),
  }
end

local function insertSorted(arr, summary, ascending)
  local n = #arr
  if n < sliceN then
    arr[n + 1] = summary
  else
    local worst = arr[n]
    if ascending then
      if summary.score >= worst.score then return end
    else
      if summary.score <= worst.score then return end
    end
    arr[n] = summary
  end
  local i = #arr
  while i > 1 do
    local prev = arr[i - 1]
    local cur = arr[i]
    local swap
    if ascending then
      swap = cur.score < prev.score
    else
      swap = cur.score > prev.score
    end
    if not swap then break end
    arr[i] = prev
    arr[i - 1] = cur
    i = i - 1
  end
end

for gIdx = 1, groupCount do
  local groupId = ARGV[4 + gIdx]
  local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
  local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
  local activeKey = keyPrefix .. "group:" .. groupId .. ":active"

  local isBlocked = redis.call("SISMEMBER", blockedKey, groupId) == 1
  local activeJobId = redis.call("GET", activeKey)
  local hasActive = activeJobId ~= false and activeJobId ~= nil

  if isBlocked then totals.blockedGroupsScanned = totals.blockedGroupsScanned + 1 end
  if hasActive then totals.activeGroupsScanned = totals.activeGroupsScanned + 1 end

  local jobsWithScores = redis.call("ZRANGE", jobsKey, 0, -1, "WITHSCORES")
  local groupJobCount = #jobsWithScores / 2

  if groupJobCount > 0 then
    totals.groupsWithJobs = totals.groupsWithJobs + 1
    local jobIds = {}
    for i = 1, #jobsWithScores, 2 do
      jobIds[#jobIds + 1] = jobsWithScores[i]
    end
    local datas = hmgetChunked(dataKey, jobIds)

    for i = 1, #jobIds do
      local jobId = jobIds[i]
      local score = tonumber(jobsWithScores[i * 2])
      local pipelineName, jobType, jobName, tenantId = extractMeta(datas[i])
      local state = classify(jobId, score, isBlocked, nowMs)

      totals.jobs = totals.jobs + 1
      byState[state] = (byState[state] or 0) + 1
      totals[state] = (totals[state] or 0) + 1

      byPipeline[pipelineName] = byPipeline[pipelineName] or { jobs = 0, groups = 0 }
      byPipeline[pipelineName].jobs = byPipeline[pipelineName].jobs + 1
      local pgKey = pipelineName .. "\\0" .. groupId
      if not pipelineGroupSeen[pgKey] then
        pipelineGroupSeen[pgKey] = true
        byPipeline[pipelineName].groups = byPipeline[pipelineName].groups + 1
      end

      byJobType[jobType] = (byJobType[jobType] or 0) + 1

      byTenant[tenantId] = byTenant[tenantId] or { jobs = 0, groups = 0 }
      byTenant[tenantId].jobs = byTenant[tenantId].jobs + 1
      local tgKey = tenantId .. "\\0" .. groupId
      if not tenantGroupSeen[tgKey] then
        tenantGroupSeen[tgKey] = true
        byTenant[tenantId].groups = byTenant[tenantId].groups + 1
      end

      local summary = buildSummary(jobId, groupId, score, pipelineName, jobType, jobName, tenantId, state)
      insertSorted(oldest, summary, true)
      insertSorted(youngest, summary, false)

      if state == "ready" or state == "retrying" then
        local existing = perTenantOverdue[tenantId]
        if existing == nil or summary.score < existing.score then
          perTenantOverdue[tenantId] = summary
        end
      end
    end
  elseif isBlocked and not hasActive then
    totals.stale = totals.stale + 1
    byState.stale = byState.stale + 1
  end
end

return cjson.encode({
  totals = totals,
  byPipeline = byPipeline,
  byJobType = byJobType,
  byTenant = byTenant,
  byState = byState,
  oldest = oldest,
  youngest = youngest,
  perTenantOverdue = perTenantOverdue,
})
`;

/**
 * Filter pending jobs across a chunk of groups.
 *
 * KEYS[1] = blockedKey
 *
 * ARGV[1]      = keyPrefix
 * ARGV[2]      = nowMs
 * ARGV[3]      = filtersJson  -- { pipelineName?, jobType?, tenantId?, state?, groupIdContains?, ageGtMs?, ageLtMs? }
 * ARGV[4]      = maxResults   -- cap matches returned per chunk to avoid oversized replies
 * ARGV[5]      = groupCount
 * ARGV[6..]    = groupIds
 *
 * Returns cjson:
 * {
 *   "matched": [ { ...summary } ],
 *   "matchedCount": N,
 *   "truncated": bool,
 *   "scannedGroups": N
 * }
 */
const SEARCH_CHUNK_LUA = LUA_PROLOGUE + `
local blockedKey = KEYS[1]

local keyPrefix  = ARGV[1]
local nowMs      = tonumber(ARGV[2])
local filtersJson = ARGV[3]
local maxResults = tonumber(ARGV[4])
local groupCount = tonumber(ARGV[5])

local filters = {}
if filtersJson and filtersJson ~= "" then
  local ok, parsed = pcall(cjson.decode, filtersJson)
  if ok and type(parsed) == "table" then filters = parsed end
end

local groupIdNeedle = nil
if type(filters.groupIdContains) == "string" and #filters.groupIdContains > 0 then
  groupIdNeedle = string.lower(filters.groupIdContains)
end

local matched = {}
local matchedCount = 0
local truncated = false
local scannedGroups = 0

for gIdx = 1, groupCount do
  if matchedCount >= maxResults * 4 then
    truncated = true
    break
  end

  local groupId = ARGV[5 + gIdx]
  local skipGroup = groupIdNeedle ~= nil and string.find(string.lower(groupId), groupIdNeedle, 1, true) == nil

  if not skipGroup then
    local jobsKey = keyPrefix .. "group:" .. groupId .. ":jobs"
    local dataKey = keyPrefix .. "group:" .. groupId .. ":data"
    local activeKey = keyPrefix .. "group:" .. groupId .. ":active"

    local isBlocked = redis.call("SISMEMBER", blockedKey, groupId) == 1
    local activeJobId = redis.call("GET", activeKey)
    local hasActive = activeJobId ~= false and activeJobId ~= nil

    local jobsWithScores = redis.call("ZRANGE", jobsKey, 0, -1, "WITHSCORES")
    local groupJobCount = #jobsWithScores / 2

    scannedGroups = scannedGroups + 1

    if groupJobCount > 0 then
      local jobIds = {}
      for i = 1, #jobsWithScores, 2 do
        jobIds[#jobIds + 1] = jobsWithScores[i]
      end
      local datas = hmgetChunked(dataKey, jobIds)

      for i = 1, #jobIds do
        local jobId = jobIds[i]
        local score = tonumber(jobsWithScores[i * 2])
        local pipelineName, jobType, jobName, tenantId = extractMeta(datas[i])
        local state = classify(jobId, score, isBlocked, nowMs)

        local keep = true
        if filters.pipelineName ~= nil and filters.pipelineName ~= "" and pipelineName ~= filters.pipelineName then keep = false end
        if keep and filters.jobType ~= nil and filters.jobType ~= "" and jobType ~= filters.jobType then keep = false end
        if keep and filters.tenantId ~= nil and filters.tenantId ~= "" and tenantId ~= filters.tenantId then keep = false end
        if keep and filters.state ~= nil and filters.state ~= "" and state ~= filters.state then keep = false end
        if keep and filters.ageGtMs ~= nil then
          if (nowMs - score) <= tonumber(filters.ageGtMs) then keep = false end
        end
        if keep and filters.ageLtMs ~= nil then
          if (nowMs - score) >= tonumber(filters.ageLtMs) then keep = false end
        end

        if keep then
          matchedCount = matchedCount + 1
          if #matched < maxResults then
            matched[#matched + 1] = {
              jobId = jobId,
              groupId = groupId,
              score = score,
              ageMs = nowMs - score,
              pipelineName = pipelineName,
              jobType = jobType,
              jobName = jobName,
              tenantId = tenantId,
              state = state,
              retryCount = parseRetryCount(jobId),
            }
          else
            truncated = true
          end
        end
      end
    elseif isBlocked and not hasActive and filters.state == "stale" then
      matchedCount = matchedCount + 1
      if #matched < maxResults then
        matched[#matched + 1] = {
          jobId = "<stale-block>",
          groupId = groupId,
          score = nowMs,
          ageMs = 0,
          pipelineName = "unknown",
          jobType = "unknown",
          jobName = "unknown",
          tenantId = "unknown",
          state = "stale",
          retryCount = cjson.null,
        }
      else
        truncated = true
      end
    end
  end
end

return cjson.encode({
  matched = matched,
  matchedCount = matchedCount,
  truncated = truncated,
  scannedGroups = scannedGroups,
})
`;

/**
 * Read full job data for a single job (for the detail dialog).
 *
 * KEYS[1] = jobsKey
 * KEYS[2] = dataKey
 * KEYS[3] = activeKey
 * KEYS[4] = blockedKey
 * KEYS[5] = errorKey
 *
 * ARGV[1] = groupId
 * ARGV[2] = jobId
 *
 * Returns cjson with score, dataJson, isActive, isBlocked, errorMessage, errorStack, errorTimestamp.
 * Returns "null" if job not found.
 */
const JOB_DETAIL_LUA = `
local jobsKey  = KEYS[1]
local dataKey  = KEYS[2]
local activeKey = KEYS[3]
local blockedKey = KEYS[4]
local errorKey = KEYS[5]

local groupId = ARGV[1]
local jobId   = ARGV[2]

local score = redis.call("ZSCORE", jobsKey, jobId)
local data  = redis.call("HGET", dataKey, jobId)
local active = redis.call("GET", activeKey)
local isBlocked = redis.call("SISMEMBER", blockedKey, groupId) == 1
local errorHash = redis.call("HGETALL", errorKey)

if score == false and (active == false or active == nil or active ~= jobId) then
  return cjson.encode(cjson.null)
end

local err = nil
if #errorHash > 0 then
  err = {}
  for i = 1, #errorHash, 2 do
    err[errorHash[i]] = errorHash[i + 1]
  end
end

return cjson.encode({
  score = (score ~= false) and tonumber(score) or cjson.null,
  data = data or cjson.null,
  isActive = (active == jobId),
  isBlocked = isBlocked,
  error = err,
})
`;

export const AGGREGATOR_SCRIPTS = {
  OVERVIEW_CHUNK_LUA,
  SEARCH_CHUNK_LUA,
  JOB_DETAIL_LUA,
} as const;
