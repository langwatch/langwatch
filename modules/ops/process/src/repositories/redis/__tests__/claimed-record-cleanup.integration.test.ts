import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const redisUrl = process.env.REDIS_URL ?? process.env.CI_REDIS_URL;

let queueCounter = 0;

/**
 * A worker that dies mid-job leaves its claimed record for the next claim to put back
 * (packages/group-queue/specs/claimed-job-recovery.feature). Operator recovery must not let
 * that record bring jobs back into a group it emptied.
 */
describe.skipIf(!redisUrl)("operator recovery of a group a dead worker had claimed", () => {
  let redis: Redis;
  let repo: QueueRedisRepository;
  let prefix: string;
  let queueName: string;
  const groupId = "project-1/subscriber/pm:langyConversation";
  const groupKey = (suffix: string) => `${prefix}group:${groupId}:${suffix}`;

  beforeAll(() => {
    if (redisUrl) redis = new IORedis(redisUrl);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  beforeEach(async () => {
    repo = QueueRedisRepository.create({ redis });
    queueCounter++;
    queueName = `test-claimed-cleanup-${queueCounter}-${crypto.randomUUID().slice(0, 8)}`;
    prefix = `${queueName}:gq:`;
    // The dead worker's record (its active key already lapsed), and one job staged behind it.
    await redis.hset(groupKey("claimed"), {
      token: "1000.1",
      "s:job-1": "100",
      "d:job-1": '{"job":1}',
    });
    await redis.zadd(groupKey("jobs"), 200, "job-2");
    await redis.hset(groupKey("data"), "job-2", '{"job":2}');
    await redis.zadd(`${prefix}ready`, 200, groupId);
  });

  afterEach(async () => {
    const keys = await redis.keys(`${queueName}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  describe("when an operator drains the group", () => {
    /** @scenario "Draining a group throws away a dead worker's claimed jobs" */
    it("deletes the claimed record with the staged jobs", async () => {
      await repo.drainGroup({ queueName, groupId });

      expect(await redis.exists(groupKey("claimed"))).toBe(0);
      expect(await redis.exists(groupKey("jobs"))).toBe(0);
    });
  });

  describe("when an operator moves the group to the dead-letter queue", () => {
    /** @scenario "Moving a group to the dead-letter queue carries a dead worker's claimed jobs with it" */
    it("dead-letters the claimed job ahead of the staged one and deletes the record", async () => {
      const { jobsMoved } = await repo.moveToDlq({ queueName, groupId });

      expect(jobsMoved).toBe(2);
      expect(await redis.zrange(`${prefix}dlq:${groupId}:jobs`, 0, -1)).toEqual(["job-1", "job-2"]);
      expect(await redis.hget(`${prefix}dlq:${groupId}:data`, "job-1")).toBe('{"job":1}');
      expect(await redis.exists(groupKey("claimed"))).toBe(0);
    });
  });
});
