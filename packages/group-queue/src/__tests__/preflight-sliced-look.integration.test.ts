import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { GroupStagingScripts, PREFLIGHT_GROUPS_PER_CALL } from "../scripts.ts";

type TestPayload = { id: string; groupId: string };

/**
 * G4-F3: the barrier's look once ran as one script over every target group and held
 * Redis for 70 s at cloud scale. These drive the sliced look against real Redis.
 */
describe("GroupStagingScripts - sliced preflight look", () => {
  let redis: Redis;
  let queueName: string;

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queueName = `{test/gqslicedlook/${crypto.randomUUID().slice(0, 8)}}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Scoped to this suite's own namespace, never flushdb().
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${queueName}*`, "COUNT", 1000);
      cursor = next;
      if (keys.length > 0) await redis.unlink(...keys);
    } while (cursor !== "0");
  });

  afterAll(async () => {
    await redis.quit();
  });

  function targetKey(): string {
    return `${queueName}:gq:preflight`;
  }

  function groupKey(groupId: string): string {
    return `${queueName}:gq:group:${groupId}`;
  }

  async function seedTargets(count: number): Promise<string[]> {
    const groupIds = Array.from({ length: count }, (_, index) => `g${index}`);
    for (let start = 0; start < count; start += 10_000) {
      await redis.sadd(targetKey(), ...groupIds.slice(start, start + 10_000));
    }
    return groupIds;
  }

  /** Every group id each inspection script call was handed, by call. */
  function recordInspectionCalls(): number[] {
    const sizes: number[] = [];
    const original = redis.evalsha.bind(redis);
    vi.spyOn(redis, "evalsha").mockImplementation(((...args: unknown[]) => {
      const [, numKeys, firstKey, , thirdKey] = args;
      if (numKeys === 3 && firstKey === targetKey() && thirdKey === `${targetKey()}:baseline`) {
        sizes.push(args.length - 8);
      }
      return original(...(args as Parameters<typeof original>));
    }) as typeof redis.evalsha);
    return sizes;
  }

  describe("given a preflight whose 100,000 target groups hold outstanding work in some", () => {
    /** @scenario "The barrier looks at a large set of target groups in bounded slices" */
    it("reads no more than one slice of groups per script call and totals every group", async () => {
      const groupIds = await seedTargets(100_000);
      const pipeline = redis.pipeline();
      let pending = 0;
      for (let index = 0; index < groupIds.length; index += 1000) {
        const jobs = (index / 1000) % 3;
        for (let job = 0; job < jobs; job++) {
          pipeline.zadd(`${groupKey(groupIds[index]!)}:jobs`, job, `job-${index}-${job}`);
          pending++;
        }
      }
      pipeline.set(`${groupKey("g1")}:active`, "worker");
      pipeline.set(`${groupKey("g2")}:active`, "worker");
      pipeline.sadd(`${queueName}:gq:blocked`, "g3");
      await pipeline.exec();
      const sizes = recordInspectionCalls();

      const state = await new GroupStagingScripts(redis, queueName).inspectPreflightTargets(
        targetKey(),
      );

      expect(Math.max(...sizes)).toBeLessThanOrEqual(PREFLIGHT_GROUPS_PER_CALL);
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(100_000);
      expect(state).toMatchObject({
        groups: 100_000,
        pending,
        active: 2,
        blocked: 1,
        pendingGroups: 66 + 2,
        changedDuringInspection: false,
      });
    }, 120_000);

    /** @scenario "The barrier looks at a large set of target groups in bounded slices" */
    it("keeps a set within one slice to a single atomic look", async () => {
      await seedTargets(PREFLIGHT_GROUPS_PER_CALL);
      await redis.zadd(`${groupKey("g7")}:jobs`, 1, "job-7");
      const sizes = recordInspectionCalls();
      const sscan = vi.spyOn(redis, "sscan");

      const state = await new GroupStagingScripts(redis, queueName).inspectPreflightTargets(
        targetKey(),
      );

      expect(sizes).toEqual([0]);
      expect(sscan).not.toHaveBeenCalled();
      expect(state).toMatchObject({ groups: PREFLIGHT_GROUPS_PER_CALL, pending: 1 });
    });
  });

  describe("given the barrier part-way through a sliced look", () => {
    async function registerDuringFirstSlice(scripts: GroupStagingScripts): Promise<void> {
      const original = redis.sscan.bind(redis);
      let registered = false;
      vi.spyOn(redis, "sscan").mockImplementation(((...args: unknown[]) => {
        const page = original(...(args as Parameters<typeof original>));
        if (registered) return page;
        registered = true;
        return page.then(async (reply) => {
          await scripts.registerPreflightTargets({ targetKey: targetKey(), groupIds: ["late"] });
          return reply;
        });
      }) as typeof redis.sscan);
    }

    /** @scenario "A look that ran beside a new registration does not settle the barrier" */
    it("reports that the look ran beside a registration, and the next look does not", async () => {
      await seedTargets(2 * PREFLIGHT_GROUPS_PER_CALL);
      const scripts = new GroupStagingScripts(redis, queueName);
      await registerDuringFirstSlice(scripts);

      const raced = await scripts.inspectPreflightTargets(targetKey());
      const quiet = await scripts.inspectPreflightTargets(targetKey());

      expect(raced.changedDuringInspection).toBe(true);
      expect(quiet.changedDuringInspection).toBe(false);
    });

    /** @scenario "A look that ran beside a new registration does not settle the barrier" */
    it("does not settle the barrier on that look, and settles on the next quiet one", async () => {
      await seedTargets(2 * PREFLIGHT_GROUPS_PER_CALL);
      await registerDuringFirstSlice(new GroupStagingScripts(redis, queueName));
      const looks = vi.spyOn(GroupStagingScripts.prototype, "inspectPreflightTargets");
      const definition: GroupQueueRuntimeDefinition<TestPayload> = {
        name: queueName,
        process: async () => {},
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
      };
      const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
        consumerEnabled: false,
        dispatchGroupAllowListKey: targetKey(),
        preflightDrainTimeoutMs: 30_000,
      });

      try {
        await queue.waitUntilPreflightIdle();
      } finally {
        await queue.close();
      }

      const states = await Promise.all(looks.mock.results.map((result) => result.value));
      expect(states.map((state) => state.changedDuringInspection)).toEqual([true, false]);
    });
  });
});
