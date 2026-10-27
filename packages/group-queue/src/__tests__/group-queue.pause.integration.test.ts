/**
 * Consumer pause and resume driven against Redis: a paused consumer claims
 * nothing, finishes what it holds, and resumes in per-group order with every
 * job run exactly once. Spec: packages/eventing/specs/consumer-pause.feature
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitOptions = { timeout: 15_000, interval: 25 };

function heldGate(): { held: Promise<void>; release: () => void } {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

function idsByGroup(handled: TestPayload[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const payload of handled) (groups[payload.groupId] ??= []).push(payload.id);
  return groups;
}

describe("GroupQueueProcessor pause and resume", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queues = [];
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/pause/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function createQueue(
    processFn: (payload: TestPayload) => Promise<void>,
  ): Promise<GroupQueueProcessor<TestPayload>> {
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name: `{test/pause/${crypto.randomUUID().slice(0, 8)}}`,
      groupKey: (payload) => payload.groupId,
      identify: (payload) => payload.id,
      process: processFn,
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
      consumerEnabled: true,
    });
    queues.push(queue);
    await queue.waitUntilReady();
    return queue;
  }

  async function stage(
    queue: GroupQueueProcessor<TestPayload>,
    { groups, perGroup }: { groups: number; perGroup: number },
  ): Promise<TestPayload[]> {
    const staged: TestPayload[] = [];
    for (let index = 0; index < perGroup; index++) {
      for (let group = 0; group < groups; group++) {
        const payload = { id: `g${group}-${index}`, groupId: `g${group}` };
        staged.push(payload);
        await queue.send(payload);
      }
    }
    return staged;
  }

  describe("given a paused consumer", () => {
    /** @scenario "A paused group queue claims no job" */
    it("runs no handler for jobs staged while it stays paused", async () => {
      const handled: TestPayload[] = [];
      const queue = await createQueue(async (payload) => void handled.push(payload));
      queue.pause();

      await stage(queue, { groups: 3, perGroup: 2 });
      await settle(1_500);

      expect(handled).toEqual([]);
    });

    /** @scenario "A paused consumer closes promptly" */
    it("closes without waiting for a resume", async () => {
      const queue = await createQueue(async () => undefined);
      queue.pause();
      await settle(100);

      const startedAt = performance.now();
      await queue.close();

      expect(performance.now() - startedAt).toBeLessThan(5_000);
    });
  });

  describe("given a handler running a claimed job", () => {
    /** @scenario "A job running when the consumer pauses runs to completion" */
    it("completes that job and claims nothing more until resumed", async () => {
      const events: string[] = [];
      const gate = heldGate();
      const queue = await createQueue(async (payload) => {
        events.push(`start:${payload.id}`);
        if (payload.id === "running") await gate.held;
        events.push(`end:${payload.id}`);
      });

      await queue.send({ id: "running", groupId: "group-a" });
      await vi.waitFor(() => expect(events).toEqual(["start:running"]), waitOptions);

      queue.pause();
      await queue.send({ id: "next-in-group", groupId: "group-a" });
      await queue.send({ id: "other-group", groupId: "group-b" });
      gate.release();
      await vi.waitFor(() => expect(events).toContain("end:running"), waitOptions);
      await settle(1_500);

      expect(events).toEqual(["start:running", "end:running"]);

      queue.resume();
      await vi.waitFor(
        () =>
          expect(events).toEqual(expect.arrayContaining(["end:next-in-group", "end:other-group"])),
        waitOptions,
      );
    });
  });

  describe("given jobs for two groups staged while paused", () => {
    /** @scenario "Resuming drains the backlog in per-aggregate order" */
    it("runs every job once, each group in staging order", async () => {
      const handled: TestPayload[] = [];
      const queue = await createQueue(async (payload) => void handled.push(payload));
      queue.pause();
      const staged = await stage(queue, { groups: 2, perGroup: 5 });
      await settle(300);
      expect(handled).toEqual([]);

      queue.resume();

      await vi.waitFor(() => expect(handled).toHaveLength(staged.length), waitOptions);
      await settle(300);
      expect(idsByGroup(handled)).toEqual(idsByGroup(staged));
    });
  });

  describe("when the consumer is paused and resumed repeatedly while claiming", () => {
    /** @scenario "Toggling pause while jobs are claimed neither loses nor repeats a job" */
    it("runs every job exactly once, each group in staging order", async () => {
      const handled: TestPayload[] = [];
      const queue = await createQueue(async (payload) => {
        await settle(2);
        handled.push(payload);
      });
      const staged = await stage(queue, { groups: 6, perGroup: 10 });

      for (let toggle = 0; toggle < 60; toggle++) {
        queue.pause();
        await settle(Math.floor(Math.random() * 15));
        queue.resume();
        await settle(Math.floor(Math.random() * 15));
      }
      queue.resume();

      await vi.waitFor(() => expect(handled).toHaveLength(staged.length), waitOptions);
      await settle(500);
      expect(handled).toHaveLength(staged.length);
      expect(idsByGroup(handled)).toEqual(idsByGroup(staged));
    });
  });

  describe("when the consumer is paused twice and resumed twice", () => {
    /** @scenario "Pause and resume are idempotent" */
    it("claims and runs staged jobs as an unpaused consumer would", async () => {
      const handled: TestPayload[] = [];
      const queue = await createQueue(async (payload) => void handled.push(payload));
      queue.resume();
      queue.pause();
      queue.pause();
      queue.resume();
      queue.resume();

      const staged = await stage(queue, { groups: 2, perGroup: 3 });

      await vi.waitFor(() => expect(handled).toHaveLength(staged.length), waitOptions);
      expect(idsByGroup(handled)).toEqual(idsByGroup(staged));
    });
  });
});
