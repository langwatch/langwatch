import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { RateLimiter, ResponseCache } from "../ports.js";

// ---------------------------------------------------------------------------
// The observability seam, mocked so cache/limiter failure logging is observable.
// ---------------------------------------------------------------------------

const logRecords: {
  level: string;
  payload: Record<string, unknown>;
  message: string;
}[] = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
  const record =
    (level: string) => (payload: Record<string, unknown>, message: string) => {
      logRecords.push({ level, payload, message });
    };
  return {
    ...actual,
    createLogger: () => ({
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    }),
  };
});

const { createService: createRawService } = await import("../builder.js");
const createService: typeof createRawService = ((config: Parameters<
  typeof createRawService
>[0]) =>
  createRawService(config).withoutPermission(
    "framework test endpoint",
  )) as typeof createRawService;

// ---------------------------------------------------------------------------
// In-memory ports
// ---------------------------------------------------------------------------

class InMemoryRateLimiter implements RateLimiter {
  readonly keys: string[] = [];
  readonly denied = new Set<string>();
  retryAfterSeconds?: number;

  async check(key: string) {
    this.keys.push(key);
    if (this.denied.size > 0 || this.denied.has(key)) {
      return { allowed: false, retryAfterSeconds: this.retryAfterSeconds };
    }
    return { allowed: true };
  }

