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
/** A failure wave: each job fails fast, after a short store call. */
const FAILING_STORE_MS = 5;
const FAILURE_RUN_MS = 10_000;
/** Jobs finished at the least; loaded local runs finished 900 to 2400 in each case. */
const SLOW_FINISHED_FLOOR = 200;
const FAILURE_FINISHED_FLOOR = 100;

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

  /** Runs the backlog through a consumer on `connection`; the most jobs ever running. */
  async function runBacklog({
    connection,
    failing = false,
    runMs = RUN_MS,
  }: {
    connection: Redis;
    /** Every job throws after its store call, so none completes. */
    failing?: boolean;
    runMs?: number;
  }) {
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
          try {
            await serve({ ms: failing ? FAILING_STORE_MS : STORE_MS });
          } finally {
            running -= 1;
            finished += 1;
          }
          if (failing) throw new Error("store refused the write");
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
    await new Promise((resolve) => setTimeout(resolve, runMs));
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
      const late = () => new Promise((resolve) => setTimeout(resolve, SCRIPT_DELAY_MS));
      const evalsha = slow.evalsha.bind(slow);
      slow.evalsha = (async (...args: Parameters<typeof evalsha>) => {
        await late();
        return evalsha(...args);
      }) as typeof slow.evalsha;
      // Batched outcomes queue their scripts in a pipeline: a pipeline holding one sends late too.
      const pipeline = slow.pipeline.bind(slow);
      slow.pipeline = ((...args: Parameters<typeof pipeline>) => {
        const queued = pipeline(...args);
        const queuedEvalsha = queued.evalsha.bind(queued);
        const exec = queued.exec.bind(queued);
        let scripted = false;
        queued.evalsha = ((...script: Parameters<typeof queuedEvalsha>) => {
          scripted = true;
          return queuedEvalsha(...script);
        }) as typeof queued.evalsha;
        queued.exec = (async (...execArgs: Parameters<typeof exec>) => {
          if (scripted) await late();
          return exec(...execArgs);
        }) as typeof queued.exec;
        return queued;
      }) as typeof slow.pipeline;
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
      const { peak, finished } = await runBacklog({ connection: slow });

      // A consumer stuck on its late scripts runs nothing; this one still drains the store.
      expect(finished).toBeGreaterThanOrEqual(SLOW_FINISHED_FLOOR);
      expect(peak).toBeLessThanOrEqual(STORE_SERVES * 4);
    }, 40_000);
  });

  describe("given a backlog where every job fails fast", () => {
    /** @scenario "A failure wave during a backlog does not grow slots" */
    it("never runs more jobs at once than it was configured for", async () => {
      const { peak, finished } = await runBacklog({
        connection: redis,
        failing: true,
        runMs: FAILURE_RUN_MS,
      });

      expect(finished).toBeGreaterThanOrEqual(FAILURE_FINISHED_FLOOR);
      expect(peak).toBeLessThanOrEqual(CONFIGURED);
    }, 30_000);
  });
});
