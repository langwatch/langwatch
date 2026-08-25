import { NotFoundError } from "@langwatch/handled-error";
import { getCurrentContext } from "@langwatch/observability/context";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createService as createRawService } from "../builder.js";
import { createTestService as createService } from "./test-service.js";
import type { MountedRoute } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTestService() {
  return createService({ name: "test", basePath: "/api/test" });
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// An endpoint is one register call (specs/fluent-registration.feature)
// ---------------------------------------------------------------------------

describe("register", () => {
  it("serves POST /api/{service}/{version}/{name} with context and validated input", async () => {
    const seen: unknown[] = [];
    const app = buildTestService()
      .provide({ things: () => ({ label: "provided" }) })
      .register(
        "things.create",
        "2026-08-07",
        async (c, input: { name: string }) => {
          seen.push(c.get("things"));
          return { created: input.name, from: c.get("things").label };
        },
        (b) =>
          b
            .withInput(z.object({ name: z.string() }))
            .withOutput(z.object({ created: z.string(), from: z.string() })),
      )
      .build();

    const res = await app.request("/api/test/2026-08-07/things.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "widget" }),
    });

    expect(res.status).toBe(200);
    expect(seen).toEqual([{ label: "provided" }]);
    await expect(res.json()).resolves.toEqual({
      created: "widget",
      from: "provided",
    });
  });

  it("rejects an invalid version label at registration", () => {
    expect(() =>
      buildTestService().register("things.ping", "2026-02-30", async (c) =>
        c.body(null, 204),
      ),
    ).toThrow(/Invalid API version/);
  });

  it("refuses to register the derived latest namespace", () => {
    expect(() =>
      buildTestService().register("things.ping", "latest", async (c) =>
        c.body(null, 204),
      ),
    ).toThrow(/cannot be registered/);
  });
});

describe("a bare endpoint", () => {
  it("installs no input validation: bodyless and empty-object POSTs both succeed", async () => {
    const app = buildTestService()
      .register("things.ping", "2026-08-07", async (c) => c.text("pong"))
      .build();

    const bodyless = await app.request("/api/test/2026-08-07/things.ping", {
      method: "POST",
    });
    expect(bodyless.status).toBe(200);

    const empty = await app.request("/api/test/2026-08-07/things.ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(empty.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// withStatus: the declared success status (e.g. 201 for creation endpoints)
// ---------------------------------------------------------------------------

describe("withStatus", () => {
  it("answers the declared status on the wire", async () => {
    const app = buildTestService()
      .register(
        "things.create",
        "2025-03-15",
        async (_c, input: { name: string }) => ({ id: input.name }),
        (b) =>
          b
            .withInput(z.object({ name: z.string() }))
            .withOutput(z.object({ id: z.string() }))
            .withStatus(201),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "thing_1" }),
    });

    expect(res.status).toBe(201);
    expect(await jsonBody(res)).toEqual({ id: "thing_1" });
  });

  it("documents the declared status as the success response", async () => {
    const app = buildTestService()
      .register(
        "things.create",
        "2025-03-15",
        async () => ({ id: "1" }),
        (b) =>
          b
            .withOutput(z.object({ id: z.string() }))
            .withStatus(201)
            .withDocs({ operationId: "createThing" }),
      )
      .build();

    const { generateSpecs } = await import("hono-openapi");
    const spec = await generateSpecs(app, { excludeStaticFile: false });

    const operation = spec.paths["/api/test/2025-03-15/things.create"]?.post;
    expect(operation?.responses).toHaveProperty("201");
    expect(operation?.responses).not.toHaveProperty("200");
  });
});

// ---------------------------------------------------------------------------
// withMeta is not documentation
// ---------------------------------------------------------------------------

describe("withMeta", () => {
  it("travels on the mount report and never reaches the document", async () => {
    const meta = { policy: "things:read" };
    const mounted: MountedRoute[] = [];
    const app = createService({
      name: "test",
      basePath: "/api/test",
      onRouteMounted: (route) => mounted.push(route),
    })
      .register(
        "things.list",
        "2026-08-07",
        async () => [],
        (b) => b.withOutput(z.array(z.string())).withMeta(meta),
      )
      .build();

    for (const route of mounted.filter(
      (r) => !r.isNamespaceGuard && !r.isDiscoverEndpoint,
    )) {
      expect(route.config?.meta).toEqual(meta);
    }

    const { generateSpecs } = await import("hono-openapi");
    const spec = await generateSpecs(app, { excludeStaticFile: false });
    expect(JSON.stringify(spec)).not.toContain("things:read");
  });
});

// ---------------------------------------------------------------------------
// registerRoute: REST families keep their own verbs
// ---------------------------------------------------------------------------

describe("registerRoute", () => {
  it("serves the declared method on the path under the versioned namespace", async () => {
    const app = buildTestService()
      .registerRoute(
        "get",
        "/:id",
        "2026-08-07",
        async (c) => ({
          id: c.get("params").id,
          verbose: c.get("query").verbose,
        }),
        (b) =>
          b
            .withParams(z.object({ id: z.string() }))
            .withQuery(z.object({ verbose: z.enum(["true", "false"]) }))
            .withOutput(z.object({ id: z.string(), verbose: z.string() })),
      )
      .build();

    const res = await app.request("/api/test/2026-08-07/th_1?verbose=true");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "th_1", verbose: "true" });

    // A real date that was never registered is served by the latest
    // registration on or before it — params included.
    const inherited = await app.request("/api/test/2026-09-01/th_2?verbose=false");
    expect(inherited.status).toBe(200);
    await expect(inherited.json()).resolves.toEqual({
      id: "th_2",
      verbose: "false",
    });

    const wrongMethod = await app.request("/api/test/2026-08-07/th_1?verbose=true", {
      method: "POST",
    });
    expect(wrongMethod.status).toBe(404);
  });

  it("cannot express a new RPC family: paths must start with a slash", () => {
    expect(() =>
      buildTestService().registerRoute("post", "things.create", "2026-08-07", async (c) =>
        c.body(null, 204),
      ),
    ).toThrow(/must start with "\/"/);
  });

  it("rejects paths that squat on the reserved version namespace", () => {
    for (const path of [
      "/latest",
      "/preview/items",
      "/2025-03-15/items",
      "/2025-02-30/items",
    ]) {
      expect(() =>
        buildTestService().registerRoute("get", path, "2025-03-15", async (c) =>
          c.body(null, 204),
        ),
      ).toThrow(/reserved API version namespace/);
    }
  });
});

