/**
 * One script per verb (ADR-108 decision 4). Job headers are never round-
 * tripped through `cjson` here: Redis's bundled cjson encodes an empty Lua
 * table as `{}`, which would silently turn a header's `scopeParts: []` (every
 * non-partition scope) into an object on the way back out. Headers are built
 * once in JS (where `JSON.stringify` has no such ambiguity) and touched in
 * Lua only by string surgery on their known trailing fields.
 */

/** KEYS: z, h, b, seq. ARGV[1]: JSON array of [orderingKey, headerJson, body]
 * triples, headerJson missing `sequence`/`attempt`. Returns the assigned
 * sequences, one per input job, in order. */
export const STAGE_LUA = `
local jobs = cjson.decode(ARGV[1])
local seqs = {}
for i = 1, #jobs do
  local orderingKey = jobs[i][1]
  local headerJson = jobs[i][2]
  local body = jobs[i][3]
  local seq = redis.call("INCR", KEYS[4])
  local member = string.format("%020d", seq)
  redis.call("ZADD", KEYS[1], orderingKey, member)
  local stored = string.sub(headerJson, 1, -2) .. ',"sequence":' .. seq .. ',"attempt":0}'
  redis.call("HSET", KEYS[2], member, stored)
  redis.call("HSET", KEYS[3], member, body)
  seqs[i] = seq
end
return seqs
`;

/** KEYS: z, h, b, lease, ready, parked. ARGV: nowMs, maxJobs, maxBytes,
 * leaseMs, token. Returns false when the lane is parked, actively leased,
 * still backing off, or empty; otherwise a flat [header, body, header,
 * body, ...] array for the claimed jobs, which are left in `z`/`h`/`b` until
 * settle — an expired lease simply becomes claimable again, attempt intact. */
export const TRY_CLAIM_LUA = `
if redis.call("EXISTS", KEYS[6]) == 1 then return false end
local now = tonumber(ARGV[1])
local expiresAt = tonumber(redis.call("HGET", KEYS[4], "expiresAt") or "0")
if expiresAt > now then return false end
local readyAt = tonumber(redis.call("GET", KEYS[5]) or "0")
if readyAt > now then return false end
local members = redis.call("ZRANGE", KEYS[1], 0, -1)
if #members == 0 then return false end
local maxJobs = tonumber(ARGV[2])
local maxBytes = tonumber(ARGV[3])
local chosen = {}
local bytes = 0
for i = 1, #members do
  if #chosen >= maxJobs then break end
  local member = members[i]
  local headerJson = redis.call("HGET", KEYS[2], member)
  if headerJson then
    local m = string.match(headerJson, '"costBytes":(%d+)')
    local cost = m and tonumber(m) or 0
    if #chosen > 0 and (bytes + cost) > maxBytes then break end
    bytes = bytes + cost
    chosen[#chosen + 1] = member
  end
end
if #chosen == 0 then return false end
redis.call("HSET", KEYS[4], "token", ARGV[5], "expiresAt", tostring(now + tonumber(ARGV[4])))
redis.call("HSET", KEYS[4], "seqs", cjson.encode(chosen))
local result = {}
for i = 1, #chosen do
  result[#result + 1] = redis.call("HGET", KEYS[2], chosen[i])
  result[#result + 1] = redis.call("HGET", KEYS[3], chosen[i])
end
return result
`;

/** KEYS: z, h, b, lease. ARGV[1]: token. A settle whose token no longer
 * matches (the lease already expired and was reclaimed by another caller) is
 * a no-op, not an error — the late caller lost the race, nothing to undo. */
export const SETTLE_LUA = `
local token = redis.call("HGET", KEYS[4], "token")
if token ~= ARGV[1] then return 0 end
local seqsJson = redis.call("HGET", KEYS[4], "seqs")
if seqsJson then
  local seqs = cjson.decode(seqsJson)
  for i = 1, #seqs do
    redis.call("ZREM", KEYS[1], seqs[i])
    redis.call("HDEL", KEYS[2], seqs[i])
    redis.call("HDEL", KEYS[3], seqs[i])
  end
end
redis.call("DEL", KEYS[4])
return 1
`;

/** KEYS: h, lease, ready. ARGV: token, afterMs, nowMs. Jobs stay in `z`; only
 * the lane's ready-at moves and each claimed header's `attempt` advances by
 * one — the trailing field STAGE_LUA always appends last, so it is found and
 * replaced by pattern rather than a full decode/encode. */
export const RETRY_LUA = `
local token = redis.call("HGET", KEYS[2], "token")
if token ~= ARGV[1] then return 0 end
local seqsJson = redis.call("HGET", KEYS[2], "seqs")
if seqsJson then
  local seqs = cjson.decode(seqsJson)
  for i = 1, #seqs do
    local member = seqs[i]
    local headerJson = redis.call("HGET", KEYS[1], member)
    if headerJson then
      local attempt = tonumber(string.match(headerJson, '"attempt":(%d+)}$')) or 0
      local updated = string.gsub(headerJson, '"attempt":%d+}$', '"attempt":' .. (attempt + 1) .. '}')
      redis.call("HSET", KEYS[1], member, updated)
    end
  end
end
redis.call("SET", KEYS[3], tostring(tonumber(ARGV[3]) + tonumber(ARGV[2])))
redis.call("DEL", KEYS[2])
return 1
`;

/** KEYS: lease, parked. ARGV: token, reason. Jobs stay staged for operator
 * inspection or replay; only this lane stops being claimable. */
export const PARK_LUA = `
local token = redis.call("HGET", KEYS[1], "token")
if token ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2])
redis.call("DEL", KEYS[1])
return 1
`;

/** KEYS: meta, data. ARGV: tier ("redis"|"durable"), body (only used for the
 * "redis" tier), backstopSeconds. Content-addressing means a second `put` for
 * identical bytes is a second holder, not a second write: refcount above one
 * skips re-storing but still re-arms the backstop. */
export const BLOB_PUT_LUA = `
local refcount = redis.call("HINCRBY", KEYS[1], "refcount", 1)
if refcount == 1 then
  redis.call("HSET", KEYS[1], "tier", ARGV[1])
  if ARGV[1] == "redis" then
    redis.call("SET", KEYS[2], ARGV[2])
  end
end
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
if ARGV[1] == "redis" then
  redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
end
return refcount
`;

/** KEYS: meta, data. ARGV: graceSeconds. A holder count still above zero
 * leaves both keys' TTLs untouched — refused deletion while still leased.
 * Reaching zero shortens the backstop to the grace window instead of
 * deleting outright, so a `put` racing a `release` for the same content is
 * never left with a blob one round trip could have kept alive. */
export const BLOB_RELEASE_LUA = `
local refcount = redis.call("HINCRBY", KEYS[1], "refcount", -1)
if refcount <= 0 then
  local tier = redis.call("HGET", KEYS[1], "tier")
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
  if tier == "redis" then
    redis.call("EXPIRE", KEYS[2], tonumber(ARGV[1]))
  end
end
return refcount
`;
