/**
 * The Redis reservation store against a real Redis, so the Lua scripts'
 * KEYS/ARGV wiring, the index pruning and the reply shapes are proven where
 * the in-memory fake cannot prove them.
 *
 * @see ../instant-eval-budget-reservations.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { RedisInstantEvalBudgetReservations } from "../instant-eval-budget-reservations";

const ORG = "org_reservations_test";
const HOUR_MS = 60 * 60 * 1000;

let redis: Redis;
let store: RedisInstantEvalBudgetReservations;

async function clearKeys() {
  const keys = await redis.keys(`langwatch:{instant-evals:free-budget:${ORG}}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
  store = new RedisInstantEvalBudgetReservations(redis as never);
  await clearKeys();
});

afterEach(async () => {
  await clearKeys();
});

afterAll(async () => {
  await stopTestContainers();
});

describe("given two processes holding against one organization's budget", () => {
  describe("when each takes a hold and one is released", () => {
    /** @scenario "Holds are shared across processes" */
    it("the second sees the first's hold, and a released hold no longer counts", async () => {
      const other = new RedisInstantEvalBudgetReservations(redis as never);

      const first = await store.reserve({
        organizationId: ORG,
        reservationId: "run_a",
        nanoUsd: 400_000_000,
        limitNanoUsd: 600_000_000,
        ttlMs: HOUR_MS,
      });
      const second = await other.reserve({
        organizationId: ORG,
        reservationId: "run_b",
        nanoUsd: 400_000_000,
        limitNanoUsd: 600_000_000,
        ttlMs: HOUR_MS,
      });

      expect(first).toEqual({ isReserved: true, heldNanoUsd: 400_000_000 });
      expect(second).toEqual({ isReserved: false, heldNanoUsd: 400_000_000 });
      await expect(
        other.heldNanoUsd({ organizationId: ORG, except: "run_a" }),
      ).resolves.toBe(0);

      await store.release({ organizationId: ORG, reservationId: "run_a" });

      await expect(other.heldNanoUsd({ organizationId: ORG })).resolves.toBe(0);
      const third = await other.reserve({
        organizationId: ORG,
        reservationId: "run_b",
        nanoUsd: 400_000_000,
        limitNanoUsd: 600_000_000,
        ttlMs: HOUR_MS,
      });
      expect(third).toEqual({ isReserved: true, heldNanoUsd: 400_000_000 });
    });
  });

  describe("when a hold's key has lapsed but its index entry is still there", () => {
    it("is pruned and no longer counts", async () => {
      await store.reserve({
        organizationId: ORG,
        reservationId: "run_a",
        nanoUsd: 100,
        limitNanoUsd: 1_000,
        ttlMs: HOUR_MS,
      });
      await redis.del(
        `langwatch:{instant-evals:free-budget:${ORG}}:reservation:run_a`,
      );

      await expect(store.heldNanoUsd({ organizationId: ORG })).resolves.toBe(0);
      await expect(
        redis.smembers(`langwatch:{instant-evals:free-budget:${ORG}}:reservations`),
      ).resolves.toEqual([]);
    });
  });

  describe("when a hold is taken", () => {
    it("carries the lifetime it was given", async () => {
      await store.reserve({
        organizationId: ORG,
        reservationId: "run_a",
        nanoUsd: 100,
        limitNanoUsd: 1_000,
        ttlMs: HOUR_MS,
      });

      const ttl = await redis.ttl(
        `langwatch:{instant-evals:free-budget:${ORG}}:reservation:run_a`,
      );
      expect(ttl).toBeGreaterThan(3_500);
      expect(ttl).toBeLessThanOrEqual(3_600);
    });
  });
});
