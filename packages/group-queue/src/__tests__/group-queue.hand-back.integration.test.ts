/** A worker with no handler hands a job back unspent; specs/hand-back-unhandled-job.feature. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition, JobDelivery } from "../contracts.ts";
import { HandBackGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor, HAND_BACK_CONFIG } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

describe("GroupQueueProcessor - hand-back of a job a worker has no handler for", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        maxRetriesPerRequest: 0,
      },
    );
  });

  beforeEach(() => {
    queues = [];
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys("{test/gqhandback/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function worker({
    name,
    process,
  }: {
    name: string;
    process: (payload: TestPayload, delivery?: JobDelivery) => Promise<void>;
  }): GroupQueueProcessor<TestPayload> {
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name,
      groupKey: (p) => p.groupId,
      identify: (p) => p.id,
      process,
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis);
    queues.push(queue);
    return queue;
  }

  describe("given two workers on one queue, only one of which has the job's handler", () => {
    describe("when the worker without the handler takes the job first", () => {
      /** @scenario "Another worker with the handler runs a handed-back job" */
      it("hands it back and the worker with the handler runs it on its first attempt", async () => {
        const name = `{test/gqhandback/${crypto.randomUUID().slice(0, 8)}}`;
        const keyPrefix = `${name}:gq:`;
        let handedBack = 0;
        const older = worker({
          name,
          process: async () => {
            handedBack += 1;
            throw new HandBackGroupQueueError("no handler registered in this worker");
          },
        });
        await older.waitUntilReady();
        await older.send({ id: "job-1", groupId: "group-a" });
        await vi.waitFor(() => expect(handedBack).toBeGreaterThanOrEqual(1), {
          timeout: 10_000,
          interval: 50,
        });

        const ranAt: number[] = [];
        const newer = worker({
          name,
          process: async (_payload, delivery) => {
            ranAt.push(delivery?.attempt ?? 0);
          },
        });
        await newer.waitUntilReady();

        await vi.waitFor(() => expect(ranAt).toEqual([1]), { timeout: 20_000, interval: 50 });
        expect(await redis.smembers(`${keyPrefix}blocked`)).toEqual([]);
        expect(await redis.exists(`${keyPrefix}group:group-a:failstreak`)).toBe(0);
      });
    });
  });

  /** Workers with no handler: the first one's first claim waits for `release`, the rest do not. */
  function heldWorker({ name, claims }: { name: string; claims: string[] }) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const withoutHandler = (id: string) =>
      worker({
        name,
        process: async () => {
          claims.push(id);
          if (id === "first") await released;
          throw new HandBackGroupQueueError("no handler registered in this worker");
        },
      });
    return { withoutHandler, release };
  }

  /** Lets a worker that just started reach its signal wait: the job is claimed, so it sleeps. */
  const untilAsleep = () => new Promise((resolve) => setTimeout(resolve, 300));

  describe("given the worker with the handler is asleep in its signal wait before the hand-back", () => {
    describe("when the worker without the handler hands the job back", () => {
      /** @scenario "A worker with the handler, asleep when the job is handed back, runs it first" */
      it("runs it on its first attempt, and the job is handed back once (#9148)", async () => {
        const name = `{test/gqhandback/${crypto.randomUUID().slice(0, 8)}}`;
        const claims: string[] = [];
        const { withoutHandler, release } = heldWorker({ name, claims });
        const first = withoutHandler("first");
        await first.waitUntilReady();
        await first.send({ id: "job-1", groupId: "group-a" });
        await vi.waitFor(() => expect(claims).toEqual(["first"]), {
          timeout: 10_000,
          interval: 20,
        });

        const ran: number[] = [];
        const handler = worker({
          name,
          process: async (_payload, delivery) => {
            ran.push(delivery?.attempt ?? 0);
          },
        });
        await handler.waitUntilReady();
        await untilAsleep();
        release();

        await vi.waitFor(() => expect(ran).toEqual([1]), { timeout: 20_000, interval: 50 });
        expect(claims).toEqual(["first"]);
      });
    });
  });

  describe("given two workers without the handler and one with it, asleep before the hand-back", () => {
    describe("when each worker without the handler hands the job back", () => {
      /** @scenario "Every worker that handed a job back passes it over, so the worker with the handler runs it" */
      it("hands it back once from each, and the worker with the handler runs it on its first attempt", async () => {
        const name = `{test/gqhandback/${crypto.randomUUID().slice(0, 8)}}`;
        const claims: string[] = [];
        const { withoutHandler, release } = heldWorker({ name, claims });
        const first = withoutHandler("first");
        await first.waitUntilReady();
        await first.send({ id: "job-1", groupId: "group-a" });
        await vi.waitFor(() => expect(claims).toEqual(["first"]), {
          timeout: 10_000,
          interval: 20,
        });

        await withoutHandler("second").waitUntilReady();
        await untilAsleep();
        const ran: number[] = [];
        const handler = worker({
          name,
          process: async (_payload, delivery) => {
            ran.push(delivery?.attempt ?? 0);
          },
        });
        await handler.waitUntilReady();
        await untilAsleep();
        release();

        await vi.waitFor(() => expect(ran).toEqual([1]), { timeout: 20_000, interval: 50 });
        expect(claims.filter((id) => id === "first")).toEqual(["first"]);
        expect(claims.filter((id) => id === "second").length).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("given one worker on the queue, with no handler for the job", () => {
    describe("when it hands the job back", () => {
      /** @scenario "The only worker, or one whose peers are gone, takes back a job it handed back once its pass-over lapses" */
      it("takes the job again only after two signal waits, still on its first attempt", async () => {
        const name = `{test/gqhandback/${crypto.randomUUID().slice(0, 8)}}`;
        const keyPrefix = `${name}:gq:`;
        const handBacks: { at: number; attempt: number }[] = [];
        const only = worker({
          name,
          process: async (_payload, delivery) => {
            handBacks.push({ at: Date.now(), attempt: delivery?.attempt ?? 0 });
            throw new HandBackGroupQueueError("no handler registered in this worker");
          },
        });
        await only.waitUntilReady();
        await only.send({ id: "job-1", groupId: "group-a" });

        await vi.waitFor(
          async () =>
            expect(await redis.exists(`${keyPrefix}group:group-a:handed-back-by`)).toBe(1),
          { timeout: 10_000, interval: 50 },
        );
        await vi.waitFor(() => expect(handBacks.length).toBeGreaterThanOrEqual(2), {
          timeout: HAND_BACK_CONFIG.passOverMs + 10_000,
          interval: 50,
        });

        const [first, second] = handBacks;
        expect(second!.at - first!.at).toBeGreaterThanOrEqual(HAND_BACK_CONFIG.passOverMs - 100);
        expect([first!.attempt, second!.attempt]).toEqual([1, 1]);
      });
    });
  });
});
