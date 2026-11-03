/**
 * Adaptive slots on real Redis: with a store serving four at a time the slots settle near four,
 * also when every queue script answers late. Spec: specs/adaptive-slots.feature.
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

const CONFIGURED = 2;
const STORE_SERVES = 4;
const STORE_MS = 40;
const BACKLOG = 3_500;
const RUN_MS = 22_000;
/** How late each queue script answers in the slow-Redis case. */
const SCRIPT_DELAY_MS = 15;

/** A store that serves a fixed number of jobs at once and queues the rest. */
function storeServing({ atOnce }: { atOnce: number }) {
  let serving = 0;
  const waiting: (() => void)[] = [];
  return async function serve({ ms }: { ms: number }): Promise<void> {
    if (serving >= atOnce) await new Promise<void>((resolve) => waiting.push(resolve));
    else serving += 1;
    await new Promise((resolve) => setTimeout(resolve, ms));
    const next = waiting.shift();
    if (next) next();
    else serving -= 1;
  };
}

describe("GroupQueueProcessor - adaptive slots", () => {
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
    queueName = `{test/gqadaptive/${crypto.randomUUID().slice(0, 8)}}`;
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/gqadaptive/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  /** Runs the backlog for RUN_MS through a consumer on `connection`; the most jobs ever running. */
  async function runBacklog({ connection }: { connection: Redis }) {
    const serve = storeServing({ atOnce: STORE_SERVES });
    let running = 0;
    let peak = 0;
    let finished = 0;
    const queue = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process: async () => {
          running += 1;
          peak = Math.max(peak, running);
          await serve({ ms: STORE_MS });
          running -= 1;
          finished += 1;
        },
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: () => Date.now(),
        options: { globalConcurrency: CONFIGURED },
      },
      connection,
    );
    queues.push(queue);
    await queue.waitUntilReady();

    const ids = Array.from({ length: BACKLOG }, (_, index) => `tenant-1/group-${index}`);
    for (let start = 0; start < ids.length; start += 250) {
      await Promise.all(ids.slice(start, start + 250).map((id) => queue.send({ id, groupId: id })));
    }
    await new Promise((resolve) => setTimeout(resolve, RUN_MS));
    return { peak, finished };
  }

  describe("given a backlog of jobs that share a store serving four at a time", () => {
    /** @scenario "Slots settle near what a saturated store absorbs instead of climbing" */
    it("grows past its configured two and never runs more than four times what the store serves", async () => {
      const { peak, finished } = await runBacklog({ connection: redis });

      // Queue round trips sit outside the store, so throughput still rises a little past four
      // slots: local runs settled between four and nine, against a cap of 1000.
      expect(finished).toBeLessThan(BACKLOG);
      expect(peak).toBeGreaterThan(CONFIGURED);
      expect(peak).toBeLessThanOrEqual(STORE_SERVES * 4);
    }, 40_000);
  });

  describe("given the same backlog while every queue script answers late", () => {
    let slow: Redis;

    beforeEach(() => {
      slow = new IORedis(redis.options);
      const evalsha = slow.evalsha.bind(slow);
      // Slow claims and completions: a slot between claims now counts as taken during a backlog.
      slow.evalsha = (async (...args: Parameters<typeof evalsha>) => {
        await new Promise((resolve) => setTimeout(resolve, SCRIPT_DELAY_MS));
        return evalsha(...args);
      }) as typeof slow.evalsha;
    });

    afterEach(async () => {
      // The outer afterEach closes queues after this one, so close them before their connection.
      await Promise.all(queues.splice(0).map((queue) => queue.close().catch(() => {})));
      // A script still in its delay is sent after the close; let it land before the quit.
      await new Promise((resolve) => setTimeout(resolve, SCRIPT_DELAY_MS * 4));
      await slow.quit();
    });

    /** @scenario "Slow queue scripts during a backlog do not grow slots past what the store serves" */
    it("still never runs more than four times what the store serves", async () => {
      const { peak } = await runBacklog({ connection: slow });

      expect(peak).toBeLessThanOrEqual(STORE_SERVES * 4);
    }, 40_000);
  });
});
