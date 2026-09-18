/**
 * @vitest-environment node
 *
 * @see specs/server/redis-client-ownership.feature
 * @see dev/docs/adr/093-redis-is-an-owned-client.md
 *
 * better-auth's secondary storage after ADR-093.
 *
 * WHY THIS FILE EXISTS (#6950)
 *
 * On main, `secondaryStorage` closed over an eagerly-created singleton: once
 * configured, the connection object always existed, and a command issued while
 * Redis was unreachable sat in ioredis's offline queue until it wasn't.
 * ADR-093 replaced that with `tryGetApp()?.redis ?? null`, resolved per call —
 * which answers `null` before the App boots, and permanently in a process that
 * never builds one.
 *
 * A dropped READ is a cache miss and better-auth recovers it from the database.
 * A dropped WRITE has no recovery, and the credential sign-in rate-limit
 * counters live only in secondary storage: dropping their `set` is a rate limit
 * that fails OPEN. So the degrade is allowed, but it is not allowed to be
 * quiet, and neither half of that was covered by a test.
 */
import type { BetterAuthOptions } from "better-auth";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestApp } from "../../app-layer/presets";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

// A real Prisma client opens a connection pool that keeps vitest from closing
// after the suite passes — the same reason index.test.ts mocks it. No Redis
// mock is needed alongside it: `secondaryStorage` never constructs a client,
// it reads whatever the App is holding.
vi.mock("~/server/db", () => ({ prisma: {} }));

// The module under test decides WHETHER to configure secondary storage from
// env, at import. Forcing a Redis URL is what makes the callbacks exist at all;
// without it this suite would assert against `undefined` and pass vacuously.
vi.mock("~/env.mjs", async () => {
  const actual = await vi.importActual<typeof import("~/env.mjs")>("~/env.mjs");
  return {
    ...actual,
    env: {
      ...actual.env,
      REDIS_URL: "redis://localhost:6379",
      REDIS_CLUSTER_ENDPOINTS: undefined,
      SKIP_REDIS: false,
    },
  };
});

/**
 * Only better-auth's own logger feeds the spy.
 *
 * Booting a test App warms other modules that legitimately warn about a missing
 * Redis — the SSE broadcast service is one — and a spy shared across every
 * logger would count those as dropped writes. The name is spelled inline
 * because a `vi.mock` factory is hoisted above any const it might reference.
 */
vi.mock("@langwatch/observability", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/observability")
  >("@langwatch/observability");
  return {
    ...actual,
    createLogger: (name: string) => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: name === "langwatch:better-auth" ? warn : vi.fn(),
      error: vi.fn(),
    }),
  };
});

/**
 * The configured store, imported once under an environment that actually asks
 * for secondary storage.
 *
 * `vitest.config.ts` sets `BUILD_TIME=1` for every unit run, and better-auth
 * reads that as "do not adopt this Redis as a session store" — so in a stock
 * unit test `secondaryStorage` is `undefined` and every assertion about it
 * passes vacuously. Clearing it here is what gives this suite something to
 * assert against, and is a large part of why the degrade path went uncovered.
 */
let store: NonNullable<BetterAuthOptions["secondaryStorage"]>;

beforeAll(async () => {
  vi.stubEnv("BUILD_TIME", "");
  // The env stub only reaches a module that has not been evaluated yet, and
  // this suite shares its module registry with the rest of the run.
  vi.resetModules();

  const { secondaryStorage } = await import("../index");
  if (!secondaryStorage) {
    throw new Error(
      "secondaryStorage was not configured — the env setup above stopped working, and every assertion below would be vacuous.",
    );
  }
  store = secondaryStorage;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/**
 * Runs `body` with `globalForApp.__langwatch_app` set to `app`, restoring
 * whatever was there before. `undefined` is the App-less process — the state
 * `tryGetApp()` answers `null` for.
 */
async function withApp(app: unknown, body: () => Promise<void>): Promise<void> {
  const { globalForApp } = await import("../../app-layer/app");
  const previous = globalForApp.__langwatch_app;
  globalForApp.__langwatch_app = app as never;
  try {
    await body();
  } finally {
    globalForApp.__langwatch_app = previous;
  }
}

function fakeRedis() {
  return {
    get: vi.fn().mockResolvedValue("stored"),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe("better-auth secondary storage", () => {
  beforeEach(() => {
    warn.mockClear();
  });

  describe("given an application holding a Redis connection", () => {
    /** @scenario Secondary storage reads and writes the application's connection */
    it("namespaces every operation and reaches that connection", async () => {
      const redis = fakeRedis();

      await withApp(createTestApp({ redis: redis as never }), async () => {
        expect(await store.get("session-key")).toBe("stored");
        await store.set("session-key", "value", 60);
        await store.set("no-ttl", "value");
        await store.delete("session-key");
      });

      expect(redis.get).toHaveBeenCalledWith("better-auth:session-key");
      expect(redis.set).toHaveBeenCalledWith(
        "better-auth:session-key",
        "value",
        "EX",
        60,
      );
      expect(redis.set).toHaveBeenCalledWith("better-auth:no-ttl", "value");
      expect(redis.del).toHaveBeenCalledWith("better-auth:session-key");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("given a process with no application", () => {
    /** @scenario A read with no connection degrades to a cache miss */
    it("answers a read with a miss instead of throwing", async () => {
      await withApp(undefined, async () => {
        expect(await store.get("session-key")).toBeNull();
      });

      // A miss is a complete answer here: better-auth re-reads the session from
      // the database. Nothing was lost, so nothing is reported.
      expect(warn).not.toHaveBeenCalled();
    });

    /** @scenario A dropped write is reported rather than silently discarded */
    it("drops a write loudly, naming the operation but never the key", async () => {
      await withApp(undefined, async () => {
        await store.set("rate-limit:count", "3", 60);
        await store.delete("rate-limit:count");
      });

      expect(warn).toHaveBeenCalledTimes(2);

      const operations = warn.mock.calls.map(([fields]) => fields.operation);
      expect(operations).toEqual(["set", "delete"]);

      // The count separates "one request raced boot" from "this process has been
      // serving auth with no secondary storage all along". Asserted as a rise
      // rather than as literal 1 and 2: the counter is module state, so pinning
      // absolute values would make this test depend on the order of the ones
      // around it.
      const [first, second] = warn.mock.calls.map(
        ([fields]) => fields.droppedSecondaryWrites as number,
      );
      expect(first).toBeGreaterThan(0);
      expect(second).toBe((first ?? 0) + 1);

      // better-auth keys secondary storage BY SESSION TOKEN, so the key is a
      // credential. It must not reach the logs, in a field or in the message.
      for (const [fields, message] of warn.mock.calls) {
        expect(JSON.stringify(fields)).not.toContain("rate-limit:count");
        expect(message).not.toContain("rate-limit:count");
      }
    });

    /** @scenario A dropped write does not fail the request that caused it */
    it("resolves rather than rejecting, so the caller degrades open", async () => {
      await withApp(undefined, async () => {
        await expect(store.set("k", "v")).resolves.toBeUndefined();
        await expect(store.delete("k")).resolves.toBeUndefined();
      });
    });
  });

  describe("given an application configured without Redis", () => {
    /** @scenario A deployment with no Redis drops writes the same way */
    it("degrades identically to having no application at all", async () => {
      await withApp(createTestApp(), async () => {
        expect(await store.get("k")).toBeNull();
        await store.set("k", "v");
      });

      expect(warn).toHaveBeenCalledOnce();
    });
  });
});
