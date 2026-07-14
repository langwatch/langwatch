import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import { generateSpecs } from "hono-openapi";
import { getCurrentContext } from "@langwatch/observability/context";

import { createService } from "../builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTestService() {
  return createService({ name: "test", basePath: "/api/test" });
}

async function makeRequest(
  app: ReturnType<ReturnType<typeof createService>["build"]>,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return app.request(path, options);
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// createService + build
// ---------------------------------------------------------------------------

describe("createService", () => {
  describe("when building a minimal service with one version", () => {
    it("responds to versioned path", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/items", { output: z.array(z.string()) }, async () => {
            return ["a", "b"];
          });
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual(["a", "b"]);
    });

    it("responds to latest path", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ ok: z.boolean() }) },
            async () => {
              return { ok: true };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/latest/items");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ ok: true });
    });

    it("responds to bare path (no version) as latest alias", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ ok: z.boolean() }) },
            async () => {
              return { ok: true };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/items");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ ok: true });
    });
  });

  describe("when requesting an unknown version", () => {
    it("returns 404", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/items", {}, async (c) => c.json({ ok: true }));
        })
        .build();

      const res = await makeRequest(app, "/api/test/2099-01-01/items");
      expect(res.status).toBe(404);
    });
  });

  describe("when registering an invalid or duplicate version", () => {
    it("fails fast instead of silently dropping endpoints", () => {
      const service = buildTestService();

      expect(() => service.version("2025-02-30", () => {})).toThrow(
        /Invalid API version/,
      );

      service.version("2025-02-28", () => {});
      expect(() => service.version("2025-02-28", () => {})).toThrow(
        /registered more than once/,
      );
    });
  });

  describe("when service or endpoint paths are malformed", () => {
    it("fails fast with an actionable error", () => {
      expect(() => createService({ name: " " })).toThrow(/must not be empty/);
      expect(() =>
        createService({ name: "test", basePath: "api/test" }).build(),
      ).toThrow(/basePath must start/);
      expect(() =>
        buildTestService().version("2025-03-15", (v) => {
          v.get("items", {}, async (c) => c.body(null, 204));
        }),
      ).toThrow(/Endpoint path must start/);
    });

    it("rejects endpoints in the reserved version namespace", () => {
      for (const path of [
        "/latest",
        "/preview/items",
        "/2025-03-15/items",
        "/2025-02-30/items",
      ]) {
        expect(() =>
          buildTestService().version("2025-03-15", (v) => {
            v.get(path, {}, async (c) => c.body(null, 204));
          }),
        ).toThrow(/reserved API version namespace/);
      }
    });
  });

  describe("when a version namespace misses a route", () => {
    it("does not fall through to a dynamic unversioned endpoint", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/:id/:child",
            { params: z.object({ id: z.string(), child: z.string() }) },
            async (c, { params }) => c.json(params),
          );
        })
        .build();

      expect((await makeRequest(app, "/api/test/latest/missing")).status).toBe(
        404,
      );
      expect(
        (await makeRequest(app, "/api/test/2099-01-01/missing")).status,
      ).toBe(404);

      const bare = await makeRequest(app, "/api/test/item-1/detail");
      expect(bare.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// .provide() -- provider injection
// ---------------------------------------------------------------------------

describe("provide", () => {
  describe("when providers are registered", () => {
    it("makes them available in the handler via app context", async () => {
      const app = buildTestService()
        .provide({
          greeting: () => "hello from provider",
        })
        .version("2025-03-15", (v) => {
          v.get(
            "/greet",
            { output: z.object({ message: z.string() }) },
            async (_c, { app }) => {
              return { message: app.greeting };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/greet");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ message: "hello from provider" });
    });
  });

  describe("when providers are async", () => {
    it("resolves them before the handler runs", async () => {
      const app = buildTestService()
        .provide({
          data: async () => {
            return { loaded: true };
          },
        })
        .version("2025-03-15", (v) => {
          v.get(
            "/data",
            { output: z.object({ loaded: z.boolean() }) },
            async (_c, { app }) => {
              return app.data;
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/data");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ loaded: true });
    });
  });

  describe("when providers are added after a version", () => {
    it("preserves the endpoints already registered on the fluent builder", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/health",
            { output: z.literal("ok") },
            async () => "ok" as const,
          );
        })
        .provide({ dependency: () => "available" })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toBe("ok");
    });
  });

  describe("when a provider uses a reserved BaseApp key", () => {
    it("rejects the provider instead of overwriting request context", () => {
      expect(() =>
        buildTestService().provide({ project: () => ({ id: "wrong" }) }),
      ).toThrow(/reserved by BaseApp/);
    });
  });

  describe("when auth resolves request context", () => {
    it("makes that context available to providers before the handler runs", async () => {
      const auth: MiddlewareHandler = async (c, next) => {
        c.set("organization", { id: "org-1" });
        c.set("project", { id: "project-1" });
        c.set("user", { id: "user-1" });
        await next();
      };

      const app = createService({ name: "test", basePath: "/api/test", auth })
        .provide({ requestContext: () => getCurrentContext() })
        .version("2025-03-15", (v) => {
          v.get(
            "/context",
            {
              output: z.object({
                organizationId: z.string(),
                projectId: z.string(),
                userId: z.string(),
              }),
            },
            async (_c, { app }) => ({
              organizationId: app.requestContext?.organizationId ?? "missing",
              projectId: app.requestContext?.projectId ?? "missing",
              userId: app.requestContext?.userId ?? "missing",
            }),
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/context");
      expect(await res.json()).toEqual({
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Input / output validation
// ---------------------------------------------------------------------------

describe("input validation", () => {
  describe("when valid input is provided", () => {
    it("passes parsed input to the handler", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.post(
            "/items",
            {
              input: z.object({ name: z.string() }),
              output: z.object({ created: z.string() }),
            },
            async (_c, { input }) => {
              return { created: input.name };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test-item" }),
      });

      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ created: "test-item" });
    });
  });

  describe("when invalid input is provided", () => {
    it("returns a validation error", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.post(
            "/items",
            {
              input: z.object({ name: z.string().min(1) }),
              output: z.object({ created: z.string() }),
            },
            async (_c, { input }) => {
              return { created: input.name };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(res.status).toBe(422);
      expect(await jsonBody(res)).toMatchObject({
        kind: "validation_error",
        reasons: [
          {
            code: "schema_failure",
            meta: { field: "name", type: "too_small" },
          },
        ],
      });
      expect(res.headers.get("X-API-Version")).toBe("2025-03-15");
    });
  });
});

describe("output validation", () => {
  describe("when handler returns data matching the output schema", () => {
    it("serializes and returns the validated output", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ id: z.number(), name: z.string() }) },
            async () => {
              return { id: 1, name: "item", extraField: "stripped" };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items");
      expect(res.status).toBe(200);
      // Zod .parse strips extra fields
      expect(await jsonBody(res)).toEqual({ id: 1, name: "item" });
    });
  });

  describe("when handler output violates the declared schema", () => {
    it("returns an internal error instead of blaming the client", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ id: z.number() }) },
            async () => ({ id: "not-a-number" }) as never,
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items");

      expect(res.status).toBe(500);
      expect(await jsonBody(res)).toEqual({
        kind: "internal_error",
        message: "Internal server error",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Params and query validation
// ---------------------------------------------------------------------------

describe("params validation", () => {
  describe("when params schema is provided", () => {
    it("passes parsed params to the handler", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items/:id",
            {
              params: z.object({ id: z.string() }),
              output: z.object({ id: z.string() }),
            },
            async (_c, { params }) => {
              return { id: params.id };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items/abc");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ id: "abc" });
    });
  });
});

describe("query validation", () => {
  describe("when query schema is provided", () => {
    it("passes parsed query to the handler", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            {
              query: z.object({ page: z.string() }),
              output: z.object({ page: z.string() }),
            },
            async (_c, { query }) => {
              return { page: query.page };
            },
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items?page=2");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ page: "2" });
    });
  });
});

// ---------------------------------------------------------------------------
// Per-endpoint options
// ---------------------------------------------------------------------------

describe("per-endpoint auth option", () => {
  describe("when auth is 'none'", () => {
    it("skips the auth middleware", async () => {
      const authMiddleware: MiddlewareHandler = vi.fn(async (_c, next) => {
        await next();
      });

      const app = createService({
        name: "test",
        basePath: "/api/test",
        auth: authMiddleware,
      })
        .version("2025-03-15", (v) => {
          v.get(
            "/public",
            { auth: "none", output: z.object({ open: z.boolean() }) },
            async () => ({ open: true }),
          );
          v.get(
            "/private",
            { output: z.object({ secret: z.boolean() }) },
            async () => ({ secret: true }),
          );
        })
        .build();

      // Public endpoint -- auth should NOT be called
      const publicRes = await makeRequest(app, "/api/test/2025-03-15/public");
      expect(publicRes.status).toBe(200);

      // Private endpoint -- auth SHOULD be called
      await makeRequest(app, "/api/test/2025-03-15/private");
      expect(authMiddleware).toHaveBeenCalled();
    });

    it("skips legacy organization resolution that depends on auth", async () => {
      const authMiddleware: MiddlewareHandler = vi.fn(async (c, next) => {
        c.set("project", { id: "project-1" });
        await next();
      });
      const organizationMiddleware: MiddlewareHandler = vi.fn(
        async (c, next) => {
          if (!c.get("project")) {
            return c.json({ error: "without project" }, 500);
          }
          await next();
        },
      );

      const app = createService({
        name: "test",
        basePath: "/api/test",
        auth: authMiddleware,
        _legacy: { organizationMiddleware },
      })
        .version("2025-03-15", (v) => {
          v.get(
            "/public",
            { auth: "none", output: z.object({ open: z.boolean() }) },
            async () => ({ open: true }),
          );
        })
        .build();

      const response = await makeRequest(app, "/api/test/2025-03-15/public");
      expect(response.status).toBe(200);
      expect(authMiddleware).not.toHaveBeenCalled();
      expect(organizationMiddleware).not.toHaveBeenCalled();
    });
  });
});

describe("per-endpoint middleware", () => {
  describe("when custom middleware is provided", () => {
    it("runs the middleware before the handler", async () => {
      const order: string[] = [];

      const customMiddleware: MiddlewareHandler = async (_c, next) => {
        order.push("custom-middleware");
        await next();
      };

      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            {
              middleware: [customMiddleware],
              output: z.object({ ok: z.boolean() }),
            },
            async () => {
              order.push("handler");
              return { ok: true };
            },
          );
        })
        .build();

      await makeRequest(app, "/api/test/2025-03-15/items");
      expect(order).toEqual(["custom-middleware", "handler"]);
    });
  });
});

describe("resource limit middleware", () => {
  describe("when resourceLimit is set and factory is provided", () => {
    it("applies the resource limit middleware", async () => {
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
        .version("2025-03-15", (v) => {
          v.post(
            "/items",
            {
              resourceLimit: "items",
              output: z.object({ ok: z.boolean() }),
            },
            async () => ({ ok: true }),
          );
        })
        .build();

      await makeRequest(app, "/api/test/2025-03-15/items", { method: "POST" });
      expect(resourceLimitCalled).toHaveBeenCalledWith("items");
    });
  });

  describe("when a resource limit is declared without its middleware factory", () => {
    it("fails closed while building the service", () => {
      const service = buildTestService().version("2025-03-15", (v) => {
        v.post("/items", { resourceLimit: "items" }, async (c) =>
          c.body(null, 204),
        );
      });

      expect(() => service.build()).toThrow(/has no resourceLimitMiddleware/);
    });
  });
});

// ---------------------------------------------------------------------------
// Versioning behavior (via builder)
// ---------------------------------------------------------------------------

describe("version forward-copying via builder", () => {
  describe("when v2 inherits endpoints from v1", () => {
    it("makes v1 endpoints available in v2", async () => {
      const app = buildTestService()
        .version("2025-01-01", (v) => {
          v.get(
            "/items",
            { output: z.object({ from: z.string() }) },
            async () => ({
              from: "v1",
            }),
          );
        })
        .version("2025-06-01", (v) => {
          v.get(
            "/new",
            { output: z.object({ from: z.string() }) },
            async () => ({
              from: "v2",
            }),
          );
        })
        .build();

      // v2 should have the inherited /items endpoint
      const res = await makeRequest(app, "/api/test/2025-06-01/items");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ from: "v1" });

      // v2 should have its own /new endpoint
      const newRes = await makeRequest(app, "/api/test/2025-06-01/new");
      expect(newRes.status).toBe(200);
      expect(await jsonBody(newRes)).toEqual({ from: "v2" });
    });
  });

  describe("when an endpoint is withdrawn", () => {
    it("returns 410 Gone for the withdrawn endpoint", async () => {
      const app = buildTestService()
        .version("2025-01-01", (v) => {
          v.get(
            "/old",
            { output: z.object({ ok: z.boolean() }) },
            async () => ({
              ok: true,
            }),
          );
          v.get(
            "/kept",
            { output: z.object({ ok: z.boolean() }) },
            async () => ({
              ok: true,
            }),
          );
        })
        .version("2025-06-01", (v) => {
          v.withdraw("get", "/old");
        })
        .build();

      // /old should be 410 in v2 with version headers
      const oldRes = await makeRequest(app, "/api/test/2025-06-01/old");
      expect(oldRes.status).toBe(410);
      const oldBody = await jsonBody(oldRes);
      expect((oldBody as { kind: string }).kind).toBe("endpoint_withdrawn");
      expect(oldRes.headers.get("X-API-Version")).toBe("2025-06-01");
      expect(oldRes.headers.get("X-API-Version-Status")).toBe("stable");

      // /old should still work in v1
      const v1Res = await makeRequest(app, "/api/test/2025-01-01/old");
      expect(v1Res.status).toBe(200);

      // /kept should still work in v2
      const keptRes = await makeRequest(app, "/api/test/2025-06-01/kept");
      expect(keptRes.status).toBe(200);
    });

    it("keeps inherited auth and endpoint middleware on the 410 response", async () => {
      const calls: string[] = [];
      const auth: MiddlewareHandler = async (_c, next) => {
        calls.push("auth");
        await next();
      };
      const endpointMiddleware: MiddlewareHandler = async (_c, next) => {
        calls.push("endpoint");
        await next();
      };

      const app = createService({ name: "test", basePath: "/api/test", auth })
        .version("2025-01-01", (v) => {
          v.get("/old", { middleware: [endpointMiddleware] }, async (c) =>
            c.json({ ok: true }),
          );
        })
        .version("2025-06-01", (v) => {
          v.withdraw("get", "/old");
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-06-01/old");
      expect(res.status).toBe(410);
      expect(calls).toEqual(["auth", "endpoint"]);
      expect(res.headers.get("X-API-Version")).toBe("2025-06-01");
    });
  });
});

// ---------------------------------------------------------------------------
// OpenAPI metadata
// ---------------------------------------------------------------------------

describe("OpenAPI responses", () => {
  it("documents the configured success status", async () => {
    const app = buildTestService()
      .version("2025-03-15", (v) => {
        v.post(
          "/items",
          { output: z.object({ id: z.string() }), status: 201 },
          async () => ({ id: "item-1" }),
        );
      })
      .build();

    const spec = await generateSpecs(app);
    expect(
      spec.paths["/api/test/2025-03-15/items"]?.post?.responses,
    ).toHaveProperty("201");
    expect(
      spec.paths["/api/test/2025-03-15/items"]?.post?.responses,
    ).not.toHaveProperty("200");
  });

  it("adds a default success response for description-only routes", async () => {
    const app = buildTestService()
      .version("2025-03-15", (v) => {
        v.get("/health", { description: "Health check" }, async (c) =>
          c.text("ok"),
        );
      })
      .build();

    const spec = await generateSpecs(app);
    expect(
      spec.paths["/api/test/2025-03-15/health"]?.get?.responses,
    ).toHaveProperty("200");
  });
});

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

describe("version response headers", () => {
  describe("when a versioned request is made", () => {
    it("sets X-API-Version and X-API-Version-Status headers", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ ok: z.boolean() }) },
            async () => ({
              ok: true,
            }),
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/items");
      expect(res.headers.get("X-API-Version")).toBe("2025-03-15");
      expect(res.headers.get("X-API-Version-Status")).toBe("stable");
    });
  });

  describe("when a latest request is made", () => {
    it("sets status to latest", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ ok: z.boolean() }) },
            async () => ({
              ok: true,
            }),
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/latest/items");
      expect(res.headers.get("X-API-Version")).toBe("latest");
      expect(res.headers.get("X-API-Version-Status")).toBe("latest");
    });
  });

  describe("when a bare path request is made", () => {
    it("sets status to unversioned", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ ok: z.boolean() }) },
            async () => ({
              ok: true,
            }),
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/items");
      expect(res.headers.get("X-API-Version-Status")).toBe("unversioned");
    });
  });
});

