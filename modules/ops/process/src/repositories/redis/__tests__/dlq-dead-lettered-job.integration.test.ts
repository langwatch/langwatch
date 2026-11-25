import { GroupQueueProcessor, NonRetryableGroupQueueError } from "@langwatch/group-queue";
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const redisUrl = process.env.REDIS_URL ?? process.env.CI_REDIS_URL;
const hasRedis = !!redisUrl;

type TestPayload = { id: string; groupId: string };

/** packages/group-queue/specs/dead-letter-on-exhaustion.feature: the queue writes, ops redrives. */
describe.skipIf(!hasRedis)("A job the group queue dead-lettered", () => {
  let redis: Redis;
  const queues: GroupQueueProcessor<TestPayload>[] = [];

  beforeAll(() => {
    if (!redisUrl) return;
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 0 });
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    queues.length = 0;
    const keys = await redis.keys("{test/opsdlq/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  describe("when the operator redrives its group once the cause is fixed", () => {
    /** @scenario "A dead-lettered job is redriven by the operator" */
    it("runs the job and takes the group out of the dead-letter queue", async () => {
      const queueName = `{test/opsdlq/${crypto.randomUUID().slice(0, 8)}}`;
      let isBroken = true;
      const ran: string[] = [];
      const queue = new GroupQueueProcessor<TestPayload>(
        {
          name: queueName,
          groupKey: (p) => p.groupId,
          identify: (p) => p.id,
          process: async (p) => {
            if (isBroken) throw new NonRetryableGroupQueueError("analysis service unavailable");
            ran.push(p.id);
          },
          onExhausted: () => "dead-letter",
        },
        redis,
      );
      queues.push(queue);
      await queue.waitUntilReady();
      const repo = QueueRedisRepository.create({ redis });

      await queue.send({ id: "job-1", groupId: "group-a" });
      await vi.waitFor(
        async () =>
          expect((await repo.findDlqGroups({ queueName })).map((group) => group.groupId)).toEqual([
            "group-a",
          ]),
        { timeout: 10_000, interval: 50 },
      );

      const pending = async () => Number(await redis.get(`${queueName}:gq:stats:total-pending`));
      // The dead-lettered job left the live group at its claim, so nothing counts it.
      expect(await pending()).toBe(0);

      isBroken = false;
      const redriven = await repo.redriveManyFromDlq({ queueName, groupIds: ["group-a"] });

      expect(redriven).toEqual({ redrivenCount: 1, jobsRedriven: 1 });
      await vi.waitFor(() => expect(ran).toEqual(["job-1"]), { timeout: 10_000, interval: 50 });
      expect(await repo.findDlqGroups({ queueName })).toEqual([]);
      expect(await pending()).toBe(0);
    });
  });

  describe("when the operator lists dead-letter groups after one's entries expired", () => {
    /** @scenario "Listing dead-letter groups forgets the ones whose entries expired" */
    it("drops the expired group from the index and keeps the live one", async () => {
      const queueName = `{test/opsdlq/${crypto.randomUUID().slice(0, 8)}}`;
      const prefix = `${queueName}:gq:`;
      await redis.sadd(`${prefix}dlq`, "g-expired", "g-live");
      await redis.zadd(`${prefix}dlq:g-live:jobs`, 1, "j1");
      await redis.hset(`${prefix}dlq:g-live:data`, "j1", "{}");
      const repo = QueueRedisRepository.create({ redis });

      const groups = await repo.findDlqGroups({ queueName });

      expect(groups.map((group) => group.groupId)).toEqual(["g-live"]);
      expect(await redis.smembers(`${prefix}dlq`)).toEqual(["g-live"]);
    });
  });
});
