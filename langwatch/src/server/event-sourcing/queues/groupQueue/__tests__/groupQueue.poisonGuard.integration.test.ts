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

    describe("given the failure-streak quarantine breaker", () => {
      const failStreakKey = (name: string, groupId: string) =>
        `${name}:gq:group:${groupId}:failstreak`;
      const ENV = "LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD";

      describe("when one group's jobs keep failing with no success", () => {
        /** @scenario a group that fails on every attempt without draining is quarantined */
        it("blocks the group so one poison producer can't monopolise the shared queue", async () => {
          const previous = process.env[ENV];
          process.env[ENV] = "2";
          try {
            const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
            processed.mockRejectedValue(new Error("downstream always down"));
            const { queue, name } = createQueue(processed);
            await queue.waitUntilReady();

            // Distinct jobs for ONE group, none of which can succeed. Each
            // failure adds to the group's streak; once it exceeds 2 the group is
            // blocked (via the exhausted-retry path) instead of churning — the
            // per-JOB maxAttempts cap never fires because these are fresh jobs.
            // (A generous timeout: failures accrue at the group's re-dispatch
            // cadence, not instantly.)
            for (let i = 0; i < 10; i++) {
              await queue.send({
                id: `job-${i}`,
                groupId: "runaway",
                value: "x",
              });
            }

            await vi.waitFor(
              async () => {
                expect(await blockedMembers(name)).toContain("runaway");
              },
              { timeout: 25000, interval: 100 },
            );

            const error = await storedError(name, "runaway");
            expect(error).toContain("quarantined");
            // The job is re-staged for inspection, not dropped.
            expect(
              await redis.zcard(`${name}:gq:group:runaway:jobs`),
            ).toBeGreaterThan(0);
          } finally {
            if (previous === undefined) delete process.env[ENV];
            else process.env[ENV] = previous;
          }
        });
      });

      describe("given the quarantine kill switch is set to 0", () => {
        /** @scenario the failure-streak quarantine is disabled by setting the threshold to 0 */
        it("keeps dispatching a persistently-failing group instead of quarantining it", async () => {
          const previous = process.env[ENV];
          process.env[ENV] = "0";
          try {
            const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
            processed.mockRejectedValue(new Error("downstream always down"));
            const { queue, name } = createQueue(processed);
            await queue.waitUntilReady();

            // Pre-seed a streak far above the old default; with the breaker off
            // it is never consulted and never enforced.
            await redis.set(failStreakKey(name, "runaway"), "999");
            for (let i = 0; i < 4; i++) {
              await queue.send({
                id: `job-${i}`,
                groupId: "runaway",
                value: "x",
              });
            }

            await vi.waitFor(
              () => {
                expect(processed).toHaveBeenCalled();
              },
              { timeout: 5000, interval: 50 },
            );
            // The group is retried, never parked into the blocked set.
            expect(await blockedMembers(name)).not.toContain("runaway");
          } finally {
            if (previous === undefined) delete process.env[ENV];
            else process.env[ENV] = previous;
          }
        });
      });

      describe("when a group's job succeeds", () => {
        /** @scenario a group's success clears its failure streak */
        it("clears the failure streak", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // A streak left by earlier failures, below the (default) threshold.
          await redis.set(failStreakKey(name, "group-a"), "2");
          await queue.send({ id: "job-1", groupId: "group-a", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          await vi.waitFor(
            async () => {
              expect(await redis.get(failStreakKey(name, "group-a"))).toBeNull();
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

      describe("when an operator drains it", () => {
        /** @scenario draining a parked poison group resets its claim strikes */
        it("resets the strikes so a re-created group dispatches normally", async () => {
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
          const { jobsRemoved } = await ops.drainGroup({
            queueName: name,
            groupId: "poisoned",
          });
          expect(jobsRemoved).toBeGreaterThan(0);
          expect(await redis.get(strikesKey(name, "poisoned"))).toBeNull();
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