// ---------------------------------------------------------------------------
// Preview endpoints
// ---------------------------------------------------------------------------

describe("preview", () => {
  describe("when preview endpoints are registered", () => {
    it("makes them available at /preview/ path", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ stable: z.boolean() }) },
            async () => ({
              stable: true,
            }),
          );
        })
        .preview((v) => {
          v.get(
            "/beta",
            { output: z.object({ preview: z.boolean() }) },
            async () => ({
              preview: true,
            }),
          );
        })
        .build();

      const res = await makeRequest(app, "/api/test/preview/beta");
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ preview: true });
    });

    it("does not include preview endpoints in latest", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ stable: z.boolean() }) },
            async () => ({
              stable: true,
            }),
          );
        })
        .preview((v) => {
          v.get(
            "/beta",
            { output: z.object({ preview: z.boolean() }) },
            async () => ({
              preview: true,
            }),
          );
        })
        .build();

      // /beta should not exist under latest
      const res = await makeRequest(app, "/api/test/latest/beta");
      expect(res.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// Error handler integration
// ---------------------------------------------------------------------------

describe("error handling", () => {
  describe("when a handler throws an error", () => {
    it("catches and formats the error", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/fail", {}, async () => {
            throw new Error("something broke");
          });
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/fail");
      expect(res.status).toBe(500);
      const body = (await jsonBody(res)) as { kind: string };
      expect(body.kind).toBe("internal_error");
    });
  });

  describe("when a handler throws a DomainError-like error", () => {
    it("serializes it correctly", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/fail", {}, async () => {
            const err = Object.assign(new Error("Not found"), {
              kind: "thing_not_found",
              httpStatus: 404,
              meta: { id: "123" },
              serialize() {
                return {
                  kind: "thing_not_found",
                  meta: { id: "123" },
                  telemetry: { traceId: undefined, spanId: undefined },
                  httpStatus: 404,
                  reasons: [],
                };
              },
            });
            throw err;
          });
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/fail");
      expect(res.status).toBe(404);
      const body = (await jsonBody(res)) as {
        kind: string;
        meta: { id: string };
      };
      expect(body.kind).toBe("thing_not_found");
      expect(body.meta.id).toBe("123");
    });
  });
});

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