  denyAll(retryAfterSeconds?: number) {
    this.denied.add("*");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class InMemoryCache implements ResponseCache {
  readonly store = new Map<
    string,
    { tag: string; body: Uint8Array; ttlSeconds: number }
  >();
  failOnGet = false;

  async get(key: string) {
    if (this.failOnGet) throw new Error("redis is down");
    return this.store.get(key)?.body ?? null;
  }

  async set(key: string, tag: string, body: Uint8Array, ttlSeconds: number) {
    this.store.set(key, { tag, body, ttlSeconds });
  }

  async invalidateTag(tag: string) {
    for (const [key, entry] of this.store) {
      if (entry.tag === tag) this.store.delete(key);
    }
  }
}

const asJson = (res: Response) => res.json() as Promise<unknown>;

function post(
  app: {
    request: (path: string, init?: RequestInit) => Promise<Response> | Response;
  },
  path: string,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("withRateLimit", () => {
  let rateLimiter: InMemoryRateLimiter;
  let cache: InMemoryCache;

  beforeEach(() => {
    rateLimiter = new InMemoryRateLimiter();
    cache = new InMemoryCache();
    logRecords.length = 0;
  });

  function buildLimitedService() {
    return createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
      rateLimiter,
      cache,
    })
      .register(
        "things.create",
        "2026-08-07",
        async (_c, input: { name: string }) => ({ name: input.name }),
        (b) =>
          b
            .withInput(z.object({ name: z.string().min(1) }))
            .withOutput(z.object({ name: z.string() }))
            .withRateLimit(),
      )
      .build();
  }

  it("runs after auth and before validation: an over-limit caller gets 429, not 422", async () => {
    const app = buildLimitedService();
    rateLimiter.denyAll(30);

    // The body would fail validation — but the limiter answers first.
    const res = await post(app, "/api/things/2026-08-07/things.create", {
      name: "",
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("X-API-Version")).toBe("2026-08-07");
  });

  it("omits Retry-After when the limiter supplies none", async () => {
    const app = buildLimitedService();
    rateLimiter.denyAll();

    const res = await post(app, "/api/things/2026-08-07/things.create", {
      name: "widget",
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("keys on service, endpoint, version namespace and principal", async () => {
    const auth: MiddlewareHandler = async (c, next) => {
      c.set("user", { id: "user-1" });
      await next();
    };
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
      auth,
      rateLimiter,
    })
      .register(
        "things.create",
        "2026-08-07",
        async () => ({}),
        (b) => b.withRateLimit().withOutput(z.object({})),
      )
      .register(
        "things.delete",
        "2026-08-07",
        async () => ({}),
        (b) => b.withRateLimit().withOutput(z.object({})),
      )
      .build();

    await post(app, "/api/things/2026-08-07/things.create");
    await post(app, "/api/things/2026-08-07/things.delete");
    await post(app, "/api/things/latest/things.create");

    expect(rateLimiter.keys).toEqual([
      "things:/things.create:2026-08-07:user-1",
      "things:/things.delete:2026-08-07:user-1",
      "things:/things.create:latest:user-1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Response caching
// ---------------------------------------------------------------------------

describe("withCache", () => {
  let rateLimiter: InMemoryRateLimiter;
  let cache: InMemoryCache;

  beforeEach(() => {
    rateLimiter = new InMemoryRateLimiter();
    cache = new InMemoryCache();
    logRecords.length = 0;
  });

  function buildCachedService(
    handler = vi.fn(async (_c: unknown, input: { id: string }) => ({
      id: input.id,
      name: "thing",
    })),
  ) {
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
      rateLimiter,
      cache,
    })
      .register("things.get", "2026-08-07", handler, (b) =>
        b
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ id: z.string(), name: z.string() }))
          .withCache("things", 60),
      )
      .build();
    return app;
  }

  it("serves a cache hit without running the handler or the output schema", async () => {
    const handler = vi.fn(async (_c: unknown, input: { id: string }) => ({
      id: input.id,
      name: "thing",
    }));
    const app = buildCachedService(handler);

    const first = await post(app, "/api/things/2026-08-07/things.get", {
      id: "th_1",
    });
    expect(first.status).toBe(200);

    const second = await post(app, "/api/things/2026-08-07/things.get", {
      id: "th_1",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect(await asJson(second)).toEqual({ id: "th_1", name: "thing" });
    // Served from the wire bytes of the first, validated, response.
    expect(cache.store).toHaveProperty("size", 1);
  });

  it("stores the entry under the declared tag and ttl", async () => {
    const app = buildCachedService();

    await post(app, "/api/things/2026-08-07/things.get", { id: "th_1" });

    const entry = [...cache.store.values()][0]!;
    expect(entry.tag).toBe("things");
    expect(entry.ttlSeconds).toBe(60);
  });

  it("treats the cache key as the complete call", async () => {
    const handler = vi.fn(async (_c: unknown, input: { id: string }) => ({
      id: input.id,
      name: "thing",
    }));
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
      cache,
    })
      .register("things.get", "2026-01-15", handler, (b) =>
        b
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ id: z.string(), name: z.string() }))
          .withCache("things", 60),
      )
      .register("things.get", "2026-08-07", handler, (b) =>
        b
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ id: z.string(), name: z.string() }))
          .withCache("things", 60),
      )
      .build();

    await post(app, "/api/things/2026-08-07/things.get", { id: "th_1" });
    // One input field differs: a distinct entry, so the handler runs again.
    await post(app, "/api/things/2026-08-07/things.get", { id: "th_2" });
    // The same call under a different version namespace is distinct too.
    await post(app, "/api/things/2026-01-15/things.get", { id: "th_1" });
    await post(app, "/api/things/latest/things.get", { id: "th_1" });

    expect(handler).toHaveBeenCalledTimes(4);
    expect(cache.store.size).toBe(4);
  });

