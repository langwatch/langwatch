import type { Cluster, Redis as IORedis } from "ioredis";

import { CachedLuaScript } from "./cachedLuaScript.ts";
import { GROUP_KEY_TTL_MS } from "./scripts.ts";

/** A tenant's claimed group ids (ADR-092): the set `<queue>:gq:tenant-claims:<tenant>`. */
function tenantClaimsKey({ queueName, tenantId }: { queueName: string; tenantId: string }): string {
  return `${queueName}:gq:tenant-claims:${tenantId}`;
}

/** Members under the prefix with a live active key or claimed record; the rest leave the set. */
const READ_TENANT_CLAIMS_LUA = `
local indexKey = KEYS[1]
local keyPrefix = ARGV[1]
local groupIdPrefix = ARGV[2]
local live = {}
for _, groupId in ipairs(redis.call("SMEMBERS", indexKey)) do
  local base = keyPrefix .. "group:" .. groupId
  if redis.call("EXISTS", base .. ":active", base .. ":claimed") == 0 then
    redis.call("SREM", indexKey, groupId)
  elseif string.sub(groupId, 1, #groupIdPrefix) == groupIdPrefix then
    live[#live + 1] = groupId
  end
end
return live
`;

/** Adds each group to its tenant's set; the same key shape the claim script writes. */
const ADD_TENANT_CLAIMS_LUA = `
local keyPrefix = ARGV[1]
for i = 2, #ARGV do
  local groupId = ARGV[i]
  local slashPos = string.find(groupId, "/", 1, true)
  if slashPos and slashPos > 1 then
    local indexKey = keyPrefix .. "tenant-claims:" .. string.sub(groupId, 1, slashPos - 1)
    redis.call("SADD", indexKey, groupId)
    redis.call("PEXPIRE", indexKey, ${GROUP_KEY_TTL_MS})
  end
end
return #ARGV - 1
`;

const readScript = new CachedLuaScript(READ_TENANT_CLAIMS_LUA);
const addScript = new CachedLuaScript(ADD_TENANT_CLAIMS_LUA);

/** The tenant's groups under `groupIdPrefix` that still hold an active key or a claimed record. */
export async function readTenantClaimedGroups({
  redis,
  queueName,
  tenantId,
  groupIdPrefix,
}: {
  redis: IORedis | Cluster;
  queueName: string;
  tenantId: string;
  groupIdPrefix: string;
}): Promise<string[]> {
  const live = await readScript.run(
    redis,
    1,
    tenantClaimsKey({ queueName, tenantId }),
    `${queueName}:gq:`,
    groupIdPrefix,
  );
  return (live as string[]).toSorted();
}

const ACTIVE_SUFFIX = ":active";
const CLAIMED_SUFFIX = ":claimed";
const BACKFILL_SCAN_COUNT = 500;

/**
 * One paced slice of the one-time walk that lists claims made before the index existed: at most
 * `maxScanCalls` SCAN pages from `cursor`; "0" back means the walk is done (ADR-092 §6).
 */
export async function backfillTenantClaims({
  redis,
  queueName,
  cursor,
  maxScanCalls,
}: {
  redis: IORedis;
  queueName: string;
  cursor: string;
  maxScanCalls: number;
}): Promise<{ cursor: string; listed: number }> {
  const groupKeyPrefix = `${queueName}:gq:group:`;
  let next = cursor;
  let listed = 0;
  for (let calls = 0; calls < maxScanCalls; calls += 1) {
    // The one keyspace walk ADR-092 allows: paced, resumable, run once by its ops fill step.
    const [after, keys] = await redis.scan(
      next,
      "MATCH",
      `${groupKeyPrefix}*`,
      "COUNT",
      BACKFILL_SCAN_COUNT,
    );
    next = after;
    const groupIds = keys.flatMap((key) => groupIdOf({ key, groupKeyPrefix }));
    if (groupIds.length > 0) {
      await addScript.run(redis, 0, `${queueName}:gq:`, ...groupIds);
      listed += groupIds.length;
    }
    if (next === "0") break;
  }
  return { cursor: next, listed };
}

function groupIdOf({ key, groupKeyPrefix }: { key: string; groupKeyPrefix: string }): string[] {
  for (const suffix of [ACTIVE_SUFFIX, CLAIMED_SUFFIX]) {
    if (key.endsWith(suffix)) return [key.slice(groupKeyPrefix.length, -suffix.length)];
  }
  return [];
}
