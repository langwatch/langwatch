import { describe, expect, it } from "vitest";

import {
  MemoryQueueDrainAudit,
  type QueueDrainBlocker,
  type QueueDrainRedis,
  RedisQueueDrainAudit,
} from "../drainAudit.ts";
import { GROUP_QUEUE_REGISTRY_KEY } from "../scripts.ts";

const NOW = 1_000_000;
const Q = "{event-sourcing/jobs}";

class FakeRedis implements QueueDrainRedis {
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, string[]>();
  readonly zsets = new Map<string, number[]>();
  readonly hashes = new Map<string, string[]>();

  async smembers(key: string) {
    return this.sets.get(key) ?? [];
  }
  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async zcard(key: string) {
    return (this.zsets.get(key) ?? []).length;
  }
  async zcount(key: string, min: number | string) {
    const floor = Number(String(min).replace("(", ""));
    return (this.zsets.get(key) ?? []).filter((score) => score > floor).length;
  }
  async scard(key: string) {
    return (this.sets.get(key) ?? []).length;
  }
  async hvals(key: string) {
    return this.hashes.get(key) ?? [];
  }
  async scan(_cursor: string, _match: "MATCH", pattern: string): Promise<[string, string[]]> {
    const regex = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    const keys = [
      ...this.strings.keys(),
      ...this.sets.keys(),
      ...this.zsets.keys(),
      ...this.hashes.keys(),
    ];
    return ["0", keys.filter((key) => regex.test(key))];
  }
}

function envelope(e: "s3" | "redis"): string {
  const header = JSON.stringify({ v: 2, e, ref: { tier: e, projectId: "p", hash: "h" } });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

function audit(redis: FakeRedis) {
  return RedisQueueDrainAudit.create({ redis, scanNodes: [redis], now: () => NOW });
}

describe("RedisQueueDrainAudit", () => {
  /** @scenario "Drained queues report no blockers" */
  it("reports nothing when every queue is empty", async () => {
    const redis = new FakeRedis();
    redis.sets.set(GROUP_QUEUE_REGISTRY_KEY, [Q]);
    redis.hashes.set(`${Q}:gq:group:g1:data`, [envelope("redis")]);

    expect(await audit(redis).findBlockers()).toEqual([]);
  });

  /** @scenario "A queue holding work reports each non-empty count" */
  it("reports pending, delayed, active and blocked work without reading payloads", async () => {
    const redis = new FakeRedis();
    redis.sets.set(GROUP_QUEUE_REGISTRY_KEY, [Q]);
    redis.strings.set(`${Q}:gq:stats:total-pending`, "3");
    redis.zsets.set(`${Q}:gq:ready`, [NOW - 1, NOW + 1]);
    redis.strings.set(`${Q}:gq:group:g1:active`, "1");
    redis.sets.set(`${Q}:gq:blocked`, ["g2"]);
    redis.hashes.set(`${Q}:gq:group:g1:data`, [envelope("s3")]);

    expect(await audit(redis).findBlockers()).toEqual([
      { queueName: Q, kind: "pending", count: 3 },
      { queueName: Q, kind: "delayed", count: 1 },
      { queueName: Q, kind: "active", count: 1 },
      { queueName: Q, kind: "blocked", count: 1 },
    ]);
  });

  /** @scenario "Staged payloads referencing the durable store block a quiet queue" */
  it("counts staged s3 references once live work is clear", async () => {
    const redis = new FakeRedis();
    redis.hashes.set(`${Q}:gq:group:g1:data`, [envelope("s3"), envelope("redis"), "GQ2|garbage"]);

    expect(await audit(redis).findBlockers()).toEqual([
      { queueName: Q, kind: "staged-durable-ref", count: 1 },
    ]);
  });

  /** @scenario "Queues missing from the registry are still found by scan" */
  it("audits a queue found only by its ready key", async () => {
    const redis = new FakeRedis();
    redis.zsets.set("legacy:gq:ready", [NOW - 5]);

    expect(await audit(redis).findBlockers()).toEqual([
      { queueName: "legacy", kind: "pending", count: 1 },
    ]);
  });
});

describe("MemoryQueueDrainAudit", () => {
  it("is drained by default and returns the blockers it was given", async () => {
    expect(await MemoryQueueDrainAudit.create().findBlockers()).toEqual([]);
    const blockers: QueueDrainBlocker[] = [{ queueName: Q, kind: "pending", count: 2 }];
    expect(await MemoryQueueDrainAudit.create({ blockers }).findBlockers()).toEqual(blockers);
  });
});