describe("global middleware", () => {
  describe("when global middleware is provided", () => {
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
        .version("2025-03-15", (v) => {
          v.get(
            "/items",
            { output: z.object({ ok: z.boolean() }) },
            async () => {
              calls.push("handler");
              return { ok: true };
            },
          );
        })
        .build();

      await makeRequest(app, "/api/test/2025-03-15/items");
      expect(calls).toEqual(["global", "handler"]);
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP methods
// ---------------------------------------------------------------------------

describe("HTTP methods", () => {
  function buildMethodApp() {
    return buildTestService()
      .version("2025-03-15", (v) => {
        v.get("/r", { output: z.literal("get") }, async () => "get" as const);
        v.post(
          "/r",
          { output: z.literal("post") },
          async () => "post" as const,
        );
        v.put("/r", { output: z.literal("put") }, async () => "put" as const);
        v.delete(
          "/r",
          { output: z.literal("del") },
          async () => "del" as const,
        );
        v.patch(
          "/r",
          { output: z.literal("patch") },
          async () => "patch" as const,
        );
      })
      .build();
  }

  it("handles GET", async () => {
    const app = buildMethodApp();
    expect(
      await (await makeRequest(app, "/api/test/2025-03-15/r")).json(),
    ).toBe("get");
  });

  it("handles POST", async () => {
    const app = buildMethodApp();
    expect(
      await (
        await makeRequest(app, "/api/test/2025-03-15/r", { method: "POST" })
      ).json(),
    ).toBe("post");
  });

  it("handles PUT", async () => {
    const app = buildMethodApp();
    expect(
      await (
        await makeRequest(app, "/api/test/2025-03-15/r", { method: "PUT" })
      ).json(),
    ).toBe("put");
  });

  it("handles DELETE", async () => {
    const app = buildMethodApp();
    expect(
      await (
        await makeRequest(app, "/api/test/2025-03-15/r", { method: "DELETE" })
      ).json(),
    ).toBe("del");
  });

  it("handles PATCH", async () => {
    const app = buildMethodApp();
    expect(
      await (
        await makeRequest(app, "/api/test/2025-03-15/r", { method: "PATCH" })
      ).json(),
    ).toBe("patch");
  });
});

// ---------------------------------------------------------------------------
// Handler returning raw Response (no output schema)
// ---------------------------------------------------------------------------

describe("raw Response return", () => {
  describe("when no output schema is set", () => {
    it("allows the handler to return a raw Response", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/raw", {}, async (c) => {
            return c.text("raw response", 201);
          });
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/raw");
      expect(res.status).toBe(201);
      expect(await res.text()).toBe("raw response");
    });
  });
});

// ---------------------------------------------------------------------------
// Null return (should serialize as JSON null, not 204)
// ---------------------------------------------------------------------------

describe("null return", () => {
  describe("when handler returns null with an output schema", () => {
    it("serializes as JSON null", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/nullable", { output: z.null() }, async () => {
            return null;
          });
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/nullable");
      expect(res.status).toBe(200);
      expect(await res.json()).toBeNull();
    });
  });

  describe("when handler returns undefined", () => {
    it("returns 204 No Content", async () => {
      const app = buildTestService()
        .version("2025-03-15", (v) => {
          v.get("/void", { output: z.undefined() }, async () => undefined);
        })
        .build();

      const res = await makeRequest(app, "/api/test/2025-03-15/void");
      expect(res.status).toBe(204);
    });
  });
});