// ---------------------------------------------------------------------------
// provide(): typed context variables
// ---------------------------------------------------------------------------

describe("provide", () => {
  it("resolves async factories before the handler runs", async () => {
    const app = buildTestService()
      .provide({ data: async () => ({ loaded: true }) })
      .register(
        "things.data",
        "2025-03-15",
        async (c) => c.get("data"),
        (b) => b.withOutput(z.object({ loaded: z.boolean() })),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.data", {
      method: "POST",
    });
    expect(await jsonBody(res)).toEqual({ loaded: true });
  });

  it("lets providers resolve the process app installed on Hono context", async () => {
    const runtimeApp = { marker: "one-process-app" };
    const middleware: MiddlewareHandler = async (c, next) => {
      c.set("langwatchApp", runtimeApp);
      await next();
    };
    const app = createService({
      name: "test",
      basePath: "/api/test",
      middleware: [middleware],
    })
      .provide({
        runtimeApp: (_base, context) => context.get("langwatchApp"),
      })
      .register(
        "things.app",
        "2025-03-15",
        async (c) => c.get("runtimeApp"),
        (b) => b.withOutput(z.object({ marker: z.string() })),
      )
      .build();

    const response = await app.request("/api/test/2025-03-15/things.app", {
      method: "POST",
    });
    expect(await jsonBody(response)).toEqual(runtimeApp);
  });

  it("exposes the process app directly on the handler context", async () => {
    const runtimeApp = { things: { marker: "one-process-app" } };
    const app = createService<unknown, typeof runtimeApp>({
      name: "test",
      basePath: "/api/test",
      app: () => runtimeApp,
    })
      .withoutPermission("framework test endpoint")
      .register(
        "things.app",
        "2025-03-15",
        async (context) => context.app.things,
        (builder) => builder.withOutput(z.object({ marker: z.string() })),
      )
      .build();

    const response = await app.request("/api/test/2025-03-15/things.app", {
      method: "POST",
    });
    expect(await jsonBody(response)).toEqual(runtimeApp.things);
  });

  it("exposes the resolved actor as a context function", async () => {
    const app = createService({
      name: "test",
      basePath: "/api/test",
      actor: () => ({ id: "user-1" }),
    })
      .withoutPermission("framework test endpoint")
      .register(
        "things.actor",
        "2025-03-15",
        async (context) => context.actor(),
        (builder) => builder.withOutput(z.object({ id: z.string() })),
      )
      .build();

    const response = await app.request("/api/test/latest/things.actor", {
      method: "POST",
    });
    expect(await jsonBody(response)).toEqual({ id: "user-1" });
  });

  it("does not resolve an actor until a handler asks for it", async () => {
    const resolveActor = vi.fn(() => ({ id: "user-1" }));
    const app = createService({
      name: "test",
      basePath: "/api/test",
      actor: resolveActor,
    })
      .withoutPermission("framework test endpoint")
      .register(
        "things.list",
        "2025-03-15",
        async () => [],
        (builder) => builder.withOutput(z.array(z.string())),
      )
      .build();

    const response = await app.request("/api/test/latest/things.list", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(resolveActor).not.toHaveBeenCalled();
  });

  it("authorizes a permission selected from validated request data", async () => {
    const authorize = vi.fn(async () => undefined);
    const app = createService({
      name: "test",
      basePath: "/api/test",
      authorize,
    })
      .withoutPermission("framework test endpoint")
      .register(
        "things.read",
        "2025-03-15",
        async (context, input: { permission: "traces:view" }) => {
          await context.authorize(input.permission);
          return { authorized: true };
        },
        (builder) =>
          builder
            .withInput(z.object({ permission: z.literal("traces:view") }))
            .withOutput(z.object({ authorized: z.boolean() })),
      )
      .build();

    const response = await app.request("/api/test/latest/things.read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission: "traces:view" }),
    });

    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith(expect.anything(), "traces:view");
  });

  it("rejects a body projectId different from the authenticated project", async () => {
    const app = createService({
      name: "test",
      basePath: "/api/test",
      projectIdInput: true,
      middleware: [
        async (context, next) => {
          context.set("project" as never, { id: "project-1" });
          await next();
        },
      ],
    })
      .withoutPermission("framework test endpoint")
      .register(
        "things.get",
        "2025-03-15",
        async (_context, input: { projectId: string }) => input,
        (builder) =>
          builder
            .withInput(z.object({ projectId: z.string() }))
            .withOutput(z.object({ projectId: z.string() })),
      )
      .build();

    const response = await app.request("/api/test/latest/things.get", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-2" }),
    });
    expect(response.status).toBe(403);
    await expect(jsonBody(response)).resolves.toMatchObject({
      code: "project_input_mismatch",
    });
  });

  it("preserves endpoints registered before the provide call", async () => {
    const app = buildTestService()
      .register(
        "things.health",
        "2025-03-15",
        async () => "ok" as const,
        (b) => b.withOutput(z.literal("ok")),
      )
      .provide({ dependency: () => "available" })
      .build();

    const res = await app.request("/api/test/2025-03-15/things.health", {
      method: "POST",
    });
    expect(await res.json()).toBe("ok");
  });

  it("rejects provider names reserved by the framework", () => {
    expect(() =>
      buildTestService().provide({ project: () => ({ id: "wrong" }) }),
    ).toThrow(/reserved by BaseApp/);
    expect(() => buildTestService().provide({ params: () => ({}) })).toThrow(
      /reserved for validated request data/,
    );
  });

  it("makes auth-resolved request context available to providers", async () => {
    const auth: MiddlewareHandler = async (c, next) => {
      c.set("organization", { id: "org-1" });
      c.set("project", { id: "project-1" });
      c.set("user", { id: "user-1" });
      await next();
    };

    const app = createService({ name: "test", basePath: "/api/test", auth })
      .provide({ requestContext: () => getCurrentContext() })
      .register(
        "things.context",
        "2025-03-15",
        async (c) => ({
          organizationId: c.get("requestContext")?.organizationId ?? "missing",
          projectId: c.get("requestContext")?.projectId ?? "missing",
          userId: c.get("requestContext")?.userId ?? "missing",
        }),
        (b) =>
          b.withOutput(
            z.object({
              organizationId: z.string(),
              projectId: z.string(),
              userId: z.string(),
            }),
          ),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.context", {
      method: "POST",
    });
    expect(await res.json()).toEqual({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("input validation", () => {
  it("answers 422 with per-field reasons on invalid input", async () => {
    const app = buildTestService()
      .register(
        "things.create",
        "2025-03-15",
        async (_c, input: { name: string }) => ({ created: input.name }),
        (b) =>
          b
            .withInput(z.object({ name: z.string().min(1) }))
            .withOutput(z.object({ created: z.string() })),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(422);
    expect(await jsonBody(res)).toMatchObject({
      code: "validation_error",
      reasons: [{ code: "schema_failure", meta: { field: "name", type: "too_small" } }],
    });
    expect(res.headers.get("X-API-Version")).toBe("2025-03-15");
  });
});

describe("output validation", () => {
  it("strips undeclared fields from the response", async () => {
    const app = buildTestService()
      .register(
        "things.get",
        "2025-03-15",
        async () => ({ id: 1, name: "item", extraField: "stripped" }),
        (b) => b.withOutput(z.object({ id: z.number(), name: z.string() })),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.get", {
      method: "POST",
    });
    expect(await jsonBody(res)).toEqual({ id: 1, name: "item" });
  });

  it("answers an internal error when the handler breaks its own contract", async () => {
    const app = buildTestService()
      .register(
        "things.get",
        "2025-03-15",
        async () => ({ id: "not-a-number" }) as never,
        (b) => b.withOutput(z.object({ id: z.number() })),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.get", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({
      code: "internal_error",
      // Deprecated back-compat alias of `code` (see ErrorResponseBody.kind).
      kind: "internal_error",
      // The Go envelope's name for the same value (see ErrorResponseBody.type).
      type: "internal_error",
      message: "An unknown error occurred",
      retryable: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Auth and middleware
// ---------------------------------------------------------------------------

describe("permission declarations", () => {
  it("refuses an endpoint with neither a permission nor a written opt-out", () => {
    const service = createRawService({
      name: "test",
      basePath: "/api/test",
    }).register("things.list", "2025-03-15", async (c) => c.json({ ok: true }));

    expect(() => service.build()).toThrow(/must declare exactly one/);
  });

  it("refuses a blank opt-out reason", () => {
    const service = createRawService({
      name: "test",
      basePath: "/api/test",
    })
      .withoutPermission(" ")
      .register("things.list", "2025-03-15", async (c) => c.json({ ok: true }));

    expect(() => service.build()).toThrow(/blank reason/);
  });

  it("refuses a permission when the host supplies no enforcer", () => {
    const service = createRawService({
      name: "test",
      basePath: "/api/test",
    })
      .withPermission("traces:view")
      .register("things.list", "2025-03-15", async (c) => c.json({ ok: true }));

    expect(() => service.build()).toThrow(/has no permissionEnforcer/);
  });

  it("runs the declared permission after auth and before endpoint middleware", async () => {
    const calls: string[] = [];
    const middleware =
      (name: string): MiddlewareHandler =>
      async (_c, next) => {
        calls.push(name);
        await next();
      };
    const app = createRawService({
      name: "test",
      basePath: "/api/test",
      auth: middleware("auth"),
      permissionEnforcer: (permission) => middleware(`permission:${permission}`),
    })
      .register(
        "things.list",
        "2025-03-15",
        async (c) => {
          calls.push("handler");
          return c.json({ ok: true });
        },
        (b) => b.withPermission("traces:view").withMiddleware(middleware("endpoint")),
      )
      .build();

    await app.request("/api/test/2025-03-15/things.list", { method: "POST" });

    expect(calls).toEqual(["auth", "permission:traces:view", "endpoint", "handler"]);
  });
});

describe("withAuth", () => {
  it("skips service auth and legacy organization resolution when set to none", async () => {
    const authMiddleware: MiddlewareHandler = vi.fn(async (c, next) => {
      c.set("project", { id: "project-1" });
      await next();
    });
    const organizationMiddleware: MiddlewareHandler = vi.fn(async (c, next) => {
      if (!c.get("project")) {
        return c.json({ error: "without project" }, 500);
      }
      await next();
    });

    const app = createService({
      name: "test",
      basePath: "/api/test",
      auth: authMiddleware,
      _legacy: { organizationMiddleware },
    })
      .register(
        "things.public",
        "2025-03-15",
        async () => ({ open: true }),
        (b) => b.withAuth("none").withOutput(z.object({ open: z.boolean() })),
      )
      .register(
        "things.private",
        "2025-03-15",
        async () => ({ secret: true }),
        (b) => b.withOutput(z.object({ secret: z.boolean() })),
      )
      .build();

    const publicRes = await app.request("/api/test/2025-03-15/things.public", {
      method: "POST",
    });
    expect(publicRes.status).toBe(200);
    expect(authMiddleware).not.toHaveBeenCalled();
    expect(organizationMiddleware).not.toHaveBeenCalled();

    await app.request("/api/test/2025-03-15/things.private", {
      method: "POST",
    });
    expect(authMiddleware).toHaveBeenCalled();
  });
});

describe("withMiddleware", () => {
  it("runs service middleware before endpoint middleware", async () => {
    const order: string[] = [];
    const serviceMiddleware: MiddlewareHandler = async (_c, next) => {
      order.push("service");
      await next();
    };
    const endpointMiddleware: MiddlewareHandler = async (_c, next) => {
      order.push("endpoint");
      await next();
    };

    const app = buildTestService()
      .withMiddleware(serviceMiddleware)
      .register(
        "things.list",
        "2025-03-15",
        async () => {
          order.push("handler");
          return { ok: true };
        },
        (b) =>
          b.withMiddleware(endpointMiddleware).withOutput(z.object({ ok: z.boolean() })),
      )
      .build();

    await app.request("/api/test/2025-03-15/things.list", { method: "POST" });
    expect(order).toEqual(["service", "endpoint", "handler"]);
  });
});

describe("resource limits", () => {
  it("applies the resource limit middleware when the factory is provided", async () => {
    const resourceLimitCalled = vi.fn();

    const app = createService({
      name: "test",
      basePath: "/api/test",
      _legacy: {
        resourceLimitMiddleware: (limitType: string) => {
          return async (_c, next) => {
            resourceLimitCalled(limitType);
            await next();
          };
        },
      },
    })
      .register(
        "things.create",
        "2025-03-15",
        async () => ({ ok: true }),
        (b) => b.withResourceLimit("things").withOutput(z.object({ ok: z.boolean() })),
      )
      .build();

    await app.request("/api/test/2025-03-15/things.create", { method: "POST" });
    expect(resourceLimitCalled).toHaveBeenCalledWith("things");
  });

  it("fails the build when the factory is missing", () => {
    const service = buildTestService().register(
      "things.create",
      "2025-03-15",
      async () => ({ ok: true }),
      (b) => b.withResourceLimit("things").withOutput(z.object({ ok: z.boolean() })),
    );

    expect(() => service.build()).toThrow(/has no resourceLimitMiddleware/);
  });
});

// ---------------------------------------------------------------------------
// A declared capability without its port fails the build
// ---------------------------------------------------------------------------

describe("capability ports", () => {
  it("fails the build naming the endpoint and the missing rate limiter port", () => {
    const service = buildTestService().register(
      "things.create",
      "2025-03-15",
      async () => ({ ok: true }),
      (b) => b.withRateLimit().withOutput(z.object({ ok: z.boolean() })),
    );

    expect(() => service.build()).toThrow(
      /POST \/things\.create declares withRateLimit but the service has no "rateLimiter" port/,
    );
  });

  it("fails the build naming the endpoint and the missing cache port", () => {
    const service = buildTestService().register(
      "things.list",
      "2025-03-15",
      async () => [],
      (b) => b.withCache("things", 60).withOutput(z.array(z.string())),
    );

    expect(() => service.build()).toThrow(
      /POST \/things\.list declares withCache but the service has no "cache" port/,
    );
  });
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

describe("group", () => {
  it("applies its chain to everything registered through it and prefixes dotted names", async () => {
    const mounted: MountedRoute[] = [];
    const limiterKeys: string[] = [];
    const app = createService({
      name: "test",
      basePath: "/api/test",
      onRouteMounted: (route) => mounted.push(route),
      rateLimiter: {
        async check(key: string) {
          limiterKeys.push(key);
          return { allowed: true };
        },
      },
    });
    const things = app.group("things", (b) =>
      b.withDocs({ tags: ["Things"] }).withRateLimit(),
    );
    things.register(
      "create",
      "2026-08-07",
      async () => ({ id: "1" }),
      (b) => b.withOutput(z.object({ id: z.string() })),
    );
    things.register(
      "get",
      "2026-08-07",
      async () => ({ id: "2" }),
      (b) => b.withOutput(z.object({ id: z.string() })),
    );
    things.registerSse(
      "watch",
      "2026-08-07",
      async (_c, stream) => {
        stream.close();
      },
      (b) => b.withEvents({ tick: z.object({ n: z.number() }) }),
    );
    const built = app.build();

    const names = [
      ...new Set(
        mounted
          .filter((r) => !r.isNamespaceGuard && !r.isDiscoverEndpoint)
          .map((r) => r.path.replace("/api/test/", "").replace(/^[^/]+\//, "")),
      ),
    ].sort();
    expect(names).toEqual(["things.create", "things.get", "things.watch"]);

    for (const route of mounted.filter(
      (r) => !r.isNamespaceGuard && !r.isDiscoverEndpoint,
    )) {
      expect(route.config?.docs?.tags).toEqual(["Things"]);
      expect(route.config?.rateLimit).toBe(true);
    }

    const res = await built.request("/api/test/2026-08-07/things.get", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(limiterKeys).toEqual(["test:/things.get:2026-08-07:anonymous"]);
  });

  it("runs middleware service first, group second, endpoint last", async () => {
    const order: string[] = [];
    const mw =
      (label: string): MiddlewareHandler =>
      async (_c, next) => {
        order.push(label);
        await next();
      };

    const service = buildTestService().withMiddleware(mw("service"));
    const things = service.group("things", (b) => b.withMiddleware(mw("group")));
    things.register(
      "list",
      "2025-03-15",
      async () => {
        order.push("handler");
        return [];
      },
      (b) => b.withMiddleware(mw("endpoint")).withOutput(z.array(z.string())),
    );
    const app = service.build();

    await app.request("/api/test/2025-03-15/things.list", { method: "POST" });
    expect(order).toEqual(["service", "group", "endpoint", "handler"]);
  });

  it("lets the endpoint's re-declaration win over group and service defaults", async () => {
    const mounted: MountedRoute[] = [];
    const service = createService({
      name: "test",
      basePath: "/api/test",
      onRouteMounted: (route) => mounted.push(route),
    }).withMeta({ level: "service" });
    const things = service.group("things", (b) => b.withMeta({ level: "group" }));
    things.register(
      "create",
      "2025-03-15",
      async (c) => c.body(null, 204),
      (b) => b.withMeta({ level: "endpoint" }),
    );
    things.register("get", "2025-03-15", async (c) => c.body(null, 204));
    service.register("other.ping", "2025-03-15", async (c) => c.body(null, 204));
    service.build();

    const metaOf = (path: string) =>
      mounted.find((r) => r.path === `/api/test/2025-03-15${path}`)?.config?.meta;

    expect(metaOf("/things.create")).toEqual({ level: "endpoint" });
    expect(metaOf("/things.get")).toEqual({ level: "group" });
    expect(metaOf("/other.ping")).toEqual({ level: "service" });
  });

  it("cannot weaken the name grammar: the full dotted name is checked", () => {
    const service = buildTestService();
    const things = service.group("Things");
    expect(() =>
      things.register("create", "2025-03-15", async (c) => c.body(null, 204)),
    ).toThrow(/dotted <resource>\.<verb>/);
  });

  it("checks a single-segment name against the full prefixed name, not the segment", () => {
    const service = buildTestService();
    const things = service.group("things");
    // "create" alone would fail the grammar (no dot); through the group the
    // full name is "things.create", which is legal.
    expect(() =>
      things.register("create", "2025-03-15", async (c) => c.body(null, 204)),
    ).not.toThrow();
  });

  it("carries no version: every registration names its own", async () => {
    const mounted: MountedRoute[] = [];
    const service = createService({
      name: "test",
      basePath: "/api/test",
      onRouteMounted: (route) => mounted.push(route),
    });
    const things = service.group("things");
    things.register("create", "2026-01-15", async (c) => c.body(null, 204));
    things.register("create", "2026-08-07", async (c) => c.body(null, 204));
    service.build();

    const dated = [
      ...new Set(
        mounted.filter((r) => r.path.endsWith("/things.create")).map((r) => r.version),
      ),
    ].sort();
    expect(dated).toEqual(["2026-01-15", "2026-08-07", "latest"]);
  });

  it("uses registerRoute paths as-is", async () => {
    const mounted: MountedRoute[] = [];
    const service = createService({
      name: "test",
      basePath: "/api/test",
      onRouteMounted: (route) => mounted.push(route),
    });
    const things = service.group("things");
    things.registerRoute("get", "/:id", "2025-03-15", async (c) =>
      c.json({ id: c.req.param("id") }),
    );
    service.build();

    expect(mounted.some((r) => r.path === "/api/test/2025-03-15/:id")).toBe(true);
  });

  it("withdraws through the group under the prefixed name", async () => {
    const service = buildTestService();
    const things = service.group("things");
    things.register(
      "get",
      "2026-01-15",
      async () => "x",
      (b) => b.withOutput(z.string()),
    );
    things.withdraw("get", "2026-08-07");
    const app = service.build();

    const res = await app.request("/api/test/2026-08-07/things.get", {
      method: "POST",
    });
    expect(res.status).toBe(410);
    const earlier = await app.request("/api/test/2026-01-15/things.get", {
      method: "POST",
    });
    expect(earlier.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("formats an unhandled throw as an unknown 500", async () => {
    const app = buildTestService()
      .register("things.fail", "2025-03-15", async (_c) => {
        throw new Error("something broke");
      })
      .build();

    const res = await app.request("/api/test/2025-03-15/things.fail", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    expect((await jsonBody(res)) as { code: string }).toMatchObject({
      code: "internal_error",
    });
  });

  it("serializes a HandledError", async () => {
    const app = buildTestService()
      .register("things.fail", "2025-03-15", async () => {
        throw new NotFoundError("thing_not_found", "Thing", "123");
      })
      .build();

    const res = await app.request("/api/test/2025-03-15/things.fail", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await jsonBody(res)) as {
      code: string;
      meta: { id: string };
    };
    expect(body.code).toBe("thing_not_found");
    expect(body.meta.id).toBe("123");
  });

  it("does not let an impostor choose its own status", async () => {
    const app = buildTestService()
      .register("things.fail", "2025-03-15", async () => {
        throw Object.assign(new Error("Not found"), {
          code: "thing_not_found",
          httpStatus: 404,
          meta: { id: "123" },
          serialize: () => ({
            code: "thing_not_found",
            meta: { id: "123" },
            httpStatus: 404,
            reasons: [],
          }),
        });
      })
      .build();

    const res = await app.request("/api/test/2025-03-15/things.fail", {
      method: "POST",
    });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

describe("response shapes", () => {
  it("lets a handler that declares no output build its own Response", async () => {
    const app = buildTestService()
      .register("things.raw", "2025-03-15", async (c) => c.text("raw response", 201))
      .build();

    const res = await app.request("/api/test/2025-03-15/things.raw", {
      method: "POST",
    });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("raw response");
  });

  it("serializes a null result as JSON null", async () => {
    const app = buildTestService()
      .register(
        "things.nullable",
        "2025-03-15",
        async () => null,
        (b) => b.withOutput(z.null()),
      )
      .build();

    const res = await app.request("/api/test/2025-03-15/things.nullable", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe("global middleware", () => {
  it("runs for every request", async () => {
    const calls: string[] = [];

    const app = createService({
      name: "test",
      basePath: "/api/test",
      middleware: [
        async (_c, next) => {
          calls.push("global");
          await next();
        },
      ],
    })
      .register(
        "things.list",
        "2025-03-15",
        async () => {
          calls.push("handler");
          return { ok: true };
        },
        (b) => b.withOutput(z.object({ ok: z.boolean() })),
      )
      .build();

    await app.request("/api/test/2025-03-15/things.list", { method: "POST" });
    expect(calls).toEqual(["global", "handler"]);
  });
});

describe("service configuration", () => {
  it("fails fast on malformed service or endpoint paths", () => {
    expect(() => createService({ name: " " })).toThrow(/must not be empty/);
    expect(() => createService({ name: "test", basePath: "api/test" }).build()).toThrow(
      /basePath must start/,
    );
  });
});
