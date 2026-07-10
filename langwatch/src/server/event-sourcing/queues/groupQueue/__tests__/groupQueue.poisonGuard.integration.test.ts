import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Redis } from "ioredis";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import { QueueRedisRepository } from "../../../../app-layer/ops/repositories/queue.redis.repository";
import { GroupQueueProcessor } from "../groupQueue";
import { MAX_BLOB_BYTES } from "../blobConstants";
import {
  DEFAULT_CLAIM_STRIKE_THRESHOLD,
  GroupStagingScripts,
} from "../scripts";
import type { EventSourcedQueueDefinition } from "../../queue.types";

// Skip when running without testcontainers (unit-only test runs)
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
};

function createQueueDefinition(
  overrides: Partial<EventSourcedQueueDefinition<TestPayload>> & {
    process: (payload: TestPayload) => Promise<void>;
  },
): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/${crypto.randomUUID().slice(0, 8)}}`,
    groupKey: (p) => p.groupId,
    ...overrides,
  };
}

describe.skipIf(!hasTestcontainers)(
  "GroupQueueProcessor - Poison guard",
  () => {
    let redis: Redis;
    let queues: GroupQueueProcessor<TestPayload>[];

    beforeAll(async () => {
      await startTestContainers();
      redis = getTestRedisConnection()!;
    });

    beforeEach(() => {
      queues = [];
    });

    afterEach(async () => {
      await Promise.all(queues.map((q) => q.close().catch(() => {})));
      await redis.flushall();
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function createQueue(
      processFn: (payload: TestPayload) => Promise<void>,
      overrides?: Partial<EventSourcedQueueDefinition<TestPayload>>,
    ): { queue: GroupQueueProcessor<TestPayload>; name: string } {
      const definition = createQueueDefinition({
        process: processFn,
        ...overrides,
      });
      const queue = new GroupQueueProcessor<TestPayload>(definition, redis);
      queues.push(queue);
      return { queue, name: definition.name };
    }

    const strikesKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:strikes`;
    const blockedMembers = (name: string) =>
      redis.smembers(`${name}:gq:blocked`);
    const storedError = (name: string, groupId: string) =>
      redis.hget(`${name}:gq:group:${groupId}:error`, "message");

    describe("given a group at the claim-strike threshold", () => {
      describe("when a worker claims the group again", () => {
        /** @scenario a group whose jobs repeatedly kill the worker is parked at claim */
        it("parks the group into the blocked set before decoding", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // Strikes left behind by prior claims whose process died before the
          // clear could run - the crash-loop signature this guard detects.
          await redis.set(
            strikesKey(name, "poisoned"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );

          await queue.send({ id: "job-1", groupId: "poisoned", value: "x" });

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain("poisoned");
            },
            { timeout: 5000, interval: 50 },
          );

          expect(processed).not.toHaveBeenCalled();
          const error = await storedError(name, "poisoned");
          expect(error).toContain("Poison guard");
          expect(error).toContain("consecutive worker deaths");
          // The job is re-staged for inspection, not dropped.
          expect(
            await redis.zcard(`${name}:gq:group:poisoned:jobs`),
          ).toBeGreaterThan(0);
        });

        /** @scenario a group whose jobs repeatedly kill the worker is parked at claim */
        it("keeps dispatching other groups normally", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await redis.set(
            strikesKey(name, "poisoned"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );

          await queue.send({ id: "job-1", groupId: "poisoned", value: "x" });
          await queue.send({ id: "job-2", groupId: "healthy", value: "y" });

          await vi.waitFor(
            async () => {
              expect(processed).toHaveBeenCalledTimes(1);
              expect(await blockedMembers(name)).toContain("poisoned");
            },
            { timeout: 5000, interval: 50 },
          );

          expect(processed.mock.calls[0]![0].groupId).toBe("healthy");
        });
      });
    });

    describe("given a healthy group", () => {
      describe("when its job completes", () => {
        /** @scenario claim strikes are cleared when processing survives */
        it("clears the claim strike", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await queue.send({ id: "job-1", groupId: "group-a", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );

          await vi.waitFor(
            async () => {
              expect(await redis.get(strikesKey(name, "group-a"))).toBeNull();
            },
            { timeout: 5000, interval: 50 },
          );
        });
      });
    });

    describe("given a group whose job always throws", () => {
      describe("when an attempt fails with the process alive", () => {
        /** @scenario a failing-but-not-crashing job does not accumulate claim strikes */
        it("clears the strike recorded for that claim", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockRejectedValue(new Error("handler failure"));
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await queue.send({ id: "job-1", groupId: "group-a", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalled();
            },
            { timeout: 5000, interval: 50 },
          );

          // The failure path survives the process, so the claim strike is
          // cleared - retries are accounted by the retry budget, not by the
          // poison guard.
          await vi.waitFor(
            async () => {
              expect(await redis.get(strikesKey(name, "group-a"))).toBeNull();
            },
            { timeout: 5000, interval: 50 },
          );
        });
      });
    });

    describe("given a staged value over the decode cap", () => {
      describe("when a worker claims the group", () => {
        /** @scenario an oversized staged value is parked without being parsed */
        it("parks the group without parsing the value", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // Stage a legacy bare-JSON value over the cap directly through the
          // staging scripts - exactly the shape of values written before the
          // encode-side cap existed.
          const scripts = new GroupStagingScripts(redis, name);
          const oversized = JSON.stringify({
            id: "job-big",
            groupId: "fat",
            value: "x".repeat(MAX_BLOB_BYTES + 1024),
          });
          await scripts.stageBatch([
            {
              stagedJobId: "job-big",
              groupId: "fat",
              dispatchAfterMs: Date.now(),
              dedupId: "",
              dedupTtlMs: 0,
              jobDataJson: oversized,
            },
          ]);

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain("fat");
            },
            { timeout: 10000, interval: 100 },
          );

          expect(processed).not.toHaveBeenCalled();
          const error = await storedError(name, "fat");
          expect(error).toContain("Poison guard");
          expect(error).toContain("parked unparsed");
        });
      });
    });

    describe("given a parked poison group", () => {
      describe("when an operator unblocks it", () => {
        /** @scenario a parked poison group can be unblocked by an operator */
        it("resets the strikes and returns the group to dispatch", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await redis.set(
            strikesKey(name, "poisoned"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );
          await queue.send({ id: "job-1", groupId: "poisoned", value: "x" });

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain("poisoned");
            },
            { timeout: 5000, interval: 50 },
          );

          const ops = new QueueRedisRepository(redis);
          const { wasBlocked } = await ops.unblockGroup({
            queueName: name,
            groupId: "poisoned",
          });
          expect(wasBlocked).toBe(true);
          expect(await redis.get(strikesKey(name, "poisoned"))).toBeNull();

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed.mock.calls[0]![0].groupId).toBe("poisoned");
        });
      });
    });
  },
);
