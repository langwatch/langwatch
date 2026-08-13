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
  DEFAULT_CONFIRMED_DEATH_THRESHOLD,
  GroupStagingScripts,
} from "../scripts";
import {
  beaconKey,
  claimKey,
  confirmedDeaths as sharedConfirmedDeaths,
  seedDeadOwner as sharedSeedDeadOwner,
} from "./poisonGuardFixtures";

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
      // Before anything else: a suite that spies on GroupStagingScripts.prototype
      // (the beacon and release paths both do) would otherwise leave every later
      // queue in this file with a broken collaborator, and the failures land in
      // whichever test happens to run next rather than the one that set it up.
      vi.restoreAllMocks();
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

    const confirmedDeaths = (name: string, groupId: string) =>
      sharedConfirmedDeaths({ redis, queueName: name, groupId });
    const blockedMembers = (name: string) =>
      redis.smembers(`${name}:gq:blocked`);
    const storedError = (name: string, groupId: string) =>
      redis.hget(`${name}:gq:group:${groupId}:error`, "message");

    const seedDeadOwner = (name: string, groupId: string, deaths?: number) =>
      sharedSeedDeadOwner({ redis, queueName: name, groupId, deaths });

    describe("given a group at the confirmed-death threshold", () => {
      describe("when a worker claims the group again", () => {
        /** @scenario a group whose jobs repeatedly kill the worker is parked at claim */
        it("parks the group into the blocked set before decoding", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // A marker left by a claim whose process died before it could be
          // released - the crash-loop signature this guard detects.
          await seedDeadOwner(name, "poisoned");

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
          expect(error).toContain("confirmed worker deaths");
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

          await seedDeadOwner(name, "poisoned");

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

            // A dead owner and a death count well past the old default
            // threshold, which WOULD park the group if the guard were enabled.
            await seedDeadOwner(
              name,
              "poisoned",
              DEFAULT_CONFIRMED_DEATH_THRESHOLD + 5,
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
            // The marker is not enforced: recordClaim is skipped entirely when
            // the threshold is 0, so the pre-seeded count is left untouched
            // (never incremented past it, never released to a fresh value).
            expect(await confirmedDeaths(name, "poisoned")).toBe(
              String(DEFAULT_CONFIRMED_DEATH_THRESHOLD + 5),
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
        /** @scenario claim markers are released when processing survives */
        it("releases the claim marker", async () => {
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
              expect(await redis.exists(claimKey(name, "group-a"))).toBe(0);
            },
            { timeout: 5000, interval: 50 },
          );
        });
      });
    });

    /** The identity a queue stamps onto the claims it takes. */
    const workerIdOf = (queue: GroupQueueProcessor<TestPayload>) =>
      (queue as unknown as { workerId: string }).workerId;

    describe("given a graceful shutdown with a job in flight", () => {
      describe("when close() begins while the handler is still running", () => {
        /** @scenario graceful shutdown mid-job does not count as a confirmed death */
        it("publishes the retirement tombstone before the drain begins", async () => {
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
          const workerId = workerIdOf(queue);

          await queue.send({ id: "job-1", groupId: "slow", value: "x" });
          await handlerEntered;

          // The claim stamped this worker onto the group, and the worker is
          // vouching for itself. This is the marker a hard death leaves behind.
          expect(await redis.hget(claimKey(name, "slow"), "owner")).toBe(
            workerId,
          );
          expect(await redis.get(beaconKey(name, workerId))).toBe("alive");

          // Begin the graceful shutdown WITHOUT waiting for the drain: the
          // tombstone must land while the job is still in flight, so even a
          // drain the budget abandons answers for every marker left behind.
          const closing = queue.close();
          await vi.waitFor(
            async () => {
              expect(await redis.get(beaconKey(name, workerId))).toBe(
                "retired",
              );
            },
            { timeout: 5000, interval: 50 },
          );

          releaseHandler();
          await closing;

          expect(await blockedMembers(name)).not.toContain("slow");
        });
      });

      describe("when a later worker inherits a retired worker's claim", () => {
        /** @scenario a claim left behind by a gracefully retired worker is not a death */
        it("reads the previous owner as retired rather than dead", async () => {
          const { queue: retiring, name } = createQueue(async () => {});
          await retiring.waitUntilReady();
          const retiredWorkerId = workerIdOf(retiring);
          await retiring.close();

          // A claim the retired worker still owned when it exited, already one
          // death short of the threshold: if retirement did not answer for it,
          // the very next claim would park the group.
          await redis.hset(claimKey(name, "inherited"), {
            owner: retiredWorkerId,
            deaths: String(DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1),
            stagedJobId: "staged-before-the-retirement",
          });

          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const successor = new GroupQueueProcessor<TestPayload>(
            createQueueDefinition({ name, process: processed }),
            redis,
          );
          queues.push(successor);
          await successor.waitUntilReady();

          await successor.send({
            id: "job-1",
            groupId: "inherited",
            value: "x",
          });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("inherited");
        });
      });
    });

    describe("given a claim that changed hands while the first worker ran on", () => {
      describe("when the first worker finally releases", () => {
        // Heartbeat failures are warn-and-continue, so a worker paused or
        // partitioned past the active-key TTL keeps running while its group is
        // redispatched. An unconditional release then deletes the NEW owner's
        // marker, taking the group's accrued deaths with it — a poisoned group
        // silently loses its progress toward the threshold.
        /** @scenario a worker releases only a claim it still owns */
        it("leaves the new owner's claim and death count intact", async () => {
          const { queue, name } = createQueue(async () => {});
          await queue.waitUntilReady();
          const scripts = new GroupStagingScripts(redis, name);

          const staleWorker = "worker-that-outlived-its-lease";
          const currentWorker = "worker-that-took-over";

          // The stale worker's claim, then the handover to the current one.
          await redis.set(beaconKey(name, staleWorker), "alive", "EX", 90);
          await redis.set(beaconKey(name, currentWorker), "alive", "EX", 90);
          await scripts.recordClaim({
            groupId: "handed-over",
            workerId: staleWorker,
            stagedJobId: "job-1",
          });
          await scripts.recordClaim({
            groupId: "handed-over",
            workerId: currentWorker,
            stagedJobId: "job-2",
          });
          await redis.hset(
            claimKey(name, "handed-over"),
            "deaths",
            String(DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1),
          );

          // The stale worker's job returns at last and releases.
          await scripts.releaseClaim({
            groupId: "handed-over",
            workerId: staleWorker,
          });

          expect(await redis.hget(claimKey(name, "handed-over"), "owner")).toBe(
            currentWorker,
          );
          expect(await confirmedDeaths(name, "handed-over")).toBe(
            String(DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1),
          );

          // The count survived, so the current owner's death is still counted.
          await redis.del(beaconKey(name, currentWorker));
          const { deaths } = await scripts.recordClaim({
            groupId: "handed-over",
            workerId: "worker-after-the-death",
            stagedJobId: "job-3",
          });
          expect(deaths).toBe(DEFAULT_CONFIRMED_DEATH_THRESHOLD);
        });

        /** @scenario a worker releases only a claim it still owns */
        it("still releases the marker when the owner has not changed", async () => {
          const { queue, name } = createQueue(async () => {});
          await queue.waitUntilReady();
          const scripts = new GroupStagingScripts(redis, name);

          await redis.set(beaconKey(name, "sole-worker"), "alive", "EX", 90);
          await scripts.recordClaim({
            groupId: "sole-owner",
            workerId: "sole-worker",
            stagedJobId: "job-1",
          });
          await scripts.releaseClaim({
            groupId: "sole-owner",
            workerId: "sole-worker",
          });

          expect(await redis.exists(claimKey(name, "sole-owner"))).toBe(0);
        });
      });
    });

    describe("given a worker whose own beacon write fails", () => {
      describe("when it claims a group one death short of the threshold", () => {
        // A worker that cannot publish its beacon cannot be vouched for. If it
        // stamped markers anyway, every peer inheriting one would read this
        // live worker as dead — the same false-park class this guard removes,
        // re-entered through the beacon write instead of the release. It sits
        // the guard out instead: a real death goes uncounted, which is the
        // cheap direction to be wrong in.
        /** @scenario a worker that cannot report itself as running enforces nothing */
        it("records no claim and parks nothing", async () => {
          vi.spyOn(
            GroupStagingScripts.prototype,
            "recordWorkerAlive",
          ).mockRejectedValue(new Error("redis unavailable"));
          const recordClaim = vi.spyOn(
            GroupStagingScripts.prototype,
            "recordClaim",
          );

          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedDeadOwner(name, "beaconless");
          await queue.send({ id: "job-1", groupId: "beaconless", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("beaconless");
          expect(recordClaim).not.toHaveBeenCalled();
          // The seeded marker is untouched: the worker neither took ownership
          // of it nor counted a death against it.
          expect(await confirmedDeaths(name, "beaconless")).toBe(
            String(DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1),
          );
        });
      });
    });

    describe("given a claim marker whose owner vanished without retiring", () => {
      describe("when another worker claims the same group", () => {
        /** @scenario a claim left behind by a worker that vanished without retiring is a death */
        it("books one death, and accumulates to the threshold", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // Well below the threshold, so this claim confirms a death but must
          // still run the job: the guard counts, it does not park on the first.
          await seedDeadOwner(name, "dying", 0);
          await queue.send({ id: "job-1", groupId: "dying", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("dying");

          // One more death on top of a count already at the threshold's edge
          // tips it over — the accumulation the guard exists to detect.
          await seedDeadOwner(
            name,
            "dying",
            DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1,
          );
          await queue.send({ id: "job-2", groupId: "dying", value: "x" });

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain("dying");
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe("given a worker that retired while holding a claim", () => {
      describe("when the claim marker is still within its own lifetime", () => {
        /** @scenario the retirement tombstone outlives the claim markers it answers for */
        it("keeps the tombstone alive longer than the marker it answers for", async () => {
          // Hold the job in flight so its marker is still there to measure —
          // a completed job releases the marker, which is the whole point of it.
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
          const workerId = workerIdOf(queue);

          // A real claim marker, written by the real claim path.
          await queue.send({ id: "job-1", groupId: "outlived", value: "x" });
          await handlerEntered;
          const markerTtl = await redis.ttl(claimKey(name, "outlived"));

          const closing = queue.close();
          await vi.waitFor(
            async () => {
              expect(await redis.get(beaconKey(name, workerId))).toBe(
                "retired",
              );
            },
            { timeout: 5000, interval: 50 },
          );
          const tombstoneTtl = await redis.ttl(beaconKey(name, workerId));
          releaseHandler();
          await closing;

          // If the tombstone expired first, a marker still naming this worker
          // would decay from "retired" into "no beacon" — a false death.
          expect(await redis.get(beaconKey(name, workerId))).toBe("retired");
          expect(tombstoneTtl).toBeGreaterThan(markerTtl);
        });
      });
    });

    describe("given a claim marker whose owner is still running", () => {
      describe("when another worker claims the same group", () => {
        /** @scenario a claim left behind by a worker that is still running is not a death */
        it("does not book a death against the group", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          // A peer that holds the marker and is provably alive — the shape a
          // lost release leaves behind, and the one that used to park healthy
          // groups roughly ten times a day in production.
          const livePeer = "peer-worker-still-running";
          await redis.set(beaconKey(name, livePeer), "alive", "EX", 90);
          await redis.hset(claimKey(name, "shared"), {
            owner: livePeer,
            deaths: String(DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1),
            stagedJobId: "staged-by-the-live-peer",
          });

          await queue.send({ id: "job-1", groupId: "shared", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("shared");
        });
      });
    });

    describe("given a claim marker owned by the claiming worker itself", () => {
      describe("when that worker re-claims the group after its lease lapsed", () => {
        /** @scenario a worker re-claiming its own lapsed lease is not a death */
        it("does not book a death against the group", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await redis.hset(claimKey(name, "self"), {
            owner: workerIdOf(queue),
            deaths: String(DEFAULT_CONFIRMED_DEATH_THRESHOLD - 1),
            stagedJobId: "staged-under-the-lapsed-lease",
          });

          await queue.send({ id: "job-1", groupId: "self", value: "x" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("self");
        });
      });
    });

    describe("given a worker whose claim release never reaches Redis", () => {
      describe("when it processes far more jobs for one group than the threshold", () => {
        // The regression that motivated the rewrite. Under the count-and-
        // subtract guard every dropped release was indistinguishable from a
        // worker death, so a healthy high-fan-out group parked itself after
        // `threshold` of them. Here the releases are dropped outright and the
        // group still has to survive, because the owner never stops being alive.
        /** @scenario a release that never reaches Redis does not park a healthy group */
        it("never parks the group", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          const internals = queue as unknown as {
            scripts: {
              releaseClaim: (params: {
                groupId: string;
                workerId: string;
              }) => Promise<void>;
            };
          };
          vi.spyOn(internals.scripts, "releaseClaim").mockResolvedValue(
            undefined,
          );

          const jobs = DEFAULT_CONFIRMED_DEATH_THRESHOLD * 3;
          for (let i = 0; i < jobs; i++) {
            await queue.send({
              id: `job-${i}`,
              groupId: "leaky",
              value: "x",
            });
          }

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(jobs);
            },
            { timeout: 10000, interval: 50 },
          );
          expect(await blockedMembers(name)).not.toContain("leaky");
          // Every claim found the marker's owner alive, so nothing accrued.
          expect(await confirmedDeaths(name, "leaky")).toBe("0");
        });
      });
    });

    describe("given a group being parked by the poison guard", () => {
      describe("when the park completes", () => {
        /** @scenario parking a group releases its claim marker */
        it("releases the claim marker so an unblock gets a fresh run", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedDeadOwner(name, "parked");
          await queue.send({ id: "job-1", groupId: "parked", value: "x" });

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain("parked");
            },
            { timeout: 5000, interval: 50 },
          );

          // Left at the threshold, an operator unblocking inside the marker's
          // hour would have the group re-park on its very next claim.
          await vi.waitFor(
            async () => {
              expect(await redis.exists(claimKey(name, "parked"))).toBe(0);
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
        /** @scenario a failing-but-not-crashing job does not accumulate confirmed deaths */
        it("releases the marker recorded for that claim", async () => {
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

          // The failure path survives the process, so the claim marker is
          // released - retries are accounted by the retry budget, not by the
          // poison guard.
          await vi.waitFor(
            async () => {
              expect(await redis.exists(claimKey(name, "group-a"))).toBe(0);
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
        it("resets the death count and returns the group to dispatch", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedDeadOwner(name, "poisoned");
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
          expect(await redis.exists(claimKey(name, "poisoned"))).toBe(0);

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
        /** @scenario draining a parked poison group resets its confirmed death count */
        it("resets the strikes so a re-created group dispatches normally", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedDeadOwner(name, "poisoned");
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
          expect(await redis.exists(claimKey(name, "poisoned"))).toBe(0);
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
        /** @scenario moving a parked poison group to the dead-letter queue resets its confirmed death count */
        it("resets the strikes so a re-created group dispatches normally", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const { queue, name } = createQueue(processed);
          await queue.waitUntilReady();

          await seedDeadOwner(name, "poisoned");
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
          expect(await redis.exists(claimKey(name, "poisoned"))).toBe(0);
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
