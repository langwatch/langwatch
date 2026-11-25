import {
  type LiveSnapshot,
  tryParseDetailSnapshot,
  tryParseLiveSnapshot,
  SNAPSHOT_VERSION,
} from "@langwatch/ops-contract";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";

import {
  LEASE_TTL_SECONDS,
  SNAPSHOT_LEASE_KEY,
  RedisOpsSnapshotRepository,
} from "../redis.ops-snapshot.repository.ts";

/**
 * A Redis stand-in covering exactly the commands the repository issues, with
 * real GET/SET-NX/EVAL semantics for the lease. The lease's whole job is who
 * wins a race, so a mock that always says yes would test nothing.
 */
class FakeRedis {
  private store = new Map<string, string>();
  public evalCalls = 0;

  async set(...args: unknown[]): Promise<string | null> {
    const [key = "", value = "", , , nx] = args.map(String);
    if (nx === "NX" && this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }

  async get(key: unknown): Promise<string | null> {
    return this.store.get(String(key)) ?? null;
  }

  async incr(key: unknown): Promise<number> {
    const next = Number(this.store.get(String(key)) ?? 0) + 1;
    this.store.set(String(key), String(next));
    return next;
  }

  /** TTL, in seconds, of the most recent successful lease renewal. */
  public lastRenewTtlSeconds: number | null = null;

  async eval(...args: unknown[]): Promise<number> {
    this.evalCalls++;
    const [script = "", numKeys = "0", ...rest] = args.map(String);
    const keys = rest.slice(0, Number(numKeys));
    const argv = rest.slice(Number(numKeys));

    if (script.includes("DEL")) return this.release({ keys, argv });
    if (script.includes("EXPIRE")) return this.renew({ keys, argv });
    return this.writeFenced({ keys, argv });
  }

  private release({ keys, argv }: { keys: string[]; argv: string[] }): number {
    if (!this.ownsLease({ leaseKey: keys[0]!, token: argv[0]! })) return 0;
    this.store.delete(keys[0]!);
    return 1;
  }

  private renew({ keys, argv }: { keys: string[]; argv: string[] }): number {
    if (!this.ownsLease({ leaseKey: keys[0]!, token: argv[0]! })) return 0;
    this.lastRenewTtlSeconds = Number(argv[1]);
    return 1;
  }

  /** Refuses unless the lease is still ours and the payload is not older. */
  private writeFenced({ keys, argv }: { keys: string[]; argv: string[] }): number {
    const [artifactKey, leaseKey] = keys;
    const [payload, token, , computedAt] = argv;
    if (!this.ownsLease({ leaseKey: leaseKey!, token: token! })) return 0;
    if (this.isOlderThanStored({ key: artifactKey!, computedAt: computedAt! })) {
      return 0;
    }
    this.store.set(artifactKey!, payload!);
    return 1;
  }

  private ownsLease({ leaseKey, token }: { leaseKey: string; token: string }): boolean {
    return this.store.get(leaseKey) === token;
  }

  private isOlderThanStored({ key, computedAt }: { key: string; computedAt: string }): boolean {
    const existing = this.store.get(key);
    if (!existing) return false;
    const previous = Number((JSON.parse(existing) as { computedAt?: number }).computedAt);
    return Number.isFinite(previous) && previous > Number(computedAt);
  }

  /** Simulates the lease TTL elapsing without a graceful release. */
  expireLease(): void {
    this.store.delete(SNAPSHOT_LEASE_KEY);
  }

  /** Hands the lease to somebody else mid-cycle. */
  giveLeaseTo(writerId: string): void {
    this.store.set(SNAPSHOT_LEASE_KEY, writerId);
  }
}

/** The fake behind a real ioredis client that answers only these four commands. */
function redisOver(fake: FakeRedis): Redis {
  return redisDouble({
    get: (key) => fake.get(key),
    set: (...args) => fake.set(...args),
    incr: (key) => fake.incr(key),
    eval: (...args) => fake.eval(...args),
  });
}

const makeRepo = () => {
  const redis = new FakeRedis();
  return { redis, repo: RedisOpsSnapshotRepository.create(redisOver(redis)) };
};

const liveSnapshot = (over: { computedAt: number }): LiveSnapshot => ({
  version: SNAPSHOT_VERSION,
  computedAt: over.computedAt,
  writerId: "w",
  leaseEpoch: 1,
  queues: [],
  totalGroups: 0,
  totalPendingJobs: 0,
  pendingDrift: 0,
  throughputIngestedPerSec: 0,
  completedPerSec: 0,
  failedPerSec: 0,
  totalCompleted: 0,
  totalFailed: 0,
  peakCompletedPerSec: 0,
  peakFailedPerSec: 0,
  peakIngestedPerSec: 0,
  latencyP50Ms: 0,
  latencyP99Ms: 0,
  peakLatencyP50Ms: 0,
  peakLatencyP99Ms: 0,
  redisMemoryUsedBytes: 0,
  redisMemoryPeakBytes: 0,
  redisMemoryMaxBytes: 0,
  redisConnectedClients: 0,
  redisEngineCpuPercent: null,
  processCpuPercent: 0,
  processMemoryUsedMb: 0,
  processMemoryTotalMb: 0,
  pausedKeys: [],
  throughputHistory: [],
});

describe("RedisOpsSnapshotRepository", () => {
  describe("given two writers sharing one Redis", () => {
    describe("when both try to acquire the lease", () => {
      it("grants it to exactly one", async () => {
        const { redis } = makeRepo();
        const first = RedisOpsSnapshotRepository.create(redisOver(redis));
        const second = RedisOpsSnapshotRepository.create(redisOver(redis));

        const a = await first.acquireOrRenewLease({ writerId: "writer-a" });
        const b = await second.acquireOrRenewLease({ writerId: "writer-b" });

        expect(a.isHeld).toBe(true);
        expect(b.isHeld).toBe(false);
      });
    });

    describe("when the holder keeps renewing", () => {
      it("keeps the lease and its epoch", async () => {
        const { repo } = makeRepo();

        const first = await repo.acquireOrRenewLease({ writerId: "writer-a" });
        const second = await repo.acquireOrRenewLease({ writerId: "writer-a" });

        expect(second.isHeld).toBe(true);
        expect(second.epoch).toBe(first.epoch);
      });
    });
  });

  describe("given a holder that dies without releasing", () => {
    describe("when the lease TTL elapses", () => {
      /** @scenario "A new writer takes over when the holder stops renewing" */
      it("lets another writer acquire it under a new epoch", async () => {
        const { redis } = makeRepo();
        const dead = RedisOpsSnapshotRepository.create(redisOver(redis));
        const next = RedisOpsSnapshotRepository.create(redisOver(redis));

        const before = await dead.acquireOrRenewLease({ writerId: "dead" });
        redis.expireLease();
        const after = await next.acquireOrRenewLease({ writerId: "next" });

        expect(after.isHeld).toBe(true);
        expect(after.epoch).toBeGreaterThan(before.epoch);
      });
    });
  });

  describe("given a holder shutting down cleanly", () => {
    describe("when it releases the lease", () => {
      /** @scenario "Graceful shutdown releases the lease immediately" */
      it("frees it without waiting for the TTL", async () => {
        const { redis } = makeRepo();
        const leaving = RedisOpsSnapshotRepository.create(redisOver(redis));
        const arriving = RedisOpsSnapshotRepository.create(redisOver(redis));

        await leaving.acquireOrRenewLease({ writerId: "leaving" });
        await leaving.releaseLease();
        const taken = await arriving.acquireOrRenewLease({
          writerId: "arriving",
        });

        expect(taken.isHeld).toBe(true);
      });
    });
  });

  describe("given a writer that already lost the lease", () => {
    describe("when it tries to renew or release", () => {
      /** @scenario "Losing the lease mid-flight does not corrupt the snapshot" */
      it("does neither, leaving the new holder untouched", async () => {
        const { redis } = makeRepo();
        const lapsed = RedisOpsSnapshotRepository.create(redisOver(redis));
        const holder = RedisOpsSnapshotRepository.create(redisOver(redis));

        await lapsed.acquireOrRenewLease({ writerId: "lapsed" });
        redis.expireLease();
        const held = await holder.acquireOrRenewLease({ writerId: "holder" });

        const renewAttempt = await lapsed.acquireOrRenewLease({
          writerId: "lapsed",
        });
        await lapsed.releaseLease();

        expect(renewAttempt.isHeld).toBe(false);
        expect(await redis.get(SNAPSHOT_LEASE_KEY)).toBe(held.token);
      });
    });
  });

  describe("given a writer renewing on schedule", () => {
    describe("when the renewal lands", () => {
      it("restores the whole window rather than a fraction of it", async () => {
        // Renewing for less than the full TTL would let a writer that is alive
        // and renewing on schedule still lose the lease.
        const { redis, repo } = makeRepo();

        await repo.acquireOrRenewLease({ writerId: "writer-a" });
        await repo.acquireOrRenewLease({ writerId: "writer-a" });

        expect(redis.lastRenewTtlSeconds).toBe(LEASE_TTL_SECONDS);
      });
    });
  });

  describe("given a writer that lost the lease during its scan", () => {
    describe("when it publishes the payload it finished holding", () => {
      /** @scenario "A writer that lost the lease cannot overwrite its successor" */
      it("leaves the new writer's artifact in place", async () => {
        const { redis, repo } = makeRepo();

        const lease = await repo.acquireOrRenewLease({ writerId: "lapsed" });
        await repo.writeLive({
          leaseToken: lease.token!,
          snapshot: liveSnapshot({ computedAt: 1_000 }),
        });
        redis.giveLeaseTo("successor");

        const published = await repo.writeLive({
          leaseToken: lease.token!,
          snapshot: liveSnapshot({ computedAt: 2_000 }),
        });

        expect(published).toBe(false);
        expect(await repo.readLive()).toMatchObject({
          kind: "hit",
          snapshot: { computedAt: 1_000 },
        });
      });
    });
  });

  describe("given one pod that lost the lease and took it straight back", () => {
    describe("when a scan started under the OLD lease finishes", () => {
      /** @scenario "A scan cannot publish under a lease that turned over beneath it" */
      it("refuses the write even though the pod is the writer again", async () => {
        // The pod's identity is unchanged across the handover, so fencing on
        // the writer id would wave this through. Only a token minted per
        // acquisition can tell the two leases apart — and the stale scan's
        // computedAt is LATER, so the monotonic check cannot catch it either.
        const { redis, repo } = makeRepo();

        const oldLease = await repo.acquireOrRenewLease({ writerId: "pod-a" });
        redis.expireLease();
        const newLease = await repo.acquireOrRenewLease({ writerId: "pod-a" });
        expect(newLease.token).not.toBe(oldLease.token);

        await repo.writeLive({
          leaseToken: newLease.token!,
          snapshot: liveSnapshot({ computedAt: 1_000 }),
        });
        const published = await repo.writeLive({
          leaseToken: oldLease.token!,
          snapshot: liveSnapshot({ computedAt: 9_000 }),
        });

        expect(published).toBe(false);
        expect(await repo.readLive()).toMatchObject({
          kind: "hit",
          snapshot: { computedAt: 1_000 },
        });
      });
    });
  });

  describe("given two scans of one writer finishing out of order", () => {
    describe("when the slower, older one publishes last", () => {
      /** @scenario "An older snapshot never replaces a newer one" */
      it("keeps the newer artifact", async () => {
        const { repo } = makeRepo();

        const lease = await repo.acquireOrRenewLease({ writerId: "writer-a" });
        await repo.writeLive({
          leaseToken: lease.token!,
          snapshot: liveSnapshot({ computedAt: 5_000 }),
        });

        const published = await repo.writeLive({
          leaseToken: lease.token!,
          snapshot: liveSnapshot({ computedAt: 4_000 }),
        });

        expect(published).toBe(false);
        expect(await repo.readLive()).toMatchObject({
          kind: "hit",
          snapshot: { computedAt: 5_000 },
        });
      });
    });
  });
});

describe("parseSnapshot", () => {
  const validLive = liveSnapshot({ computedAt: 1 });

  describe("given a snapshot this reader understands", () => {
    it("returns it", () => {
      expect(tryParseLiveSnapshot(JSON.stringify(validLive))).not.toBeNull();
    });
  });

  describe("given a snapshot carrying an unknown version", () => {
    /** @scenario "A snapshot with an unknown version is treated as absent" */
    it("treats it as absent rather than coercing it", () => {
      const future = { ...validLive, version: SNAPSHOT_VERSION + 1 };
      expect(tryParseLiveSnapshot(JSON.stringify(future))).toBeNull();
    });
  });

  describe("given nothing stored at all", () => {
    it("returns null", () => {
      expect(tryParseLiveSnapshot(null)).toBeNull();
    });
  });

  describe("given malformed content", () => {
    it("returns null instead of throwing into the read path", () => {
      expect(tryParseLiveSnapshot("{not json")).toBeNull();
      expect(tryParseDetailSnapshot("[]")).toBeNull();
    });
  });

  /**
   * The readers poll one fixed key, validating the same string only once.
   * The risk: a missed rewrite would freeze the dashboard on old numbers,
   * looking like nothing was happening rather than a bug (the case below).
   */
  describe("given the same stored snapshot read twice", () => {
    /** @scenario "An unchanged snapshot is validated once and reused" */
    it("validates once and hands back the identical object", () => {
      const raw = JSON.stringify(liveSnapshot({ computedAt: 7 }));
      const first = tryParseLiveSnapshot(raw);
      const second = tryParseLiveSnapshot(raw);

      expect(first).not.toBeNull();
      expect(second).toBe(first);
    });
  });

  describe("given the stored snapshot changed between reads", () => {
    /** @scenario "A rewritten snapshot is picked up on the next read" */
    it("returns the new one rather than the one it validated before", () => {
      tryParseLiveSnapshot(JSON.stringify(liveSnapshot({ computedAt: 1 })));

      const next = tryParseLiveSnapshot(JSON.stringify(liveSnapshot({ computedAt: 2 })));

      expect(next?.computedAt).toBe(2);
    });
  });

  describe("given an unreadable snapshot followed by a good one", () => {
    /** @scenario "A rejected snapshot does not stop a later valid one being read" */
    it("reads the good one", () => {
      expect(tryParseDetailSnapshot("{not json")).toBeNull();

      const raw = JSON.stringify(liveSnapshot({ computedAt: 3 }));
      expect(tryParseLiveSnapshot(raw)?.computedAt).toBe(3);
    });
  });
});
