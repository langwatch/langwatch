import type { Redis } from "ioredis";
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
import { QueueRedisRepository } from "../../../../app-layer/ops/repositories/queue.redis.repository";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { MAX_BLOB_BYTES } from "../blobConstants";
import { GroupQueueProcessor } from "../groupQueue";
import {
  DEFAULT_CLAIM_STRIKE_THRESHOLD,
  GroupStagingScripts,
} from "../scripts";

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
    const isolatingKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:isolating`;
    const blockedMembers = (name: string) =>
      redis.smembers(`${name}:gq:blocked`);
    const storedError = (name: string, groupId: string) =>
      redis.hget(`${name}:gq:group:${groupId}:error`, "message");

    /**
     * Seeds the death-in-isolation signature: the marker a prior isolation run
     * wrote (awaited) before the process died without reaching its clear.
     */
    const seedIsolationDeath = (name: string, groupId: string) =>
      redis.set(isolatingKey(name, groupId), "1");

    describe("given a group whose isolation marker survived a worker death", () => {
      describe("when a worker claims the group again", () => {
        /** @scenario a group that dies during an isolation run is parked at its next claim */
        it("parks the group into the blocked set before decoding", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedIsolationDeath(name, "poisoned");

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
          expect(error).toContain("running in isolation");
          // The job is re-staged for inspection, not dropped.
          expect(
            await redis.zcard(`${name}:gq:group:poisoned:jobs`),
          ).toBeGreaterThan(0);
        });

        /** @scenario a group that dies during an isolation run is parked at its next claim */
        it("keeps dispatching other groups normally", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedIsolationDeath(name, "poisoned");

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

    describe("given a group whose claim strikes exceed the poison threshold", () => {
      describe("when a worker claims the group", () => {
        /** @scenario a suspect group is run in isolation instead of being parked on strikes alone */
        it("runs the job in isolation and does not park the group", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // Strikes left behind by prior claims whose process died before the
          // clear could run - a signature every co-in-flight bystander of a
          // crash shares, so it selects for isolation, never parks directly.
          await redis.set(
            strikesKey(name, "suspect"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );

          await queue.send({ id: "job-1", groupId: "suspect", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed.mock.calls[0]![0].groupId).toBe("suspect");
          expect(await blockedMembers(name)).not.toContain("suspect");
        });

        /** @scenario a bystander that inherited strikes from another group's crashes heals */
        it("clears the strikes and the isolation marker after the solo run", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await redis.set(
            strikesKey(name, "bystander"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD + 2),
          );

          await queue.send({ id: "job-1", groupId: "bystander", value: "x" });

          await vi.waitFor(
            async () => {
              expect(processed).toHaveBeenCalledTimes(1);
              expect(await redis.get(strikesKey(name, "bystander"))).toBeNull();
              expect(
                await redis.get(isolatingKey(name, "bystander")),
              ).toBeNull();
            },
            { timeout: 5000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("bystander");
        });
      });
    });

    describe("given two groups whose claim strikes exceed the poison threshold", () => {
      describe("when the worker claims both", () => {
        /** @scenario a second suspect defers while an isolation run is active */
        it("processes both without parking either", async () => {
          // Both suspects race for the single per-process isolation slot: the
          // loser re-stages with backoff (a /iw/ deferral, not an /r/ retry)
          // and takes its own solo run afterwards. Neither may park.
          let release: () => void = () => void 0;
          const firstRunGate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockImplementation(async (payload) => {
            if (payload.groupId === "suspect-a") await firstRunGate;
          });
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await redis.set(
            strikesKey(name, "suspect-a"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );
          await redis.set(
            strikesKey(name, "suspect-b"),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );

          await queue.send({ id: "job-a", groupId: "suspect-a", value: "x" });
          await queue.send({ id: "job-b", groupId: "suspect-b", value: "y" });

          // Let the first suspect hold the isolation slot long enough for the
          // second to observe it and defer, then release.
          setTimeout(release, 500);

          await vi.waitFor(
            async () => {
              expect(
                processed.mock.calls.map((c) => c[0].groupId).sort(),
              ).toEqual(["suspect-a", "suspect-b"]);
              expect(await redis.get(strikesKey(name, "suspect-a"))).toBeNull();
              expect(await redis.get(strikesKey(name, "suspect-b"))).toBeNull();
            },
            { timeout: 10000, interval: 100 },
          );
          const blocked = await blockedMembers(name);
          expect(blocked).not.toContain("suspect-a");
          expect(blocked).not.toContain("suspect-b");
        });
      });
    });

    describe("given the strike-threshold kill switch is set to 0", () => {
      describe("when a group at the former threshold is claimed", () => {
        /** @scenario the poison guard is disabled by setting the strike threshold to 0 */
        it("dispatches the group instead of parking it", async () => {
          const previous = process.env.LANGWATCH_GQ_POISON_STRIKE_THRESHOLD;
          process.env.LANGWATCH_GQ_POISON_STRIKE_THRESHOLD = "0";
          try {
            const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
            processed.mockResolvedValue(undefined);
            const { queue, name } = createQueue(processed);
            await queue.waitUntilReady();

            // Strikes at (and above) the old default threshold that WOULD park
            // the group if the guard were enabled.
            await redis.set(
              strikesKey(name, "poisoned"),
              String(DEFAULT_CLAIM_STRIKE_THRESHOLD + 5),
            );

            await queue.send({ id: "job-1", groupId: "poisoned", value: "x" });

            // With the guard off, the group is claimed and processed normally.
            await vi.waitFor(
              () => {
                expect(processed).toHaveBeenCalledTimes(1);
              },
              { timeout: 5000, interval: 50 },
            );
            expect(processed.mock.calls[0]![0].groupId).toBe("poisoned");
            // The group is never parked into the blocked set.
            expect(await blockedMembers(name)).not.toContain("poisoned");
            // Strikes are not enforced: recordClaimStrike is skipped entirely
            // when the threshold is 0, so the pre-seeded count is left untouched
            // (never incremented past it, never cleared to a fresh value).
            expect(await redis.get(strikesKey(name, "poisoned"))).toBe(
              String(DEFAULT_CLAIM_STRIKE_THRESHOLD + 5),
            );
          } finally {
            if (previous === undefined) {
              delete process.env.LANGWATCH_GQ_POISON_STRIKE_THRESHOLD;
            } else {
              process.env.LANGWATCH_GQ_POISON_STRIKE_THRESHOLD = previous;
            }
          }
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

    describe("given a coalesced batch whose drained sibling is over the decode cap", () => {
      describe("when a worker claims the group and drains the sibling", () => {
        /** @scenario an oversized coalesced sibling parks the group without losing the batch */
        it("parks the group and re-stages the batch's other work", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const processBatch = vi.fn<(ps: TestPayload[]) => Promise<void>>();
          processBatch.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed, {
            processBatch: async (ps) => {
              await processBatch(ps as TestPayload[]);
            },
            coalesceMaxBatch: () => 50,
          });
          await queue.waitUntilReady();

          // Stage BOTH jobs atomically as legacy bare-JSON so the small one is
          // the dispatched job (earliest score) and decodes fine, while the
          // oversized one is drained as a coalesce sibling and blows the decode
          // cap. Both due now; the small one sorts first.
          const scripts = new GroupStagingScripts(redis, name);
          const now = Date.now();
          const small = JSON.stringify({
            id: "job-small",
            groupId: "fat",
            value: "ok",
          });
          const oversized = JSON.stringify({
            id: "job-big",
            groupId: "fat",
            value: "x".repeat(MAX_BLOB_BYTES + 1024),
          });
          await scripts.stageBatch([
            {
              stagedJobId: "job-small",
              groupId: "fat",
              dispatchAfterMs: now - 1000,
              dedupId: "",
              dedupTtlMs: 0,
              jobDataJson: small,
            },
            {
              stagedJobId: "job-big",
              groupId: "fat",
              dispatchAfterMs: now - 500,
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

          // The batch was parked before any handler ran (the oversized sibling
          // is never JSON-parsed, so neither process nor processBatch fires).
          expect(processed).not.toHaveBeenCalled();
          expect(processBatch).not.toHaveBeenCalled();
          const error = await storedError(name, "fat");
          expect(error).toContain("Poison guard");
          expect(error).toContain("parked unparsed");
          // The batch's other work is not lost: the group still holds staged
          // jobs (the re-staged siblings + the parked dispatched value), ready
          // for operator inspection or replay on unblock, not dropped.
          expect(
            await redis.zcard(`${name}:gq:group:fat:jobs`),
          ).toBeGreaterThan(0);
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

          await seedIsolationDeath(name, "poisoned");
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
          expect(await redis.get(isolatingKey(name, "poisoned"))).toBeNull();

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed.mock.calls[0]![0].groupId).toBe("poisoned");
        });
      });

      describe("when an operator drains it", () => {
        /** @scenario draining a parked poison group resets its claim strikes */
        it("resets the strikes so a re-created group dispatches normally", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedIsolationDeath(name, "poisoned");
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
          const { jobsRemoved } = await ops.drainGroup({
            queueName: name,
            groupId: "poisoned",
          });
          expect(jobsRemoved).toBeGreaterThan(0);
          expect(await redis.get(strikesKey(name, "poisoned"))).toBeNull();
          expect(await redis.get(isolatingKey(name, "poisoned"))).toBeNull();
          expect(await blockedMembers(name)).not.toContain("poisoned");

          // A new job under the same group id gets a fresh run instead of
          // insta-parking on the stale strike count.
          await queue.send({ id: "job-2", groupId: "poisoned", value: "y" });
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed.mock.calls[0]![0].id).toBe("job-2");
          expect(await blockedMembers(name)).not.toContain("poisoned");
        });
      });

      describe("when an operator moves it to the dead-letter queue", () => {
        /** @scenario moving a parked poison group to the dead-letter queue resets its claim strikes */
        it("resets the strikes so a re-created group dispatches normally", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedIsolationDeath(name, "poisoned");
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
          const { jobsMoved } = await ops.moveToDlq({
            queueName: name,
            groupId: "poisoned",
          });
          expect(jobsMoved).toBeGreaterThan(0);
          expect(await redis.get(strikesKey(name, "poisoned"))).toBeNull();
          expect(await redis.get(isolatingKey(name, "poisoned"))).toBeNull();
          expect(await blockedMembers(name)).not.toContain("poisoned");

          await queue.send({ id: "job-2", groupId: "poisoned", value: "y" });
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed.mock.calls[0]![0].id).toBe("job-2");
          expect(await blockedMembers(name)).not.toContain("poisoned");
        });
      });
    });
  },
);
