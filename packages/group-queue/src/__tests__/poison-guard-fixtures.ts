import type { Cluster, Redis } from "ioredis";
import { CLAIM_MARKER_TTL_SECONDS, DEFAULT_CONFIRMED_DEATH_THRESHOLD } from "../scripts";

/**
 * Shared poison-guard fixtures.
 *
 * Both integration suites drive the guard through the same Redis keys, so the
 * key layout and the seeded shape live here rather than being written twice.
 * A fixture that drifts from `CLAIM_GUARD_LUA` stops testing the thing it names.
 */

export const claimKey = (queueName: string, groupId: string): string =>
  `${queueName}:gq:group:${groupId}:claim`;

export const beaconKey = (queueName: string, workerId: string): string =>
  `${queueName}:gq:worker:${workerId}`;

/**
 * Leave behind the marker of a worker that claimed this group and then died —
 * no liveness beacon, no retirement tombstone.
 *
 * Written with the same TTL the real claim path applies, so a seeded marker
 * ages out of the test Redis exactly as production would rather than
 * accumulating, and so a suite can never accidentally depend on a marker that
 * only persists because the fixture forgot to expire it.
 *
 * `deaths` defaults to one short of the threshold, so the claim under test
 * observes the last death and parks.
 */
export async function seedDeadOwner({
  redis,
  queueName,
  groupId,
  deaths = DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1,
}: {
  redis: Redis | Cluster;
  queueName: string;
  groupId: string;
  deaths?: number;
}): Promise<void> {
  const key = claimKey(queueName, groupId);
  await redis.hset(key, {
    owner: `dead-worker-${crypto.randomUUID().slice(0, 8)}`,
    deaths: String(deaths),
    stagedJobId: "staged-from-the-dead-claim",
  });
  await redis.expire(key, CLAIM_MARKER_TTL_SECONDS);
}

/** Confirmed worker deaths recorded against a group. */
export async function confirmedDeaths({
  redis,
  queueName,
  groupId,
}: {
  redis: Redis | Cluster;
  queueName: string;
  groupId: string;
}): Promise<string | null> {
  return await redis.hget(claimKey(queueName, groupId), "deaths");
}
