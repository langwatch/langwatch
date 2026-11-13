/**
 * The claim rate during a backlog on real Redis: a consumer draining short jobs claims at most
 * once per gap for small claims, plus once per full-size claim.
 * Spec: specs/claim-round-trips.feature.
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueProcessor } from "../groupQueue.ts";
import { GroupStagingScripts } from "../scripts.ts";

type TestPayload = { id: string; groupId: string };

const SLOTS = 100;
const JOB_MS = 20;
const BACKLOG = 30_000;
const WARMUP_MS = 500;
const MEASURE_MS = 3_000;

describe("GroupQueueProcessor - claim rate during a backlog", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });

  beforeEach(() => {
    queues = [];
    queueName = `{test/gqclaimrate/${crypto.randomUUID().slice(0, 8)}}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys(`${queueName}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe(`given ${SLOTS} slots and a backlog of ${JOB_MS} ms jobs`, () => {
    /** @scenario "A backlog of short jobs keeps the claim rate bounded" */
    it("claims at most once per gap for small claims, plus once per 32 jobs", async () => {
      // Each claimBatch is one EVALSHA of the claim script.
      const claimBatch = vi.spyOn(GroupStagingScripts.prototype, "claimBatch");
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      let finished = 0;
      const queue = new GroupQueueProcessor<TestPayload>(
        {
          name: queueName,
          process: async () => {
            await gate;
            await new Promise((resolve) => setTimeout(resolve, JOB_MS * (0.5 + Math.random())));
            finished += 1;
          },
          groupKey: (payload) => payload.groupId,
          identify: (payload) => payload.id,
          score: () => Date.now(),
          options: { globalConcurrency: SLOTS },
        },
        redis,
      );
      queues.push(queue);
      await queue.waitUntilReady();

      const ids = Array.from(
        { length: BACKLOG },
        (_, index) => `tenant-${index % 100}/group-${index}`,
      );
      for (let start = 0; start < ids.length; start += 500) {
        await Promise.all(
          ids.slice(start, start + 500).map((id) => queue.send({ id, groupId: id })),
        );
      }
      open();
      await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
      const claimsBefore = claimBatch.mock.calls.length;
      const finishedBefore = finished;
      await new Promise((resolve) => setTimeout(resolve, MEASURE_MS));
      const claimsPerSecond = (claimBatch.mock.calls.length - claimsBefore) / (MEASURE_MS / 1000);
      const jobsPerSecond = (finished - finishedBefore) / (MEASURE_MS / 1000);
      process.stderr.write(
        `claim rate: ${claimsPerSecond.toFixed(0)} claims/s, ${jobsPerSecond.toFixed(0)} jobs/s\n`,
      );

      // The backlog outlasts the window, so the queue stays busy all through it.
      expect(finished).toBeLessThan(BACKLOG);
      expect(jobsPerSecond).toBeGreaterThan(SLOTS * 5);
      // 10 ms between small claims is 100 a second; a claim of 32 or more goes at once.
      expect(claimsPerSecond).toBeLessThanOrEqual(110 + jobsPerSecond / 32);
    }, 60_000);
  });
});
