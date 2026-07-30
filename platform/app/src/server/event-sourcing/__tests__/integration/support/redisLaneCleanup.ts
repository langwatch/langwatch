import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { LANE_REGISTRY_KEY, laneKeys } from "@langwatch/groupqueue";
import type { Redis } from "ioredis";

/** Deletes one lane's sorted set, hash, body, sequence, lease, ready and
 * parked keys, then drops it from the shared lane registry. */
export async function cleanupLane(redis: Redis, key: GroupKey): Promise<void> {
  const groupKey = renderGroupKey(key);
  const keys = laneKeys(groupKey);
  await redis.del(
    keys.z,
    keys.h,
    keys.b,
    keys.seq,
    keys.lease,
    keys.ready,
    keys.parked,
  );
  await redis.srem(LANE_REGISTRY_KEY, groupKey);
}
