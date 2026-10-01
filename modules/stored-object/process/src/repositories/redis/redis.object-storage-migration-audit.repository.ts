import {
  GROUP_QUEUE_REGISTRY_KEY,
  isEnvelope,
  readEnvelopeTieredRefFromHeader,
  splitEnvelope,
} from "@langwatch/group-queue/operational";
import {
  RedisConnectionService,
  type RedisConnection,
  type RedisLogger,
} from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";
import { Cluster } from "ioredis";

import type { QueueMigrationBlocker } from "#services/object-storage-migration.service";

/**
 * Small Redis surface used by the one-off migration audit. IORedis implements
 * it directly; keeping the boundary narrow makes the audit independently
 * testable and prevents it from mutating queue state.
 */
export interface QueueAuditRedis {
  smembers(key: string): Promise<string[]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
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

export type MigrationCutoverRedisConfig = {
  url?: string;
  clusterEndpoints?: string;
  dbIndex?: string;
};

type MigrationCutoverAuditLease = {
  redis: QueueAuditRedis;
  scanNodes: QueueAuditRedis[];
  cleanup(): void;
};

type MigrationCutoverAuditLeaseFactory = (
  connection: RedisConnection,
  logger: RedisLogger,
) => Promise<MigrationCutoverAuditLease>;

/** Task-local Redis owner for the final GroupQueue cutover audit. */
export class MigrationCutoverAuditRedisRepository {
  /**
   * The shared app cluster client runs `scaleReads: "all"`, allowing reads from a
   * lagging replica. Finalization must instead audit through a master-only
   * duplicate so a stale replica cannot report a false clean cutover.
   */
  static async createAuditLease(
    sharedConnection: RedisConnection,
    logger?: RedisLogger,
  ): Promise<MigrationCutoverAuditLease> {
    if (!(sharedConnection instanceof Cluster)) {
      return {
        redis: sharedConnection,
        scanNodes: [sharedConnection],
        cleanup: () => void 0,
      };
    }

    const masterOnly = sharedConnection.duplicate([], { scaleReads: "master" });
    if (masterOnly.status !== "ready") {
      try {
        await waitForClusterReady(masterOnly);
      } catch (error) {
        try {
          masterOnly.disconnect();
        } catch (cleanupError) {
          logger?.error(
            { error: cleanupError },
            "failed to close cutover-audit Redis duplicate after handshake failure",
          );
        }
        throw error;
      }
    }

    return {
      redis: masterOnly,
      scanNodes: masterOnly.nodes("master"),
      cleanup: () => masterOnly.disconnect(),
    };
  }

  static create(input: {
    config: MigrationCutoverRedisConfig;
    logger: RedisLogger;
    createLease?: MigrationCutoverAuditLeaseFactory;
  }): MigrationCutoverAuditRedisRepository {
    return new MigrationCutoverAuditRedisRepository(
      input.config,
      input.logger,
      // Wrapped rather than passed bare: a bare static-method reference trips
      // `typescript/unbound-method` even though `createAuditLease` never
      // reads `this`.
      input.createLease ??
        ((...args: Parameters<typeof MigrationCutoverAuditRedisRepository.createAuditLease>) =>
          MigrationCutoverAuditRedisRepository.createAuditLease(...args)),
    );
  }

  private constructor(
    private readonly config: MigrationCutoverRedisConfig,
    private readonly logger: RedisLogger,
    private readonly createLease: MigrationCutoverAuditLeaseFactory,
  ) {}

  /** Read-only cutover gate: every GroupQueue state that can still hold source-provider work. */
  static async auditQueues({
    redis,
    nowMs = nowInstant().epochMilliseconds,
    scanNodes = [redis],
  }: {
    redis: QueueAuditRedis;
    nowMs?: number;
    scanNodes?: QueueAuditRedis[];
  }): Promise<QueueMigrationBlocker[]> {
    const queueNames = await discoverQueueNames(redis, scanNodes);
    const blockers: QueueMigrationBlocker[] = [];
    for (const queueName of queueNames) {
      blockers.push(...(await auditQueue({ redis, scanNodes, queueName, nowMs })));
    }
    return blockers;
  }

  async audit(): Promise<QueueMigrationBlocker[]> {
    const connection = new RedisConnectionService({ logger: this.logger }).connect(this.config);
    if (!connection) {
      throw new Error("Redis is required to audit GroupQueue before migration finalization");
    }

    let audit: MigrationCutoverAuditLease | undefined;
    let blockers: QueueMigrationBlocker[];
    try {
      audit = await this.createLease(connection, this.logger);
      blockers = await MigrationCutoverAuditRedisRepository.auditQueues({
        redis: audit.redis,
        scanNodes: audit.scanNodes,
      });
    } catch (error) {
      this.close({ audit, connection });
      throw error;
    }
    const [firstCloseFailure] = this.close({ audit, connection });
    if (firstCloseFailure !== undefined) throw firstCloseFailure;
    return blockers;
  }

  /** Closes the lease and the connection, logging each failure and answering them in order. */
  private close({
    audit,
    connection,
  }: {
    audit: MigrationCutoverAuditLease | undefined;
    connection: RedisConnection;
  }): unknown[] {
    const failures: unknown[] = [];
    try {
      audit?.cleanup();
    } catch (error) {
      failures.push(error);
      this.logger.error({ error }, "failed to close cutover-audit Redis duplicate");
    }
    try {
      connection.disconnect();
    } catch (error) {
      failures.push(error);
      this.logger.error({ error }, "failed to close cutover-audit Redis connection");
    }
    return failures;
  }
}

const CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS = 30_000;

function waitForClusterReady(cluster: Cluster): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out after ${CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS}ms waiting for the cutover-audit Redis connection to become ready`,
        ),
      );
    }, CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS);
    const settle = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    cluster.once("ready", () => settle());
    cluster.once("error", (error: Error) => settle(error));
  });
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
  return [...queueNames].toSorted();
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
  const [[totalPendingValue], readyCount] = await Promise.all([
    redis.mget(`${prefix}stats:total-pending`),
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

async function scanKeys(scanNodes: QueueAuditRedis[], pattern: string): Promise<string[]> {
  const results = await Promise.all(scanNodes.map((target) => scanSingleNode(target, pattern)));
  return [...new Set(results.flat())];
}

async function scanSingleNode(redis: QueueAuditRedis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return keys;
}
