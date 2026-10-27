import { nowInstant } from "@langwatch/time";
import { Cluster } from "ioredis";

import type { GroupQueueRedis } from "./dependencies-adapter.ts";
import { isEnvelope, readEnvelopeTieredRefFromHeader, splitEnvelope } from "./jobEnvelope.ts";
import { GROUP_QUEUE_REGISTRY_KEY } from "./scripts.ts";

export type QueueDrainBlocker = Readonly<{
  queueName: string;
  kind: "pending" | "delayed" | "active" | "blocked" | "staged-durable-ref";
  count: number;
}>;

/** Which queues still hold work; empty means every queue is drained. */
export interface QueueDrainAudit {
  findBlockers(): Promise<QueueDrainBlocker[]>;
}

/** The read-only Redis surface the audit needs; ioredis satisfies it. */
export interface QueueDrainRedis {
  smembers(key: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  zcard(key: string): Promise<number>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  scard(key: string): Promise<number>;
  hvals(key: string): Promise<string[]>;
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    limit: number,
  ): Promise<[string, string[]]>;
}

/** Memory stacks hold no Redis queues: drained unless a test says otherwise. */
export class MemoryQueueDrainAudit implements QueueDrainAudit {
  static create({
    blockers = [],
  }: { blockers?: readonly QueueDrainBlocker[] } = {}): MemoryQueueDrainAudit {
    return new MemoryQueueDrainAudit(blockers);
  }

  private constructor(private readonly blockers: readonly QueueDrainBlocker[]) {}

  async findBlockers(): Promise<QueueDrainBlocker[]> {
    return [...this.blockers];
  }
}

/**
 * Main's groupQueueMigrationAudit: registry plus a SCAN of every master, so
 * queues an older release created cannot escape. Staged payloads are read
 * only once a queue's cheap counts are all zero.
 */
export class RedisQueueDrainAudit implements QueueDrainAudit {
  static create({
    redis,
    scanNodes,
    now = () => nowInstant().epochMilliseconds,
  }: {
    redis: QueueDrainRedis;
    scanNodes: readonly QueueDrainRedis[];
    now?: () => number;
  }): RedisQueueDrainAudit {
    return new RedisQueueDrainAudit(redis, scanNodes, now);
  }

  /** Scans each cluster master; a standalone client is its own only node. */
  static forConnection({ redis }: { redis: GroupQueueRedis }): RedisQueueDrainAudit {
    const scanNodes = redis instanceof Cluster ? redis.nodes("master") : [redis];
    return RedisQueueDrainAudit.create({ redis, scanNodes });
  }

  private constructor(
    private readonly redis: QueueDrainRedis,
    private readonly scanNodes: readonly QueueDrainRedis[],
    private readonly now: () => number,
  ) {}

  async findBlockers(): Promise<QueueDrainBlocker[]> {
    const blockers: QueueDrainBlocker[] = [];
    for (const queueName of await this.queueNames()) {
      blockers.push(...(await this.auditQueue({ queueName, nowMs: this.now() })));
    }
    return blockers;
  }

  private async queueNames(): Promise<string[]> {
    const [registered, ...scanned] = await Promise.all([
      this.redis.smembers(GROUP_QUEUE_REGISTRY_KEY),
      this.scanKeys("*:gq:ready"),
      this.scanKeys("*:gq:blocked"),
      this.scanKeys("*:gq:group:*:active"),
      this.scanKeys("*:gq:group:*:data"),
    ]);
    const names = new Set(registered);
    for (const key of scanned.flat()) {
      const marker = key.indexOf(":gq:");
      if (marker > 0) names.add(key.slice(0, marker));
    }
    return [...names].toSorted();
  }

  private async auditQueue({
    queueName,
    nowMs,
  }: {
    queueName: string;
    nowMs: number;
  }): Promise<QueueDrainBlocker[]> {
    const prefix = `${queueName}:gq:`;
    const [pending, delayed, active, blocked] = await Promise.all([
      this.countPending(prefix),
      this.redis.zcount(`${prefix}ready`, `(${nowMs}`, "+inf"),
      this.scanKeys(`${prefix}group:*:active`).then((keys) => keys.length),
      this.redis.scard(`${prefix}blocked`),
    ]);
    const counts: readonly (readonly [QueueDrainBlocker["kind"], number])[] = [
      ["pending", pending],
      ["delayed", delayed],
      ["active", active],
      ["blocked", blocked],
    ];
    const live = counts
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => ({ queueName, kind, count }));
    if (live.length > 0) return live;

    let durableRefs = 0;
    for (const key of await this.scanKeys(`${prefix}group:*:data`)) {
      durableRefs += (await this.redis.hvals(key)).filter(holdsS3Reference).length;
    }
    return durableRefs > 0 ? [{ queueName, kind: "staged-durable-ref", count: durableRefs }] : [];
  }

  private async countPending(prefix: string): Promise<number> {
    const [totalPending, ready] = await Promise.all([
      this.redis.get(`${prefix}stats:total-pending`),
      this.redis.zcard(`${prefix}ready`),
    ]);
    const total = Number(totalPending);
    return Number.isFinite(total) ? Math.max(total, ready) : ready;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const perNode = await Promise.all(
      this.scanNodes.map(async (node) => {
        const keys: string[] = [];
        let cursor = "0";
        do {
          const [next, batch] = await node.scan(cursor, "MATCH", pattern, "COUNT", 500);
          keys.push(...batch);
          cursor = next;
        } while (cursor !== "0");
        return keys;
      }),
    );
    return [...new Set(perNode.flat())];
  }
}

function holdsS3Reference(value: string): boolean {
  if (!isEnvelope(value)) return false;
  try {
    return readEnvelopeTieredRefFromHeader(splitEnvelope(value).header)?.tier === "s3";
  } catch {
    // Malformed staged values stay blocked by the queue's pending state.
    return false;
  }
}
