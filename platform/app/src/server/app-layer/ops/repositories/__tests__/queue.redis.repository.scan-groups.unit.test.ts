import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { QueueRedisRepository } from "../queue.redis.repository";

const QUEUE_NAME = "test-queue";
const PREFIX = `${QUEUE_NAME}:gq:`;

/**
 * Minimal in-memory stand-in for the Redis commands a group scan issues.
 * Zsets are held sorted ascending by score, mirroring Redis ordering, so
 * zrange/zrevrange return genuinely opposite ends.
 */
class FakeRedis {
  readonly strings = new Map<string, string>();
  readonly zsets = new Map<string, Array<{ member: string; score: number }>>();
  readonly sets = new Map<string, string[]>();
  readonly hashes = new Map<string, Map<string, string>>();

  private sorted(key: string) {
    return [...(this.zsets.get(key) ?? [])].sort((a, b) => a.score - b.score);
  }

  private static flat(
    entries: Array<{ member: string; score: number }>,
    withScores: boolean,
  ): string[] {
    return entries.flatMap((e) =>
      withScores ? [e.member, String(e.score)] : [e.member],
    );
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.length ?? 0;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.length ?? 0;
  }

  async smembers(key: string): Promise<string[]> {
    return this.sets.get(key) ?? [];
  }

  async srandmember(key: string, count: number): Promise<string[]> {
    return (this.sets.get(key) ?? []).slice(0, count);
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async ttl(_key: string): Promise<number> {
    return -2;
  }

  async sismember(key: string, member: string): Promise<number> {
    return (this.sets.get(key) ?? []).includes(member) ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores?: string,
  ): Promise<string[]> {
    const entries = this.sorted(key);
    const end = stop === -1 ? entries.length - 1 : stop;
    return FakeRedis.flat(
      entries.slice(start, end + 1),
      withScores === "WITHSCORES",
    );
  }

  async zrevrange(
    key: string,
    start: number,
    stop: number,
    withScores?: string,
  ): Promise<string[]> {
    const entries = this.sorted(key).reverse();
    const end = stop === -1 ? entries.length - 1 : stop;
    return FakeRedis.flat(
      entries.slice(start, end + 1),
      withScores === "WITHSCORES",
    );
  }

  pipeline() {
    const commands: Array<() => Promise<unknown>> = [];
    const chain = {
      zcard: (key: string) => {
        commands.push(() => this.zcard(key));
        return chain;
      },
      get: (key: string) => {
        commands.push(() => this.get(key));
        return chain;
      },
      zrange: (key: string, start: number, stop: number, ws?: string) => {
        commands.push(() => this.zrange(key, start, stop, ws));
        return chain;
      },
      sismember: (key: string, member: string) => {
        commands.push(() => this.sismember(key, member));
        return chain;
      },
      ttl: (key: string) => {
        commands.push(() => this.ttl(key));
        return chain;
      },
      hget: (key: string, field: string) => {
        commands.push(() => this.hget(key, field));
        return chain;
      },
      hgetall: (key: string) => {
        commands.push(() => this.hgetall(key));
        return chain;
      },
      exec: async () => {
        const results: Array<[null, unknown]> = [];
        for (const run of commands) {
          results.push([null, await run()]);
        }
        return results;
      },
    };
    return chain;
  }
}

function stageGroup(
  redis: FakeRedis,
  groupId: string,
  readyScore: number,
  headJobId: string,
): void {
  const ready = redis.zsets.get(`${PREFIX}ready`) ?? [];
  ready.push({ member: groupId, score: readyScore });
  redis.zsets.set(`${PREFIX}ready`, ready);
  redis.zsets.set(`${PREFIX}group:${groupId}:jobs`, [
    { member: headJobId, score: readyScore },
  ]);
}

async function scan(redis: FakeRedis, topN: number) {
  const repo = new QueueRedisRepository(redis as unknown as Redis);
  const queues = await repo.scanQueues({ queueNames: [QUEUE_NAME], topN });
  return queues[0]!;
}

describe("QueueRedisRepository.scanQueues — group summary", () => {
  describe("when the ready zset holds more groups than the scan limit", () => {
    it("samples both ends, so the most-eligible and most-deferred groups are listed", async () => {
      const redis = new FakeRedis();
      const now = Date.now();
      // Ascending eligibility: oldest-due first, most-deferred last.
      stageGroup(redis, "group-eligible-old", now - 86_400_000, "job-a");
      stageGroup(redis, "group-mid-1", now - 5_000, "job-b");
      stageGroup(redis, "group-mid-2", now - 1_000, "job-c");
      stageGroup(redis, "group-deferred", now + 300_000, "job-d");

      const queue = await scan(redis, 1);

      const listed = queue.groups.map((g) => g.groupId);
      expect(listed).toContain("group-eligible-old");
      expect(listed).toContain("group-deferred");
    });
  });

  describe("when the head job has retried since ADR-080", () => {
    it("reads the retry count from the group's attempt key, not the job id", async () => {
      const redis = new FakeRedis();
      stageGroup(redis, "group-retrying", Date.now() + 60_000, "evt-plain-id");
      redis.strings.set(`${PREFIX}group:group-retrying:attempt`, "4");

      const queue = await scan(redis, 10);

      const group = queue.groups.find((g) => g.groupId === "group-retrying");
      expect(group?.retryCount).toBe(4);
    });
  });

  describe("when only a pre-ADR-080 job id marker exists", () => {
    it("falls back to the legacy /r/<n> id parse", async () => {
      const redis = new FakeRedis();
      stageGroup(redis, "group-legacy", Date.now(), "evt-1/r/2");

      const queue = await scan(redis, 10);

      const group = queue.groups.find((g) => g.groupId === "group-legacy");
      expect(group?.retryCount).toBe(2);
    });
  });

  describe("when the head job has never been retried", () => {
    it("reports no retry count", async () => {
      const redis = new FakeRedis();
      stageGroup(redis, "group-fresh", Date.now(), "evt-fresh");

      const queue = await scan(redis, 10);

      const group = queue.groups.find((g) => g.groupId === "group-fresh");
      expect(group?.retryCount).toBeNull();
    });
  });
});
