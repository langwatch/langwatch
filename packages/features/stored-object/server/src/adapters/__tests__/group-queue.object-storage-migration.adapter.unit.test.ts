/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  auditGroupQueuesForStorageMigration,
  type QueueAuditRedis,
} from "../group-queue.object-storage-migration.adapter";

class AuditRedis implements QueueAuditRedis {
  readonly sets = new Map<string, string[]>();
  readonly strings = new Map<string, string>();
  readonly zcards = new Map<string, number>();
  readonly zcounts = new Map<string, number>();
  readonly hashes = new Map<string, string[]>();
  readonly keys = new Set<string>();
  hvalsCalls = 0;

  async smembers(key: string): Promise<string[]> {
    return this.sets.get(key) ?? [];
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async zcard(key: string): Promise<number> {
    return this.zcards.get(key) ?? 0;
  }

  async zcount(key: string, _min: number | string, _max: number | string): Promise<number> {
    return this.zcounts.get(key) ?? 0;
  }

  async scard(key: string): Promise<number> {
    return (this.sets.get(key) ?? []).length;
  }

  async scan(_cursor: string, _match: string, pattern: string): Promise<[string, string[]]> {
    const expression = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    );
    return ["0", [...this.keys].filter((key) => expression.test(key))];
  }

  async hvals(key: string): Promise<string[]> {
    this.hvalsCalls += 1;
    return this.hashes.get(key) ?? [];
  }
}

class AuditCluster extends AuditRedis {
  constructor(private readonly masters: AuditRedis[]) {
    super();
  }

  override async smembers(key: string): Promise<string[]> {
    return (await Promise.all(this.masters.map((master) => master.smembers(key)))).flat();
  }

  override async get(key: string): Promise<string | null> {
    for (const master of this.masters) {
      const value = await master.get(key);
      if (value != null) return value;
    }
    return null;
  }

  override async zcard(key: string): Promise<number> {
    return sum(await Promise.all(this.masters.map((master) => master.zcard(key))));
  }

  override async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    return sum(await Promise.all(this.masters.map((master) => master.zcount(key, min, max))));
  }

  override async scard(key: string): Promise<number> {
    return sum(await Promise.all(this.masters.map((master) => master.scard(key))));
  }

  override async hvals(key: string): Promise<string[]> {
    return (await Promise.all(this.masters.map((master) => master.hvals(key)))).flat();
  }
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

describe("auditGroupQueuesForStorageMigration", () => {
  it("finds every queue state that can retain source-provider work", async () => {
    const redis = new AuditRedis();
    redis.sets.set("{gq-registry}:names", ["events"]);
    redis.strings.set("events:gq:stats:total-pending", "3");
    redis.zcounts.set("events:gq:ready", 1);
    redis.sets.set("events:gq:blocked", ["tenant/group"]);
    redis.keys.add("events:gq:group:tenant/group:active");
    redis.keys.add("events:gq:group:tenant/group:data");
    const header = JSON.stringify({
      v: 2,
      e: "s3",
      ref: { tier: "s3", projectId: "project-1", hash: "abc" },
    });
    redis.hashes.set("events:gq:group:tenant/group:data", [
      `GQ2|${Buffer.byteLength(header)}|${header}`,
    ]);

    const blockers = await auditGroupQueuesForStorageMigration(redis, 100);

    expect(blockers).toEqual([
      { queueName: "events", kind: "pending", count: 3 },
      { queueName: "events", kind: "delayed", count: 1 },
      { queueName: "events", kind: "active", count: 1 },
      { queueName: "events", kind: "blocked", count: 1 },
    ]);
    expect(redis.hvalsCalls).toBe(0);
  });

  it("finds an orphan staged durable reference after cheap gates are clear", async () => {
    const redis = new AuditRedis();
    redis.sets.set("{gq-registry}:names", ["events"]);
    redis.keys.add("events:gq:group:tenant/group:data");
    const header = JSON.stringify({
      v: 2,
      e: "s3",
      ref: { tier: "s3", projectId: "project-1", hash: "abc" },
    });
    redis.hashes.set("events:gq:group:tenant/group:data", [
      `GQ2|${Buffer.byteLength(header)}|${header}`,
    ]);

    const blockers = await auditGroupQueuesForStorageMigration(redis);

    expect(blockers).toEqual([
      {
        queueName: "events",
        kind: "staged-durable-ref",
        count: 1,
      },
    ]);
    expect(redis.hvalsCalls).toBe(1);
  });

  it("discovers legacy unregistered queues without changing Redis", async () => {
    const redis = new AuditRedis();
    redis.keys.add("legacy:gq:ready");
    redis.zcards.set("legacy:gq:ready", 2);
    redis.keys.add("blocked-only:gq:blocked");
    redis.sets.set("blocked-only:gq:blocked", ["tenant/group"]);

    const blockers = await auditGroupQueuesForStorageMigration(redis);

    expect(blockers).toEqual([
      { queueName: "blocked-only", kind: "blocked", count: 1 },
      { queueName: "legacy", kind: "pending", count: 2 },
    ]);
  });

  it("scans every Redis Cluster master for unregistered legacy queues", async () => {
    const firstMaster = new AuditRedis();
    const secondMaster = new AuditRedis();
    secondMaster.keys.add("other-shard:gq:blocked");
    secondMaster.sets.set("other-shard:gq:blocked", ["tenant/group"]);
    const cluster = new AuditCluster([firstMaster, secondMaster]);

    const blockers = await auditGroupQueuesForStorageMigration(cluster, Date.now(), [
      firstMaster,
      secondMaster,
    ]);

    expect(blockers).toEqual([{ queueName: "other-shard", kind: "blocked", count: 1 }]);
  });
});
