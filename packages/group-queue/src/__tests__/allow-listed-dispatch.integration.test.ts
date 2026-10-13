/**
 * Listed runs beside a large backlog: a run's jobs, and the jobs they cause, run on the listed
 * consumer and the run returns once they have all run. A fault or a stall fails only that run.
 * Spec: specs/upgrade/background-steps.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueError, NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = {
  id: string;
  groupId: string;
  followUp?: string;
  fails?: boolean;
  takesMs?: number;
  /** How many more jobs this one causes, one after another, each in a group of its own. */
  chain?: number;
};

const BACKLOG = 2_000;
const HOUR_AGO_MS = Date.now() - 60 * 60 * 1000;

/** The process's log context, as the worker carries it onto a job and back. */
class TestQueueContext implements GroupQueueContext {
  readonly storage = new AsyncLocalStorage<GroupQueueContextMetadata>();

  capture(): GroupQueueContextMetadata | undefined {
    return this.storage.getStore();
  }

  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(metadata ?? {}, operation);
  }
}

async function refusalOf(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("GroupQueueProcessor - listed runs beside a backlog", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;
  let context: TestQueueContext;
  let processed: string[];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queues = [];
    processed = [];
    queueName = `{test/gqlisted/${crypto.randomUUID().slice(0, 8)}}`;
    context = new TestQueueContext();
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys("{test/gqlisted/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue({ listed }: { listed: boolean }): GroupQueueProcessor<TestPayload> {
    const queue: GroupQueueProcessor<TestPayload> = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process: async (payload) => {
          if (payload.fails) throw new NonRetryableGroupQueueError(`${payload.id} refused`);
          if (payload.takesMs) await new Promise((resolve) => setTimeout(resolve, payload.takesMs));
          if (payload.chain) {
            const next = { ...payload, chain: payload.chain - 1 };
            await producer().send({
              ...next,
              id: `${payload.id}+`,
              groupId: `${payload.groupId}+`,
            });
          }
          processed.push(payload.id);
          if (payload.followUp) {
            await producer().send({ id: payload.followUp, groupId: `${payload.groupId}/reaction` });
          }
        },
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: (payload) => (payload.id.startsWith("backlog-") ? HOUR_AGO_MS : Date.now()),
      },
      redis,
      { consumerEnabled: listed, context, ...(listed ? { dispatchListed: true } : {}) },
    );
    queues.push(queue);
    return queue;
  }

  function producer(): GroupQueueProcessor<TestPayload> {
    return queues[0]!;
  }

  async function withBacklog(): Promise<GroupQueueProcessor<TestPayload>> {
    const sender = createQueue({ listed: false });
    await sender.waitUntilReady();
    await sender.sendBatch(
      Array.from({ length: BACKLOG }, (_, index) => ({
        id: `backlog-${index}`,
        groupId: `tenant-${index % 50}/bulk/${index}`,
      })),
    );
    return sender;
  }

  describe("given a large backlog of older groups and a run that sends a command", () => {
    /** @scenario "Queue work an upgrade step sends runs ahead of a backlog" */
    /** @scenario "A background step is done only once the queue work it sent has run" */
    it("returns once the command and the job it caused have run, taking nothing from the backlog", async () => {
      const sender = await withBacklog();
      await createQueue({ listed: true }).waitUntilReady();

      const report = await sender.runListedWork({
        name: "upgrade-step:trace:month-ids:run-1",
        timeoutMs: 20_000,
        work: async () => {
          await sender.send({ id: "command", groupId: "tenant-1/command/a", followUp: "reaction" });
          return { sent: 1 };
        },
      });

      expect(report).toEqual({ sent: 1 });
      expect(processed).toEqual(["command", "reaction"]);
      expect(await redis.zcard(`${queueName}:gq:ready`)).toBeGreaterThanOrEqual(BACKLOG);
      expect(await redis.keys(`${queueName}:gq:listed*`)).toEqual([]);
    }, 30_000);
  });

  describe("given a run whose follow-on jobs are staged after its list's open entry would lapse", () => {
    /** @scenario "A listed run's follow-on jobs run ahead of a backlog for as long as the run lasts" */
    it("stays open while its jobs register follow-on jobs, and runs every one ahead of the backlog", async () => {
      const sender = await withBacklog();
      await createQueue({ listed: true }).waitUntilReady();
      const name = "upgrade-step:user:record-created-facts:run-2";

      const report = await sender.runListedWork({
        name,
        timeoutMs: 3_000,
        work: async () => {
          await sender.sendBatch(
            Array.from({ length: 10 }, (_, index) => ({
              id: `command-${index}`,
              groupId: `user-${index}/command/${index}`,
              takesMs: 100,
              chain: 4,
            })),
          );
          await vi.waitFor(() => expect(processed).toHaveLength(10), { timeout: 10_000 });
          // As if the run opened its list an hour ago: only its follow-ons can keep it open now.
          const listKey = `${queueName}:gq:listed:${name}`;
          await redis.zadd(`${queueName}:gq:listed`, Date.now() + 150, listKey);
          return { sent: 10 };
        },
      });

      expect(report).toEqual({ sent: 10 });
      expect(processed).toHaveLength(10 * 5);
      expect(processed.filter((id) => id.startsWith("backlog-"))).toEqual([]);
      expect(await redis.zcard(`${queueName}:gq:ready`)).toBeGreaterThanOrEqual(BACKLOG);
    }, 30_000);
  });

  describe("given a run with a large amount of work open when a second run starts", () => {
    /** @scenario "Two listed runs at once each have their jobs run in turn" */
    it("runs the second run's command and the job it caused while the first run's work still waits", async () => {
      const sender = await withBacklog();
      await createQueue({ listed: true }).waitUntilReady();
      const busyJobs = 3_000;
      let busyRunWhenSecondReturned = -1;
      const busy = () => processed.filter((id) => id.startsWith("busy-")).length;

      let busySent: () => void = () => {};
      const sent = new Promise<void>((resolve) => {
        busySent = resolve;
      });

      await Promise.all([
        sender.runListedWork({
          name: "upgrade-step:a:busy",
          timeoutMs: 20_000,
          work: async () => {
            await sender.sendBatch(
              Array.from({ length: busyJobs }, (_, index) => ({
                id: `busy-${index}`,
                groupId: `busy-${index}/work`,
                takesMs: 100,
              })),
            );
            busySent();
          },
        }),
        sent.then(async () => {
          await sender.runListedWork({
            name: "upgrade-step:b:second",
            timeoutMs: 20_000,
            work: () =>
              sender.send({ id: "command", groupId: "user-1/command/b", followUp: "reaction" }),
          });
          busyRunWhenSecondReturned = busy();
        }),
      ]);

      expect(processed).toEqual(expect.arrayContaining(["command", "reaction"]));
      expect(busyRunWhenSecondReturned).toBeGreaterThanOrEqual(0);
      expect(busyRunWhenSecondReturned).toBeLessThan(busyJobs / 2);
      expect(busy()).toBe(busyJobs);
    }, 60_000);
  });

  describe("given two runs at once, one of whose commands fails", () => {
    /** @scenario "A failed job fails only the step whose list it is on" */
    it("refuses the failing run naming its group, and the other run finishes", async () => {
      const sender = await withBacklog();
      await createQueue({ listed: true }).waitUntilReady();

      const [failing, finishing] = await Promise.all([
        refusalOf(
          sender.runListedWork({
            name: "upgrade-step:a:fails",
            timeoutMs: 20_000,
            work: () => sender.send({ id: "bad", groupId: "tenant-2/command/bad", fails: true }),
          }),
        ),
        refusalOf(
          sender.runListedWork({
            name: "upgrade-step:b:works",
            timeoutMs: 20_000,
            work: () => sender.send({ id: "good", groupId: "tenant-3/command/good" }),
          }),
        ),
      ]);

      expect(failing).toBeInstanceOf(GroupQueueError);
      expect(failing).toMatchObject({ operation: "runListedWork" });
      expect(String((failing as Error).message)).toContain("tenant-2/command/bad");
      expect(finishing).toBeUndefined();
      expect(processed).toEqual(["good"]);
      expect(await redis.keys(`${queueName}:gq:listed*`)).toEqual([]);
    }, 30_000);
  });

  describe("given a run whose jobs keep running for longer than its wait", () => {
    /** @scenario "A step whose queue work keeps draining waits for it past its wait" */
    it("keeps waiting while the outstanding jobs change, and returns once all have run", async () => {
      const sender = createQueue({ listed: false });
      await sender.waitUntilReady();
      await createQueue({ listed: true }).waitUntilReady();
      // Eight one-second jobs, each caused by the last: about 8 s of work against a 6 s wait,
      // which the listed consumer's 5 s poll alone could otherwise run out.
      const report = await sender.runListedWork({
        name: "upgrade-step:d:slow",
        timeoutMs: 6_000,
        work: async () => {
          await sender.send({ id: "slow", groupId: "tenant-5/slow", takesMs: 1_000, chain: 7 });
          return { sent: 1 };
        },
      });

      expect(report).toEqual({ sent: 1 });
      expect(processed).toEqual(
        Array.from({ length: 8 }, (_, index) => `slow${"+".repeat(index)}`),
      );
      expect(await redis.keys(`${queueName}:gq:listed*`)).toEqual([]);
    }, 60_000);
  });

  describe("given no listed consumer runs the work", () => {
    /** @scenario "A step whose queue work stops draining fails that attempt and stays resumable" */
    it("refuses once the wait runs out, naming the group still waiting, and removes the list", async () => {
      const sender = createQueue({ listed: false });
      await sender.waitUntilReady();

      const refusal = await refusalOf(
        sender.runListedWork({
          name: "upgrade-step:c:stuck",
          timeoutMs: 300,
          work: () => sender.send({ id: "stuck", groupId: "tenant-4/command/stuck" }),
        }),
      );

      expect(refusal).toMatchObject({ operation: "runListedWork" });
      expect(String((refusal as Error).message)).toContain("still waiting: tenant-4/command/stuck");
      expect(await redis.keys(`${queueName}:gq:listed*`)).toEqual([]);
    });
  });

  describe("given a run that sends many pages, waiting for room for its own jobs", () => {
    /** @scenario "A listed run waits for room counting only its own jobs" */
    it("never has more than a page and the bound of its own jobs outstanding, whatever the backlog", async () => {
      const sender = await withBacklog();
      await createQueue({ listed: true }).waitUntilReady();
      const pages = 6;
      const pageSize = 100;
      let peak = 0;

      await sender.runListedWork({
        name: "upgrade-step:user:record-created-facts:run-1",
        timeoutMs: 20_000,
        work: async (list) => {
          for (let page = 0; page < pages; page++) {
            for (let row = 0; row < pageSize; row++) {
              const id = `row-${page}-${row}`;
              await sender.send({ id, groupId: `tenant-9/command/${id}` });
              peak = Math.max(peak, page * pageSize + row + 1 - processed.length);
            }
            await list?.waitForRoom({ maxOutstanding: pageSize });
          }
        },
      });

      expect(peak).toBeLessThanOrEqual(2 * pageSize);
      expect(processed).toHaveLength(pages * pageSize);
      expect(await redis.zcard(`${queueName}:gq:ready`)).toBeGreaterThanOrEqual(BACKLOG);
    }, 60_000);
  });
});
