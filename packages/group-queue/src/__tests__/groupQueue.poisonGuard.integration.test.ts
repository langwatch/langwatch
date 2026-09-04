import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts";
import { GroupQueueProcessor } from "../groupQueue";
import { DEFAULT_CONFIRMED_DEATH_THRESHOLD, GroupStagingScripts } from "../scripts";
import { beaconKey, claimKey, confirmedDeaths as sharedConfirmedDeaths, seedDeadOwner as sharedSeedDeadOwner } from "./poisonGuardFixtures";

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
};

function createQueueDefinition(
  overrides: Partial<GroupQueueRuntimeDefinition<TestPayload>> & {
    process: (payload: TestPayload) => Promise<void>;
  },
): GroupQueueRuntimeDefinition<TestPayload> {
  return {
    name: `{test/gqpoison/${crypto.randomUUID().slice(0, 8)}}`,
    groupKey: (p) => p.groupId,
    identify: (p) => p.id,
    ...overrides,
  };
}

describe("GroupQueueProcessor - Poison guard", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(() => {
    redis = new IORedis(
      process.env.REDIS_URL ?? process.env.LANGWATCH_TEST_REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
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
    await redis.quit();
  });

  function createQueue(
    processFn: (payload: TestPayload) => Promise<void>,
    overrides?: Partial<GroupQueueRuntimeDefinition<TestPayload>>,
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
  const blockedMembers = (name: string) => redis.smembers(`${name}:gq:blocked`);

  const seedDeadOwner = (name: string, groupId: string, deaths?: number) =>
    sharedSeedDeadOwner({ redis, queueName: name, groupId, deaths });

  /** The identity a queue stamps onto the claims it takes. */
  const workerIdOf = (queue: GroupQueueProcessor<TestPayload>) =>
    (queue as unknown as { workerId: string }).workerId;

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
        vi.spyOn(GroupStagingScripts.prototype, "recordWorkerAlive").mockRejectedValue(
          new Error("redis unavailable"),
        );
        const recordClaim = vi.spyOn(GroupStagingScripts.prototype, "recordClaim");

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

  describe("given a worker that retired while holding a claim", () => {
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
        expect(await redis.hget(claimKey(name, "slow"), "owner")).toBe(workerId);
        expect(await redis.get(beaconKey(name, workerId))).toBe("alive");

        // Begin the graceful shutdown WITHOUT waiting for the drain: the
        // tombstone must land while the job is still in flight, so even a
        // drain the budget abandons answers for every marker left behind.
        const closing = queue.close();
        await vi.waitFor(
          async () => {
            expect(await redis.get(beaconKey(name, workerId))).toBe("retired");
          },
          { timeout: 5000, interval: 50 },
        );

        releaseHandler();
        await closing;

        expect(await blockedMembers(name)).not.toContain("slow");
      });
    });

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
            expect(await redis.get(beaconKey(name, workerId))).toBe("retired");
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

        await successor.send({ id: "job-1", groupId: "inherited", value: "x" });

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

        expect(await redis.hget(claimKey(name, "handed-over"), "owner")).toBe(currentWorker);
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
            releaseClaim: (params: { groupId: string; workerId: string }) => Promise<void>;
          };
        };
        vi.spyOn(internals.scripts, "releaseClaim").mockResolvedValue(undefined);

        const jobs = DEFAULT_CONFIRMED_DEATH_THRESHOLD * 3;
        for (let i = 0; i < jobs; i++) {
          await queue.send({ id: `job-${i}`, groupId: "leaky", value: "x" });
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
});
