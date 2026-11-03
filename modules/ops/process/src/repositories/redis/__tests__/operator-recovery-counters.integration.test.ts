import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const redisUrl = process.env.REDIS_URL ?? process.env.CI_REDIS_URL;
const hasRedis = !!redisUrl;

// Module-level incrementing counter for unique queue names — no Date.now().
let queueCounter = 0;

/**
 * The counters that decide whether a group's next job is allowed to run. Each
 * one outlives a block, so an operator recovery that leaves any behind hands
 * the group id's next job an inheritance it did not earn (ADR-080).
 */
const counterSuffixes = ["strikes", "attempt", "failstreak"] as const;

describe.skipIf(!hasRedis)("operator recovery clears every per-group counter", () => {
  let redis: Redis;
  let repo: QueueRedisRepository;
  let queueName: string;
  let prefix: string;
  const groupId = "project-1/subscriber/pm:langyConversation";

  beforeAll(() => {
    if (!redisUrl) {
      return;
    }

    redis = new IORedis(redisUrl);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  const counterKey = (suffix: string) => `${prefix}group:${groupId}:${suffix}`;

  /** A group blocked after exhausting its budget, with every counter set. */
  async function seedExhaustedBlockedGroup(): Promise<void> {
    await redis.zadd(`${prefix}group:${groupId}:jobs`, 1000, "job-1");
    await redis.hset(`${prefix}group:${groupId}:data`, "job-1", "{}");
    await redis.sadd(`${prefix}blocked`, groupId);
    await redis.set(counterKey("strikes"), "3");
    await redis.set(counterKey("attempt"), "25");
    await redis.set(counterKey("failstreak"), "24");
  }

  async function survivingCounters(): Promise<string[]> {
    const present: string[] = [];
    for (const suffix of counterSuffixes) {
      if ((await redis.exists(counterKey(suffix))) === 1) present.push(suffix);
    }
    return present;
  }

  beforeEach(async () => {
    repo = QueueRedisRepository.create({ redis });
    queueCounter++;
    queueName = `test-oprecover-${queueCounter}`;
    prefix = `${queueName}:gq:`;
    await seedExhaustedBlockedGroup();
  });

  describe("given a group blocked after a job used up its retry budget", () => {
    describe("when an operator unblocks it", () => {
      /** @scenario A group unblocked after exhaustion retries instead of re-blocking on its first failure */
      /** @scenario A group unblocked after exhaustion is not immediately re-quarantined by its old failure streak */
      it("leaves no counter behind to spend the next job's budget", async () => {
        const { wasBlocked } = await repo.unblockGroup({ queueName, groupId });

        expect(wasBlocked).toBe(true);
        // Pre-ADR-080 this returned ["attempt", "failstreak"]: the group came
        // back with a spent ladder AND a streak at the quarantine threshold.
        expect(await survivingCounters()).toEqual([]);
      });

      /** @scenario An unblocked group's fresh ladder does not depend on how long the operator waited */
      it("does not depend on how long the operator waited", async () => {
        // The retry chain expires on its own after ~30 minutes, so before the
        // fix a slow operator got a fresh ladder and a fast one got none. With
        // the key deleted outright the outcome is the same either way, which is
        // what this asserts: no surviving counter, no TTL to race.
        await repo.unblockGroup({ queueName, groupId });

        expect(await redis.ttl(counterKey("attempt"))).toBe(-2); // -2 = gone
      });
    });

    describe("when an operator drains it", () => {
      /** @scenario A drained group id starts its next job on a fresh ladder */
      it("leaves no counter for a job later staged under the same group id", async () => {
        await repo.drainGroup({ queueName, groupId });

        expect(await survivingCounters()).toEqual([]);
      });
    });

    describe("when an operator moves it to the dead-letter queue", () => {
      /** @scenario A dead-lettered group id starts its next job on a fresh ladder */
      it("leaves no counter for a job later staged under the same group id", async () => {
        await repo.moveToDlq({ queueName, groupId });

        expect(await survivingCounters()).toEqual([]);
      });
    });
  });

  describe("given a blocked group whose job the pending counter counts", () => {
    const pending = async () => Number(await redis.get(`${prefix}stats:total-pending`));

    beforeEach(async () => {
      await redis.set(`${prefix}stats:total-pending`, "1");
    });

    describe("when an operator moves it to the dead-letter queue and replays it", () => {
      /** @scenario Operator dead-letter moves and replays keep the pending counter without a reconcile */
      it("takes the job off the counter on the move and puts it back on the replay", async () => {
        await repo.moveToDlq({ queueName, groupId });
        expect(await pending()).toBe(0);

        const { jobsReplayed } = await repo.replayFromDlq({ queueName, groupId });

        expect(jobsReplayed).toBe(1);
        expect(await pending()).toBe(1);
      });

      /** @scenario Operator dead-letter moves and replays keep the pending counter without a reconcile */
      it("does not drift when the move and the replay are repeated", async () => {
        await repo.moveToDlq({ queueName, groupId });
        await repo.moveToDlq({ queueName, groupId });
        expect(await pending()).toBe(0);

        await repo.replayFromDlq({ queueName, groupId });
        await repo.replayFromDlq({ queueName, groupId });
        expect(await pending()).toBe(1);
      });
    });

    describe("when an operator moves every blocked group and redrives the shown set", () => {
      /** @scenario Operator dead-letter moves and replays keep the pending counter without a reconcile */
      it("keeps the counter equal to the live jobs through the bulk paths", async () => {
        await repo.moveAllBlockedToDlq({ queueName });
        expect(await pending()).toBe(0);

        await repo.redriveManyFromDlq({ queueName, groupIds: [groupId] });

        expect(await pending()).toBe(await redis.zcard(`${prefix}group:${groupId}:jobs`));
        expect(await pending()).toBe(1);
      });
    });
  });
});
