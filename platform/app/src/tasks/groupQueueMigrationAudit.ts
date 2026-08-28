import {
  GROUP_QUEUE_REGISTRY_KEY,
  isEnvelope,
  readEnvelopeTieredRefFromHeader,
  splitEnvelope,
} from "@langwatch/group-queue/operational";
import type { QueueMigrationBlocker } from "./objectStorageMigration";

/**
 * Small Redis surface used by the one-off migration audit. IORedis implements
 * it directly; keeping the boundary narrow makes the audit independently
 * testable and prevents it from mutating queue state.
 */
export interface QueueAuditRedis {
  smembers(key: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  zcard(key: string): Promise<number>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  scard(key: string): Promise<number>;
  scan(
    cursor: string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number,
  ): Promise<[string, string[]]>;
  hvals(key: string): Promise<string[]>;
}

/**
 * Read-only cutover gate for GroupQueue.
 *
 * Registry membership is supplemented by a bounded SCAN of `*:gq:ready` so
 * queues created by an older release cannot escape the audit. The one-off
 * migration deliberately favors completeness over hot-path cost.
 */
export async function auditGroupQueuesForStorageMigration(
  redis: QueueAuditRedis,
  nowMs = Date.now(),
  scanNodes: QueueAuditRedis[] = [redis],
): Promise<QueueMigrationBlocker[]> {
  const queueNames = await discoverQueueNames(redis, scanNodes);
  const blockers: QueueMigrationBlocker[] = [];
  for (const queueName of queueNames) {
    blockers.push(...(await auditQueue({ redis, scanNodes, queueName, nowMs })));
  }
  return blockers;
}

async function discoverQueueNames(
  redis: QueueAuditRedis,
  scanNodes: QueueAuditRedis[],
): Promise<string[]> {
  const [registered, ready, blocked, active, data] = await Promise.all([
    redis.smembers(GROUP_QUEUE_REGISTRY_KEY),
    scanKeys(scanNodes, "*:gq:ready"),
    scanKeys(scanNodes, "*:gq:blocked"),
    scanKeys(scanNodes, "*:gq:group:*:active"),
    scanKeys(scanNodes, "*:gq:group:*:data"),
  ]);
  const queueNames = new Set(registered);
  for (const key of [...ready, ...blocked, ...active, ...data]) {
    const marker = key.indexOf(":gq:");
    if (marker > 0) queueNames.add(key.slice(0, marker));
  }
  return [...queueNames].sort();
}

async function auditQueue({
  redis,
  scanNodes,
  queueName,
  nowMs,
}: {
  redis: QueueAuditRedis;
  scanNodes: QueueAuditRedis[];
  queueName: string;
  nowMs: number;
}): Promise<QueueMigrationBlocker[]> {
  const prefix = `${queueName}:gq:`;
  const [pending, delayed, active, blocked] = await Promise.all([
    countPending(redis, prefix),
    redis.zcount(`${prefix}ready`, `(${nowMs}`, "+inf"),
    scanKeys(scanNodes, `${prefix}group:*:active`).then((keys) => keys.length),
    redis.scard(`${prefix}blocked`),
  ]);
  const cheapCounts = [
    ["pending", pending],
    ["delayed", delayed],
    ["active", active],
    ["blocked", blocked],
  ] as const;
  const cheapBlockers: QueueMigrationBlocker[] = cheapCounts
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ queueName, kind, count }));
  if (cheapBlockers.length > 0) return cheapBlockers;

  // Only inspect staged payloads after the cheap state gates are clear. A
  // large live backlog is already a definitive blocker; fetching every hash
  // value in that case adds avoidable Redis traffic and migration-task heap.
  const durableRefs = await countDurableRefs(redis, scanNodes, prefix);
  return durableRefs > 0
    ? [
        {
          queueName,
          kind: "staged-durable-ref",
          count: durableRefs,
        },
      ]
    : [];
}

async function countPending(redis: QueueAuditRedis, prefix: string): Promise<number> {
  const [totalPendingValue, readyCount] = await Promise.all([
    redis.get(`${prefix}stats:total-pending`),
    redis.zcard(`${prefix}ready`),
  ]);
  const totalPending = Number(totalPendingValue);
  return Number.isFinite(totalPending) ? Math.max(totalPending, readyCount) : readyCount;
}

async function countDurableRefs(
  redis: QueueAuditRedis,
  scanNodes: QueueAuditRedis[],
  prefix: string,
): Promise<number> {
  const dataKeys = await scanKeys(scanNodes, `${prefix}group:*:data`);
  let count = 0;
  for (const key of dataKeys) {
    count += (await redis.hvals(key)).filter(hasS3DurableReference).length;
  }
  return count;
}

function hasS3DurableReference(value: string): boolean {
  if (!isEnvelope(value)) return false;
  try {
    return readEnvelopeTieredRefFromHeader(splitEnvelope(value).header)?.tier === "s3";
  } catch {
    // Malformed staged values remain blocked by pending/blocked queue state.
    return false;
  }
}

async function scanKeys(
  scanNodes: QueueAuditRedis[],
  pattern: string,
): Promise<string[]> {
  const results = await Promise.all(
    scanNodes.map((target) => scanSingleNode(target, pattern)),
  );
  return [...new Set(results.flat())];
}

async function scanSingleNode(
  redis: QueueAuditRedis,
  pattern: string,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return keys;
}
