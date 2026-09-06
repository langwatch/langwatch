import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { QueueRedisRepository } from "../../repositories/queue.redis.repository";

/**
 * Discard and explicit-id redrive against a real Redis
 * (specs/ops/dead-letter-recovery.feature). Discard removes the group's DLQ
 * entries — the durable mark is the audit row the service writes, which the
 * queue.service unit suite covers; here the substrate contract is that the
 * jobs are gone and cannot come back.
 */
let redis: Redis;
beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
});
afterAll(async () => {
  await stopTestContainers();
});

// Module-level incrementing counter for unique queue names — no Date.now().
let queueCounter = 0;

describe("DLQ discard and explicit-id redrive", () => {
  function freshQueue(): { queueName: string; prefix: string } {
    queueCounter++;
    const queueName = `dlq-discard-${queueCounter}`;
    return { queueName, prefix: `${queueName}:gq:` };
  }

  async function seedDlqGroup(
    prefix: string,
    groupId: string,
    { jobs = 2, error = "boom" }: { jobs?: number; error?: string } = {},
  ): Promise<void> {
    for (let i = 1; i <= jobs; i++) {
      await redis.zadd(`${prefix}dlq:${groupId}:jobs`, 1000 + i, `job-${i}`);
      await redis.hset(`${prefix}dlq:${groupId}:data`, `job-${i}`, "{}");
    }
    await redis.hset(
      `${prefix}dlq:${groupId}:error`,
      "message",
      error,
      "timestamp",
      "1723800000000",
    );
    await redis.sadd(`${prefix}dlq`, groupId);
  }

  describe("given a queue holding dead-lettered groups", () => {
    describe("when the operator discards a group", () => {
      /** @scenario Discarding a DLQ group removes it and remembers the act */
      it("removes the group's entries and returns what the audit row must record", async () => {
        const { queueName, prefix } = freshQueue();
        const repo = new QueueRedisRepository(redis);
        await seedDlqGroup(prefix, "group-a", { jobs: 3, error: "HTTP 500" });

        const result = await repo.discardManyFromDlq({
          queueName,
          groupIds: ["group-a"],
        });

        expect(result.discardedCount).toBe(1);
        expect(result.jobsDiscarded).toBe(3);
        expect(result.lastErrors).toEqual(["HTTP 500"]);
        expect(await redis.exists(`${prefix}dlq:group-a:jobs`)).toBe(0);
        expect(await redis.exists(`${prefix}dlq:group-a:data`)).toBe(0);
        expect(await redis.exists(`${prefix}dlq:group-a:error`)).toBe(0);
        expect(await redis.smembers(`${prefix}dlq`)).toEqual([]);
        expect(await repo.listDlqGroups({ queueName })).toEqual([]);
      });

      /** @scenario A discarded DLQ group cannot be redriven afterwards */
      it("keeps a discarded group out of every later redrive", async () => {
        const { queueName, prefix } = freshQueue();
        const repo = new QueueRedisRepository(redis);
        await seedDlqGroup(prefix, "group-a");
        await seedDlqGroup(prefix, "group-b");

        await repo.discardManyFromDlq({ queueName, groupIds: ["group-a"] });

        // An explicit redrive naming the discarded id finds nothing to move.
        const explicit = await repo.redriveManyFromDlq({
          queueName,
          groupIds: ["group-a", "group-b"],
        });
        expect(explicit.redrivenCount).toBe(1);
        expect(await redis.exists(`${prefix}group:group-a:jobs`)).toBe(0);
        expect(await redis.zcard(`${prefix}group:group-b:jobs`)).toBe(2);

        // A queue-wide redrive cannot resurrect it either.
        const all = await repo.replayAllFromDlq({ queueName });
        expect(all.replayedCount).toBe(0);
      });
    });

    describe("when the operator redrives an explicit set", () => {
      /** @scenario Bulk DLQ actions act on exactly what is shown */
      it("redrives only the named ids and leaves the rest dead-lettered", async () => {
        const { queueName, prefix } = freshQueue();
        const repo = new QueueRedisRepository(redis);
        await seedDlqGroup(prefix, "group-a");
        await seedDlqGroup(prefix, "group-b");

        const result = await repo.redriveManyFromDlq({
          queueName,
          groupIds: ["group-a"],
        });

        expect(result.redrivenCount).toBe(1);
        expect(result.jobsRedriven).toBe(2);
        expect(await redis.zcard(`${prefix}group:group-a:jobs`)).toBe(2);
        expect(await redis.smembers(`${prefix}dlq`)).toEqual(["group-b"]);
        expect(await redis.exists(`${prefix}dlq:group-b:jobs`)).toBe(1);
      });
    });
  });
});
