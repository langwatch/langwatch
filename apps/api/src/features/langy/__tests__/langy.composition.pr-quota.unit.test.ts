/**
 * The per-user daily pull-request cap, as the API process composes it
 * (specs/langy/langy-github-prs.feature).
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  LANGY_GITHUB_PRS_PER_DAY,
  PostgresLangyAdapter,
  type LangyConversationCommands,
  type LangyTurnTechnicalPorts,
} from "@langwatch/langy-server";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { TestProjectApi } from "../../../app/__tests__/support/test-project-api.ts";
import type { RedisConnection } from "@langwatch/redis-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { composeLangyFeature } from "../langy.composition.ts";

const USER_ID = "user-1";

/** The counter as Redis holds it: one string per day bucket, and the commands run on it. */
function fakeRedis(seed: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(seed));
  const commands: string[] = [];
  const read = (key: string) => Number.parseInt(values.get(key) ?? "0", 10);
  return {
    values,
    commands,
    connection: {
      get: async (key: string) => {
        commands.push(`GET ${key}`);
        return values.get(key) ?? null;
      },
      incr: async (key: string) => {
        commands.push(`INCR ${key}`);
        const next = read(key) + 1;
        values.set(key, String(next));
        return next;
      },
      decr: async (key: string) => {
        commands.push(`DECR ${key}`);
        const next = read(key) - 1;
        values.set(key, String(next));
        return next;
      },
      incrby: async (key: string, amount: number) => {
        commands.push(`INCRBY ${key} ${amount}`);
        const next = read(key) + amount;
        values.set(key, String(next));
        return next;
      },
      expire: async (key: string, seconds: number) => {
        commands.push(`EXPIRE ${key} ${seconds}`);
        return 1;
      },
      eval: async (_script: string, _numKeys: number, key: string) => {
        commands.push(`EVAL ${key}`);
        const current = read(key);
        if (current <= 0) return 0;
        values.set(key, String(current - 1));
        return current - 1;
      },
    } as unknown as RedisConnection,
  };
}

/** The bucket key the quota service files a user's day under. */
function bucketKey(userId: string): string {
  return `langy:gh:prs:${userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
}

/**
 * Composes the feature for real and hands back the turn ports it was built
 * with, which is where the permit collaborator lands.
 */
function composedTurns(redis: RedisConnection | null): LangyTurnTechnicalPorts {
  let captured: LangyTurnTechnicalPorts | undefined;
  const create = PostgresLangyAdapter.create.bind(PostgresLangyAdapter);
  vi.spyOn(PostgresLangyAdapter, "create").mockImplementation((options) => {
    const adapter = create(options);
    const build = adapter.build.bind(adapter);
    adapter.build = (dependencies) => {
      captured = dependencies.turns;
      return build(dependencies);
    };
    return adapter;
  });

  composeLangyFeature({
    infrastructure: {
      prisma: {} as unknown as PrismaClient,
      authz: {} as never,
      plans: {} as never,
      featureFlags: {} as unknown as FeatureFlagApi,
      saasBilling: false,
      audit: undefined,
      auditLog: createApiFixture<AuditLogApi>(),
    },
    peers: { projects: new TestProjectApi() },
    commands: {} as unknown as LangyConversationCommands,
    redis,
    publicBaseUrl: undefined,
    broadcast: {} as unknown as PresenceEmitterPort,
    demoProjectId: undefined,
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    processName: "langwatch-api-test",
  });

  if (!captured) throw new Error("the Langy composition built no turn ports");
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given the API process composes the Langy feature", () => {
  describe("when the process holds a Redis connection", () => {
    /** @scenario "The API process meters the daily pull-request cap on its own Redis" */
    it("spends a permit against the user's day bucket and publishes the real cap", async () => {
      const redis = fakeRedis();
      const turns = composedTurns(redis.connection);

      const reserved = await turns.permits.reserve({ userId: USER_ID });

      expect(turns.perDayPrCap).toBe(LANGY_GITHUB_PRS_PER_DAY);
      expect(reserved).toMatchObject({ allowed: true, reserved: true });
      expect(redis.commands).toContain(`INCR ${bucketKey(USER_ID)}`);
      expect(redis.values.get(bucketKey(USER_ID))).toBe("1");
    });

    /** @scenario "Per-user daily PR cap stops runaway loops" */
    it("denies the reservation once the day's cap is spent and gives the increment back", async () => {
      const key = bucketKey(USER_ID);
      const redis = fakeRedis({ [key]: String(LANGY_GITHUB_PRS_PER_DAY) });
      const turns = composedTurns(redis.connection);

      const reserved = await turns.permits.reserve({ userId: USER_ID });

      expect(reserved).toMatchObject({ allowed: false, reserved: false });
      expect(redis.values.get(key)).toBe(String(LANGY_GITHUB_PRS_PER_DAY));
    });

    /** @scenario "Permit must be released on every non-PR exit" */
    it("returns a reserved permit to the counter on release", async () => {
      const key = bucketKey(USER_ID);
      const redis = fakeRedis({ [key]: "3" });
      const turns = composedTurns(redis.connection);

      await turns.permits.release({ userId: USER_ID });

      expect(redis.values.get(key)).toBe("2");
    });
  });

  describe("when the process holds no Redis connection", () => {
    /** @scenario "A deployment with no counter never denies a pull request" */
    it("composes no counter and allows every reservation without reserving one", async () => {
      const turns = composedTurns(null);

      await expect(turns.permits.reserve({ userId: USER_ID })).resolves.toMatchObject({
        allowed: true,
        reserved: false,
      });
      await expect(turns.permits.check({ userId: USER_ID })).resolves.toMatchObject({
        allowed: true,
      });
    });
  });
});
