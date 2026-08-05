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
    name: `{test/gqpoison/${crypto.randomUUID().slice(0, 8)}}`,
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
      // Scoped to this suite's own namespace, never flushdb(). flushdb empties
      // the whole logical database, so it does not just reset this suite — it
      // deletes whatever another suite has in flight in the same database.
      // The failure then lands over there, in a file that never called it.
      const keys = await redis.keys("{test/gqpoison/*");
      if (keys.length > 0) await redis.del(...keys);
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

    describe("given a graceful shutdown with a job in flight", () => {
      describe("when close() begins while the handler is still running", () => {
        /** @scenario graceful shutdown mid-job does not count as a poison strike */
        it("sweeps the group's claim strike while the job is still in flight", async () => {
          let releaseHandler!: () => void;
          const handlerGate = new Promise<void>((resolve) => {
            releaseHandler = resolve;
          });
          let signalEntered!: () => void;
          const handlerEntered = new Promise<void>((resolve) => {
            signalEntered = resolve;
          });
          const { queue, name } = createQueue(async () => {
            signalEntered();
            await handlerGate;
          });
          await queue.waitUntilReady();

          await queue.send({ id: "job-1", groupId: "slow", value: "x" });
          await handlerEntered;

          // The claim recorded its strike before the handler ran — this is
          // the strike a hard death would leave behind.
          expect(await redis.get(strikesKey(name, "slow"))).toBe("1");

          // Begin the graceful shutdown WITHOUT waiting for the drain: the
          // sweep must clear the strike while the job is still in flight, so
          // even a drain the budget abandons leaves nothing behind.
          const closing = queue.close();
          await vi.waitFor(
            async () => {
              expect(await redis.get(strikesKey(name, "slow"))).toBeNull();
            },
            { timeout: 5000, interval: 50 },
          );

          releaseHandler();
          await closing;

          // The group was never mistaken for poison.
          expect(await blockedMembers(name)).not.toContain("slow");
        });
      });

      describe("when close() takes its sweep snapshot before the claim finishes recording", () => {
        /** @scenario graceful shutdown mid-job does not count as a poison strike */
        it("clears the strike via the post-claim recheck even though the sweep missed the group", async () => {
          let releaseStrike!: () => void;
          const strikeGate = new Promise<void>((resolve) => {
            releaseStrike = resolve;
          });
          let signalStrikeRecorded!: () => void;
          const strikeRecorded = new Promise<void>((resolve) => {
            signalStrikeRecorded = resolve;
          });
          let releaseHandler!: () => void;
          const handlerGate = new Promise<void>((resolve) => {
            releaseHandler = resolve;
          });
          let signalHandlerEntered!: () => void;
          const handlerEntered = new Promise<void>((resolve) => {
            signalHandlerEntered = resolve;
          });

          const { queue, name } = createQueue(async () => {
            signalHandlerEntered();
            await handlerGate;
          });
          await queue.waitUntilReady();

          const internals = queue as unknown as {
            scripts: {
              recordClaimStrike: (groupId: string) => Promise<number>;
            };
            drainAndDisconnect: () => Promise<void>;
          };

          // Park the claim AFTER its strike lands in Redis but BEFORE
          // processWithRetries adds the group to the in-flight set, so close()'s
          // sweep snapshot runs against a set that does not yet hold the group.
          const realRecordStrike = internals.scripts.recordClaimStrike.bind(
            internals.scripts,
          );
          let gatedOnce = false;
          vi.spyOn(internals.scripts, "recordClaimStrike").mockImplementation(
            async (groupId: string) => {
              const strikes = await realRecordStrike(groupId);
              if (groupId === "raced" && !gatedOnce) {
                gatedOnce = true;
                signalStrikeRecorded();
                await strikeGate;
              }
              return strikes;
            },
          );

          // drainAndDisconnect() is invoked synchronously right after the sweep
          // snapshot, so this fires only once close() has provably passed it -
          // with the group still unswept.
          let signalDrainReached!: () => void;
          const drainReached = new Promise<void>((resolve) => {
            signalDrainReached = resolve;
          });
          const realDrain = internals.drainAndDisconnect.bind(internals);
          internals.drainAndDisconnect = () => {
            signalDrainReached();
            return realDrain();
          };

          await queue.send({ id: "job-1", groupId: "raced", value: "x" });
          await strikeRecorded;
          // The strike a hard death would leave behind is present in Redis.
          expect(await redis.get(strikesKey(name, "raced"))).toBe("1");

          // Begin the shutdown: it flips shutdownRequested synchronously, then
          // snapshots the still-group-less in-flight set before the drain.
          const closing = queue.close();
          await drainReached;

          // Let the claim finish - it adds the group to the set now, after the
          // sweep already ran, then runs the shutdown recheck.
          releaseStrike();
          await handlerEntered;

          // The recheck cleared the strike while the handler is still in flight,
          // so a drain the budget abandons leaves nothing behind. Without it the
          // strike would survive until the finally the abandon path never runs.
          await vi.waitFor(
            async () => {
              expect(await redis.get(strikesKey(name, "raced"))).toBeNull();
            },
            { timeout: 5000, interval: 50 },
          );

          releaseHandler();
          await closing;

          // The group was never mistaken for poison.
          expect(await blockedMembers(name)).not.toContain("raced");
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
            // Cleared as the group parks, so an operator's unblock gets a fresh
            // run rather than re-quarantining on the very next failure.
            expect(await redis.get(failStreakKey(name, "runaway"))).toBeNull();
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
              expect(
                await redis.get(failStreakKey(name, "group-a")),
              ).toBeNull();
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
          // oversized one stays a staged sibling. Anything over the decode cap
          // is necessarily over the drain's byte budget too, so it is never
          // folded into a batch — it becomes its own dispatch and blows the
          // decode cap there. Both due now; the small one sorts first.
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

          // The byte budget kept the poison out of the batch: the small job's
          // work completed exactly once, and the oversized value was parked on
          // its own dispatch without ever being JSON-parsed — so no handler
          // saw anything but the small payload.
          const handledIds = [
            ...processed.mock.calls.map(([p]) => p.id),
            ...processBatch.mock.calls.flatMap(([ps]) => ps.map((p) => p.id)),
          ];
          expect(handledIds).toEqual(["job-small"]);
          const error = await storedError(name, "fat");
          expect(error).toContain("Poison guard");
          expect(error).toContain("parked unparsed");
          // The parked value is not lost: the group still holds it staged,
          // ready for operator inspection or replay on unblock, not dropped.
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
