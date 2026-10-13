import type { Cluster, Redis } from "ioredis";

import { CLAIM_MARKER_TTL_SECONDS, DEFAULT_CONFIRMED_DEATH_THRESHOLD } from "../scripts.ts";

/**
 * Shared poison-guard fixtures: both integration suites drive the guard
 * through the same Redis keys, so the layout lives here once. A fixture
 * that drifts from `CLAIM_GUARD_LUA` stops testing the thing it names.
 */

export const claimKey = (queueName: string, groupId: string): string =>
  `${queueName}:gq:group:${groupId}:claim`;

export const beaconKey = (queueName: string, workerId: string): string =>
  `${queueName}:gq:worker:${workerId}`;

/**
 * Seed a dead worker marker with production TTL and defaults that park the claim
 * under test after one death.
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
  return redis.hget(claimKey(queueName, groupId), "deaths");
}
