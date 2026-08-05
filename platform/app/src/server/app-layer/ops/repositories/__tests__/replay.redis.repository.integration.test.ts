import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { ReplayRedisRepository } from "../replay.redis.repository";

// Exercises the refreshLock Lua check-and-extend script against a real Redis,
// so the KEYS/ARGV wiring and integer-reply handling stay honest. The unit
// tests cover the service via an in-memory fake that reimplements these
// semantics — a script bug would slip past them silently.
const REPLAY_LOCK_KEY = "ops:replay:lock";

const HOLDER_RUN_ID = "run-holder";
const OTHER_RUN_ID = "run-intruder";
const INITIAL_TTL_SECONDS = 30;
const EXTENDED_TTL_SECONDS = 120;

let redis: Redis;
let repository: ReplayRedisRepository;

async function clearReplayKeys() {
  const keys = await redis.keys("ops:replay:*");
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
  repository = new ReplayRedisRepository(redis);
  await clearReplayKeys();
});

afterEach(async () => {
  await clearReplayKeys();
});

afterAll(async () => {
  await stopTestContainers();
});

describe("ReplayRedisRepository refreshLock", () => {
  describe("given a lock held by a run", () => {
    describe("when the holder refreshes the lock", () => {
      it("returns true and extends the key TTL", async () => {
        await repository.acquireLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: INITIAL_TTL_SECONDS,
        });

        const refreshed = await repository.refreshLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: EXTENDED_TTL_SECONDS,
        });

        expect(refreshed).toBe(true);
        const ttl = await redis.ttl(REPLAY_LOCK_KEY);
        expect(ttl).toBeGreaterThan(INITIAL_TTL_SECONDS);
        expect(ttl).toBeLessThanOrEqual(EXTENDED_TTL_SECONDS);
      });
    });

    describe("when a different run attempts a refresh", () => {
      it("returns false and leaves the TTL unchanged", async () => {
        await repository.acquireLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: INITIAL_TTL_SECONDS,
        });

        const refreshed = await repository.refreshLock({
          runId: OTHER_RUN_ID,
          ttlSeconds: EXTENDED_TTL_SECONDS,
        });

        expect(refreshed).toBe(false);
        const ttl = await redis.ttl(REPLAY_LOCK_KEY);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(INITIAL_TTL_SECONDS);
      });

      it("keeps the original holder on the lock", async () => {
        await repository.acquireLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: INITIAL_TTL_SECONDS,
        });

        await repository.refreshLock({
          runId: OTHER_RUN_ID,
          ttlSeconds: EXTENDED_TTL_SECONDS,
        });

        expect(await repository.getLockHolder()).toBe(HOLDER_RUN_ID);
      });
    });
  });

  describe("given no lock is held", () => {
    describe("when a refresh is attempted", () => {
      it("returns false and does not create the lock key", async () => {
        const refreshed = await repository.refreshLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: EXTENDED_TTL_SECONDS,
        });

        expect(refreshed).toBe(false);
        expect(await redis.exists(REPLAY_LOCK_KEY)).toBe(0);
      });
    });
  });
});

describe("ReplayRedisRepository releaseLock", () => {
  describe("given a lock held by a run", () => {
    describe("when the holder releases the lock", () => {
      it("deletes the lock key", async () => {
        await repository.acquireLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: INITIAL_TTL_SECONDS,
        });

        await repository.releaseLock({ runId: HOLDER_RUN_ID });

        expect(await redis.exists(REPLAY_LOCK_KEY)).toBe(0);
      });
    });
  });

  describe("given a run's lock was lost and a successor acquired it", () => {
    describe("when the original run releases its stale lock", () => {
      it("does not delete the successor's lock", async () => {
        await repository.acquireLock({
          runId: HOLDER_RUN_ID,
          ttlSeconds: INITIAL_TTL_SECONDS,
        });
        // Simulate the holder's lock expiring, then a successor acquiring it.
        await redis.del(REPLAY_LOCK_KEY);
        await repository.acquireLock({
          runId: OTHER_RUN_ID,
          ttlSeconds: INITIAL_TTL_SECONDS,
        });

        await repository.releaseLock({ runId: HOLDER_RUN_ID });

        expect(await repository.getLockHolder()).toBe(OTHER_RUN_ID);
      });
    });
  });
});