  it("drops a family's entries when its tag is invalidated", async () => {
    const handler = vi.fn(async (_c: unknown, input: { id: string }) => ({
      id: input.id,
      name: "thing",
    }));
    const app = buildCachedService(handler);

    await post(app, "/api/things/2026-08-07/things.get", { id: "th_1" });
    expect(handler).toHaveBeenCalledTimes(1);

    await cache.invalidateTag("things");

    await post(app, "/api/things/2026-08-07/things.get", { id: "th_1" });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("fails the build when no output is declared: unvalidated bytes may not be cached", () => {
    const service = createService({
      name: "things",
      basePath: "/api/things",
      cache,
    }).register(
      "things.get",
      "2026-08-07",
      async (c) => c.json({ id: "1" }),
      (b) => b.withCache("things", 60),
    );

    expect(() => service.build()).toThrow(
      /unvalidated bytes may not be cached/,
    );
  });

  it("degrades a cache failure to a handler call and logs it", async () => {
    const handler = vi.fn(async (_c: unknown, input: { id: string }) => ({
      id: input.id,
      name: "thing",
    }));
    cache.failOnGet = true;
    const app = buildCachedService(handler);

    const res = await post(app, "/api/things/2026-08-07/things.get", {
      id: "th_1",
    });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(
      logRecords.some(
        (r) => r.level === "error" && r.message.includes("cache read failed"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deprecation
// ---------------------------------------------------------------------------

describe("withDeprecated", () => {
  function buildDeprecatedService() {
    return createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
    })
      .register(
        "things.create",
        "2026-01-15",
        async (_c, input: { name: string }) => ({ name: input.name }),
        (b) =>
          b
            .withInput(z.object({ name: z.string() }))
            .withOutput(z.object({ name: z.string() }))
            .withDocs({ operationId: "createThing" })
            .withDeprecated("use things.createV2 after 2026-11-01"),
      )
      .register(
        "things.create",
        "2026-08-07",
        async (_c, input: { name: string }) => ({ name: input.name }),
        (b) =>
          b
            .withInput(z.object({ name: z.string() }))
            .withOutput(z.object({ name: z.string() }))
            .withDocs({ operationId: "createThingV2" }),
      )
      .build();
  }

  it("warns on every live response, including errors", async () => {
    const app = buildDeprecatedService();

    const ok = await post(app, "/api/things/2026-01-15/things.create", {
      name: "widget",
    });
    expect(ok.headers.get("Deprecation")).toBe("true");
    expect(ok.headers.get("X-API-Deprecation-Notice")).toBe(
      "use things.createV2 after 2026-11-01",
    );

    const failing = await post(app, "/api/things/2026-01-15/things.create", {
      name: 42,
    });
    expect(failing.status).toBe(422);
    expect(failing.headers.get("Deprecation")).toBe("true");
    expect(failing.headers.get("X-API-Deprecation-Notice")).toBe(
      "use things.createV2 after 2026-11-01",
    );

    // The non-deprecated override does not warn.
    const current = await post(app, "/api/things/2026-08-07/things.create", {
      name: "widget",
    });
    expect(current.headers.get("Deprecation")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service-level defaults and opt-outs
// ---------------------------------------------------------------------------

describe("capability defaults", () => {
  it("applies a service-level default until re-declared or opted out", async () => {
    const rateLimiter = new InMemoryRateLimiter();
    const cache = new InMemoryCache();

    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
      rateLimiter,
      cache,
    })
      .withRateLimit()
      .withCache("things", 60)
      // Neither re-declares: both defaults apply.
      .register(
        "things.list",
        "2026-08-07",
        async () => ["a"],
        (b) => b.withOutput(z.array(z.string())),
      )
      // Re-declares the cache under its own tag.
      .register(
        "things.get",
        "2026-08-07",
        async () => ({ id: "1" }),
        (b) =>
          b.withOutput(z.object({ id: z.string() })).withCache("special", 5),
      )
      // Opts out of both.
      .register(
        "things.search",
        "2026-08-07",
        async () => ["x"],
        (b) =>
          b.withOutput(z.array(z.string())).withoutCache().withoutRateLimit(),
      )
      .build();

    await post(app, "/api/things/2026-08-07/things.list");
    await post(app, "/api/things/2026-08-07/things.get");
    await post(app, "/api/things/2026-08-07/things.search");

    // The default applied to list and get only; search opted out.
    expect(rateLimiter.keys.sort()).toEqual([
      "things:/things.get:2026-08-07:anonymous",
      "things:/things.list:2026-08-07:anonymous",
    ]);

    // get cached under its own tag, list under the service default, search nowhere.
    const tags = [...cache.store.entries()].map(([key, entry]) => ({
      key,
      tag: entry.tag,
    }));
    expect(tags).toHaveLength(2);
    expect(tags.filter((t) => t.tag === "special")).toHaveLength(1);
    expect(tags.filter((t) => t.tag === "special")[0]!.key).toContain(
      "/things.get",
    );
    expect(tags.filter((t) => t.tag === "things")).toHaveLength(1);
    expect(tags.filter((t) => t.tag === "things")[0]!.key).toContain(
      "/things.list",
    );
  });
});
