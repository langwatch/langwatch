/**
 * @vitest-environment node
 * @see specs/ops/worker-operational-loops.feature
 * The worker booted wholly live over the test Postgres, Redis and ClickHouse (§7): the
 * queue-metrics writer claims the fleet's lease on the shared snapshot store and hands it back
 * when the worker closes.
 */
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootLiveWorker, liveStoresConfigured, type LiveWorker } from "./worker-live.fixture.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;

/** Its own Redis database keeps this worker's keys and jobs from every other test process. */
const REDIS_DB_INDEX = 12;

describe.skipIf(!liveStoresConfigured)("given the worker booted with the queue's Redis", () => {
  let redis: Redis;
  let worker: LiveWorker | undefined;

  const leaseKeys = async () =>
    (await redis.keys("*")).filter((key) => key.startsWith("ops:") && key.includes("lease"));

  beforeAll(async () => {
    redis = new Redis(redisUrl ?? "", { db: REDIS_DB_INDEX });
    await redis.flushdb();
    worker = await bootLiveWorker({ environment: { REDIS_DB_INDEX: String(REDIS_DB_INDEX) } });
  });

  afterAll(async () => {
    await worker?.close();
    await redis.quit();
  });

  describe("when the ops feature installer has run", () => {
    /** @scenario "The worker starts all three loops when it boots" */
    it("runs the queue-metrics writer, which holds the fleet's lease on the shared store", async () => {
      await expect.poll(leaseKeys, { timeout: 30_000 }).not.toEqual([]);
    });
  });

  describe("when the worker closes", () => {
    /** @scenario "Shutting the worker down stops every loop it started" */
    it("hands the writer's lease back, so no writer is left running", async () => {
      expect(await leaseKeys()).not.toEqual([]);

      await worker?.close();
      worker = undefined;

      expect(await leaseKeys()).toEqual([]);
    });
  });
});
