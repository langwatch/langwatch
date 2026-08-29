import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  QueueRedisRepository,
  RECONCILE_WRITE_LUA,
} from "../queue.repository";

const redisUrl = process.env.REDIS_URL ?? process.env.CI_REDIS_URL;
const hasRedis = !!redisUrl;

// Module-level incrementing counter for unique queue names — no Date.now() or random.
let queueCounter = 0;

describe.skipIf(!hasRedis)("QueueRedisRepository.tryReconcileTotalPending", () => {
  let redis: Redis;
  let repo: QueueRedisRepository;
  let queueName: string;
  let markerKey: string;

  beforeAll(() => {
    if (!redisUrl) {
      return;
    }

    redis = new IORedis(redisUrl);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  beforeEach(() => {
    repo = new QueueRedisRepository(redis);
    queueCounter++;
    queueName = `test-recon-${queueCounter}`;
    markerKey = `${queueName}:gq:stats:pending-recon-ts`;
  });

  describe("given the pending counter has drifted above ground truth", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile heals an over-counted pending counter to the live ground truth */
      it("heals the counter to ground truth and returns the drift", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;
        const groupAJobsKey = `${queueName}:gq:group:groupA:jobs`;
        const groupBJobsKey = `${queueName}:gq:group:groupB:jobs`;
        const readyKey = `${queueName}:gq:ready`;

        // Clear any leftover marker from a previous run
        await redis.del(markerKey);

        // Seed: group A has 3 jobs, group B has 2 jobs → ground truth = 5
        await redis.zadd(groupAJobsKey, 1000, "job-a1", 1001, "job-a2", 1002, "job-a3");
        await redis.zadd(groupBJobsKey, 2000, "job-b1", 2001, "job-b2");

        // Also add both groups to the ready zset (production shape)
        await redis.zadd(readyKey, 1, "groupA", 1, "groupB");

        // SET counter = 100 (drifted well above ground truth 5)
        await redis.set(counterKey, "100");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.counter).toBe(100);
        expect(result!.groundTruth).toBe(5);
        expect(result!.drift).toBe(95);

        // Counter must be healed to ground truth
        expect(await redis.get(counterKey)).toBe("5");
      });
    });
  });

  describe("given the counter already matches ground truth", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile returns zero drift when the counter is already accurate */
      it("returns zero drift and leaves the counter unchanged", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;
        const groupJobsKey = `${queueName}:gq:group:groupX:jobs`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed: 2 jobs in one group, counter = 2 (no drift)
        await redis.zadd(groupJobsKey, 1000, "job-x1", 1001, "job-x2");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupX");
        await redis.set(counterKey, "2");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.counter).toBe(2);
        expect(result!.groundTruth).toBe(2);
        expect(result!.drift).toBe(0);
        expect(await redis.get(counterKey)).toBe("2");
      });
    });
  });

  describe("given a reconcile already ran within the single-flight window", () => {
    describe("when reconcile runs again immediately", () => {
      /** @scenario Single-flight gate prevents a redundant reconcile within the same window */
      it("returns null on the second call and leaves the counter unchanged from the first heal", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;
        const groupJobsKey = `${queueName}:gq:group:groupY:jobs`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed: 1 job, counter = 999 (drifted)
        await redis.zadd(groupJobsKey, 1000, "job-y1");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupY");
        await redis.set(counterKey, "999");

        // First call — heals the counter
        const firstResult = await repo.tryReconcileTotalPending(queueName);
        expect(firstResult).not.toBeNull();
        expect(await redis.get(counterKey)).toBe("1");

        // Second call — marker key should still be set, so it is skipped
        const secondResult = await repo.tryReconcileTotalPending(queueName);
        expect(secondResult).toBeNull();

        // Counter must be unchanged from the first heal
        expect(await redis.get(counterKey)).toBe("1");
      });
    });
  });

  describe("given the pending counter is below the actual number of jobs", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile corrects an under-counted pending counter upward to ground truth */
      it("heals the counter upward and returns negative drift", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed 7 jobs across groups
        await redis.zadd(`${queueName}:gq:group:ga:jobs`, 1, "j1", 2, "j2", 3, "j3");
        await redis.zadd(`${queueName}:gq:group:gb:jobs`, 4, "j4", 5, "j5");
        await redis.zadd(`${queueName}:gq:group:gc:jobs`, 6, "j6", 7, "j7");
        await redis.zadd(`${queueName}:gq:ready`, 1, "ga", 1, "gb", 1, "gc");

        // SET counter = 3 (under-counted)
        await redis.set(counterKey, "3");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.counter).toBe(3);
        expect(result!.groundTruth).toBe(7);
        expect(result!.drift).toBe(-4);

        // Counter must be healed upward to ground truth
        expect(await redis.get(counterKey)).toBe("7");
      });
    });
  });

  describe("given no group jobs remain in the queue", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile sets the counter to zero when no jobs remain */
      it("sets the counter to zero and returns the full positive drift", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed NO group:*:jobs keys — queue is empty
        await redis.set(counterKey, "50");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.groundTruth).toBe(0);
        expect(result!.drift).toBe(50);

        // Counter must be healed to zero
        expect(await redis.get(counterKey)).toBe("0");
      });
    });
  });

  describe("given groups held outside the ready set", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile counts blocked and parked groups alongside ready ones */
      it("counts the jobs of ready, blocked and parked groups", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);

        // A live group in ready, one held for operator triage in blocked, and
        // one deferred by the per-tenant cap into its tenant's parked set.
        await redis.zadd(`${queueName}:gq:group:tenant-a/ready:jobs`, 1, "j1");
        await redis.zadd(`${queueName}:gq:ready`, 1, "tenant-a/ready");

        await redis.zadd(`${queueName}:gq:group:tenant-a/blocked:jobs`, 1, "j2", 2, "j3");
        await redis.sadd(`${queueName}:gq:blocked`, "tenant-a/blocked");

        await redis.zadd(
          `${queueName}:gq:group:tenant-b/parked:jobs`,
          1,
          "j4",
          2,
          "j5",
          3,
          "j6",
        );
        await redis.zadd(`${queueName}:gq:parked:tenant-b`, 1, "tenant-b/parked");
        await redis.sadd(`${queueName}:gq:parked-tenants`, "tenant-b");

        await redis.set(counterKey, "0");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(6);
        expect(await redis.get(counterKey)).toBe("6");
      });
    });
  });

  describe("given a group that is in both the ready and blocked indexes", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile counts a group listed in two indexes only once */
      it("counts the group's jobs once", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);

        await redis.zadd(`${queueName}:gq:group:groupDup:jobs`, 1, "j1", 2, "j2");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupDup");
        await redis.sadd(`${queueName}:gq:blocked`, "groupDup");
        await redis.set(counterKey, "0");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(2);
      });
    });
  });

  describe("given a pass that ran past its single-flight window", () => {
    describe("when reconcile completes", () => {
      /** @scenario An overrunning reconcile releases the marker instead of holding it past the window */
      it("releases the marker so the next cycle can start immediately", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);
        await redis.zadd(`${queueName}:gq:group:groupZ:jobs`, 1, "j1");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupZ");
        await redis.set(counterKey, "9");

        // A zero-length window is the same state a pass reaches by outliving
        // its window: nothing of it remains to hand back.
        const result = await repo.tryReconcileTotalPending(queueName, 0);

        expect(result).not.toBeNull();
        expect(await redis.exists(markerKey)).toBe(0);

        // The next cycle is free to run rather than being told to wait.
        expect(await repo.tryReconcileTotalPending(queueName)).not.toBeNull();
      });
    });
  });

  describe("given a group listed only in the pending index", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A group counted from the pending index needs no lifecycle membership" */
      it("counts its jobs without it appearing in ready, blocked or parked", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);

        // Exactly the state a group is in while it moves between lifecycle
        // indexes: holding jobs, in none of them.
        await redis.zadd(
          `${queueName}:gq:group:tenant-a/in-flight-move:jobs`,
          1,
          "j1",
          2,
          "j2",
          3,
          "j3",
        );
        await redis.sadd(`${queueName}:gq:pending-groups`, "tenant-a/in-flight-move");
        await redis.set(counterKey, "0");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(3);
        expect(await redis.get(counterKey)).toBe("3");
      });
    });
  });

  describe("given a drained group still listed in the pending index", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A drained group is dropped from the pending index" */
      it("prunes the drained group but keeps one that still holds jobs", async () => {
        const indexKey = `${queueName}:gq:pending-groups`;

        await redis.del(markerKey, indexKey);

        // No jobs zset at all: the shape left behind when the safety-net TTL
        // expires a group's jobs without any script running.
        await redis.sadd(indexKey, "tenant-a/drained");
        await redis.zadd(`${queueName}:gq:group:tenant-a/live:jobs`, 1, "still-here");
        await redis.sadd(indexKey, "tenant-a/live");
        await redis.set(`${queueName}:gq:stats:total-pending`, "0");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(1);
        expect((await redis.smembers(indexKey)).sort()).toEqual(["tenant-a/live"]);
      });
    });
  });

  describe("given a group the pending index has not learned about yet", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A group known only to the lifecycle indexes is adopted into the pending index" */
      it("counts it and adopts it, so later passes read it from the index", async () => {
        const indexKey = `${queueName}:gq:pending-groups`;

        // Queue names repeat across runs of this suite, so clear the index this
        // test asserts is empty rather than trusting a previous run left nothing.
        await redis.del(markerKey, indexKey);

        // The shape left by a pod on the previous release, or by anything staged
        // before the index existed: jobs and lifecycle membership, no index entry.
        await redis.zadd(`${queueName}:gq:group:legacy-group:jobs`, 1, "j1", 2, "j2");
        await redis.zadd(`${queueName}:gq:ready`, 1, "legacy-group");
        await redis.set(`${queueName}:gq:stats:total-pending`, "0");

        expect(await redis.exists(indexKey)).toBe(0);

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(2);
        // Adopted, so it no longer depends on the sequential lifecycle read.
        expect(await redis.sismember(indexKey, "legacy-group")).toBe(1);
      });
    });
  });

  describe("given a group that no index lists at all", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A group no index lists is still counted and adopted" */
      it("finds it in the keyspace, counts it, and adopts it", async () => {
        const indexKey = `${queueName}:gq:pending-groups`;

        await redis.del(markerKey, indexKey);

        // Holding jobs, in neither the pending index nor any lifecycle index —
        // the state a group passes through while it moves between them.
        await redis.zadd(
          `${queueName}:gq:group:orphan-mover:jobs`,
          1,
          "j1",
          2,
          "j2",
          3,
          "j3",
        );
        await redis.set(`${queueName}:gq:stats:total-pending`, "0");

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(3);
        expect(await redis.sismember(indexKey, "orphan-mover")).toBe(1);
      });
    });
  });

  describe("given another instance holds the single-flight marker", () => {
    describe("when a reconcile is declined", () => {
      /** @scenario A declined reconcile leaves the holder's marker untouched */
      it("leaves the holder's marker and its expiry alone", async () => {
        await redis.set(markerKey, "other-instance-token", "PX", 30_000);

        const result = await repo.tryReconcileTotalPending(queueName);

        expect(result).toBeNull();
        expect(await redis.get(markerKey)).toBe("other-instance-token");
        expect(await redis.pttl(markerKey)).toBeGreaterThan(0);
      });
    });
  });

  /**
   * Seed a queue so a reconcile measures exactly `drift`, then run one.
   *
   * `counter - groundTruth` is the drift, so the counter is seeded at
   * `jobs + drift` against `jobs` real jobs.
   */
  const reconcileWithDrift = async (params: {
    queue: string;
    jobs: number;
    drift: number;
    by?: QueueRedisRepository;
  }) => {
    const { queue, jobs, drift, by } = params;
    const prefix = `${queue}:gq:`;
    // The counter is read as `Math.max(0, ...)`, so a seeded counter below zero
    // silently becomes zero and the measured drift is not the requested one.
    const counter = jobs + drift;
    if (counter < 0) {
      throw new Error(`fixture asks for counter ${counter}; raise jobs above ${-drift}`);
    }
    // The test containers are reused between runs and the queue names come from
    // a per-process counter, so the same names recur. Clear everything this
    // fixture asserts on, or a previous run's published drift is still readable
    // and the assertions pass without this run having written anything.
    await redis.del(
      `${prefix}stats:pending-recon-ts`,
      `${prefix}stats:pending-drift`,
      `${prefix}stats:total-pending`,
      `${prefix}group:g:jobs`,
      `${prefix}ready`,
      `${prefix}pending-groups`,
    );
    for (let i = 0; i < jobs; i++) {
      await redis.zadd(`${prefix}group:g:jobs`, 1000 + i, `job-${i}`);
    }
    if (jobs > 0) await redis.zadd(`${prefix}ready`, 1, "g");
    await redis.set(`${prefix}stats:total-pending`, String(counter));
    return await (by ?? repo).tryReconcileTotalPending(queue);
  };

  describe("given one instance reconciled a queue and measured a drift", () => {
    describe("when a second instance that won no marker reports drift", () => {
      /** @scenario An instance that measured nothing reports the drift another instance measured */
      it("reports the same drift as the instance that measured it", async () => {
        const measured = await reconcileWithDrift({
          queue: queueName,
          jobs: 5,
          drift: 95,
        });
        expect(measured!.drift).toBe(95);

        // A second repository standing in for a second process. It wins no
        // marker (the first pass holds it for the rest of the window), so it
        // measures nothing of its own.
        const otherInstance = new QueueRedisRepository(redis);
        expect(await otherInstance.tryReconcileTotalPending(queueName)).toBeNull();

        expect(await otherInstance.readPublishedPendingDrift([queueName])).toBe(95);
      });
    });
  });

  // Runs the real script against real Redis. The reconcile unit suite drives a
  // fake that models these semantics, so reordering the script cannot fail it:
  // the fake would keep modelling the old order. This is the binding to the
  // script itself.
  describe("given the marker is held by somebody else", () => {
    describe("when the fenced write script runs", () => {
      /** @scenario A pass that loses the marker publishes neither the count nor the drift */
      it("writes neither the counter nor the drift", async () => {
        const prefix = `${queueName}:gq:`;
        const counterKey = `${prefix}stats:total-pending`;
        const driftKey = `${prefix}stats:pending-drift`;
        await redis.del(counterKey, driftKey);
        await redis.set(markerKey, "another-instances-token");

        const wrote = await redis.eval(
          RECONCILE_WRITE_LUA,
          3,
          markerKey,
          counterKey,
          driftKey,
          "our-token",
          "17",
          "35",
          "180000",
        );

        expect(Number(wrote)).toBe(0);
        expect(await redis.get(counterKey)).toBeNull();
        expect(await redis.get(driftKey)).toBeNull();
      });

      it("writes both once the marker is ours", async () => {
        const prefix = `${queueName}:gq:`;
        const counterKey = `${prefix}stats:total-pending`;
        const driftKey = `${prefix}stats:pending-drift`;
        await redis.del(counterKey, driftKey);
        await redis.set(markerKey, "our-token");

        const wrote = await redis.eval(
          RECONCILE_WRITE_LUA,
          3,
          markerKey,
          counterKey,
          driftKey,
          "our-token",
          "17",
          "35",
          "180000",
        );

        expect(Number(wrote)).toBe(1);
        expect(await redis.get(counterKey)).toBe("17");
        expect(await redis.get(driftKey)).toBe("35");
        expect(await redis.pttl(driftKey)).toBeGreaterThan(0);
      });
    });
  });

  describe("given one queue has published a drift and another never reconciled", () => {
    describe("when drift is reported", () => {
      /** @scenario A queue with no published drift does not suppress the queues that have one */
      it("still reports the drift of the queue that published one", async () => {
        const neverReconciled = `${queueName}-silent`;
        await redis.del(`${neverReconciled}:gq:stats:pending-drift`);
        await reconcileWithDrift({ queue: queueName, jobs: 2, drift: 7 });

        expect(await repo.readPublishedPendingDrift([neverReconciled, queueName])).toBe(
          7,
        );
      });

      it("survives a figure that is not a number at all", async () => {
        // The script only ever writes an integer, so this is reachable through
        // a hand-edited key rather than through the code. Worth a case anyway:
        // a total that gives up on one bad value reports the fleet as clean.
        const poked = `${queueName}-poked`;
        await redis.set(`${poked}:gq:stats:pending-drift`, "not-a-number");
        await reconcileWithDrift({ queue: queueName, jobs: 2, drift: 7 });

        expect(await repo.readPublishedPendingDrift([poked, queueName])).toBe(7);
      });

      it("survives a figure that is only partly a number", async () => {
        // The dangerous shape is not the one that fails to parse, it is the one
        // that half parses: a lenient read takes "7oops" as 7 and adds it, so a
        // value nobody measured is indistinguishable in the total from one
        // somebody did. Skipping it keeps "unusable" meaning the same thing.
        const partial = `${queueName}-partial`;
        await redis.set(`${partial}:gq:stats:pending-drift`, "7oops");
        await reconcileWithDrift({ queue: queueName, jobs: 2, drift: 7 });

        expect(await repo.readPublishedPendingDrift([partial, queueName])).toBe(7);
      });
    });
  });

  describe("given two queues whose drifts were measured by different instances", () => {
    describe("when either instance reports drift", () => {
      /** @scenario Drift is summed across queues whichever instance measured each one */
      it("reports the total across both queues", async () => {
        const second = `${queueName}-b`;
        // Opposing directions, measured by two different repository instances
        // standing in for two processes. A sum that let them cancel would
        // report 20; the tile is meant to show total magnitude.
        const a = await reconcileWithDrift({
          queue: queueName,
          jobs: 4,
          drift: 30,
        });
        const b = await reconcileWithDrift({
          queue: second,
          jobs: 14,
          drift: -10,
          by: new QueueRedisRepository(redis),
        });
        expect([a!.drift, b!.drift]).toEqual([30, -10]);

        expect(await repo.readPublishedPendingDrift([queueName, second])).toBe(40);
      });
    });
  });
});
