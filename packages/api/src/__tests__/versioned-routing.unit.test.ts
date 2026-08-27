import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import type { EndpointRegistration, MountedRoute } from "../types.js";
import { isDateVersion } from "../types.js";
import { matchPath } from "../route-mounting.js";
import { type RegistrationEvent, resolveVersions } from "../versioning.js";

// ---------------------------------------------------------------------------
// resolveVersions: the version catalogue is the union of versions named in
// register calls, and inheritance falls out of the data — an endpoint serves
// at version V its latest registration dated on or before V.
// ---------------------------------------------------------------------------

function makeEndpoint(overrides: Partial<EndpointRegistration> = {}): EndpointRegistration {
  return {
    kind: "rpc",
    method: "post",
    path: "/things.list",
    config: {},
    handler: () => ({ ok: true }),
    ...overrides,
  };
}

function event(version: string, endpoint: Partial<EndpointRegistration> = {}): RegistrationEvent {
  return { version, endpoint: makeEndpoint(endpoint) };
}

describe("resolveVersions", () => {
  it("rejects invalid calendar dates", () => {
    expect(() => resolveVersions([event("2025-02-30")])).toThrow(/Invalid API version/);
  });

  it("resolves a single version and creates the latest alias", () => {
    const result = resolveVersions([event("2025-03-15")]);

    expect(result.get("2025-03-15")).toHaveLength(1);
    expect(result.get("latest")).toEqual(result.get("2025-03-15"));
    expect(result.has("preview")).toBe(false);
  });

  it("forward-copies endpoints and serves the latest registration on or before each version", () => {
    const v1Handler = () => ({ version: 1 });
    const v2Handler = () => ({ version: 2 });

    const result = resolveVersions([
      event("2025-01-01", { handler: v1Handler }),
      event("2025-06-01", { path: "/things.new" }),
      event("2025-06-01", { handler: v2Handler }),
    ]);

    // v1 has only its own registration
    expect(result.get("2025-01-01")).toHaveLength(1);

    // v2 inherits and overrides: two endpoints, the override's handler wins
    const v2 = result.get("2025-06-01")!;
    expect(v2).toHaveLength(2);
    const overridden = v2.find((ep) => ep.path === "/things.list")!;
    expect(overridden.withdrawn).not.toBe(true);
    if (!overridden.withdrawn) {
      expect(overridden.handler).toBe(v2Handler);
    }

    // latest points at the newest dated version
    expect(result.get("latest")).toEqual(result.get("2025-06-01"));
  });

  it("sorts versions provided out of order chronologically", () => {
    const v2Handler = () => ({ latest: true });
    const result = resolveVersions([
      event("2025-06-01", { handler: v2Handler }),
      event("2025-01-01", { path: "/things.old" }),
    ]);

    const latest = result.get("latest")!;
    expect(latest).toHaveLength(2);
    const ep = latest.find((e) => e.path === "/things.list")!;
    if (!ep.withdrawn) expect(ep.handler).toBe(v2Handler);
  });

  it("marks an endpoint withdrawn from its version onward, keeping the inherited config", () => {
    const config = { meta: { policy: "things:read" } };
    const result = resolveVersions([
      event("2025-01-01", { config }),
      { version: "2025-06-01", endpoint: makeEndpoint({ withdrawn: true }) },
    ]);

    expect(result.get("2025-01-01")![0]!.withdrawn).not.toBe(true);

    const v2 = result.get("2025-06-01")![0]!;
    expect(v2.withdrawn).toBe(true);
    expect(v2.config).toEqual(config);

    // latest is withdrawn too: the document and the wire agree
    expect(result.get("latest")![0]!.withdrawn).toBe(true);
  });

  it("withdraws one method and path without withdrawing its sibling", () => {
    const result = resolveVersions([
      event("2025-01-01", { kind: "rest", method: "get", path: "/things/:id" }),
      event("2025-01-01", { kind: "rest", method: "delete", path: "/things/:id" }),
      {
        version: "2025-06-01",
        endpoint: makeEndpoint({
          kind: "rest",
          method: "get",
          path: "/things/:id",
          withdrawn: true,
        }),
      },
    ]);

    const endpoints = result.get("2025-06-01")!;
    expect(endpoints.find((endpoint) => endpoint.method === "get")?.withdrawn).toBe(true);
    expect(endpoints.find((endpoint) => endpoint.method === "delete")?.withdrawn).not.toBe(true);
  });

  it("refuses ambiguous public REST route shapes", () => {
    expect(() =>
      resolveVersions([
        event("2025-01-01", {
          kind: "public-rest",
          method: "get",
          path: "/things/:id",
        }),
        event("2025-01-01", {
          kind: "public-rest",
          method: "get",
          path: "/things/:name",
        }),
      ]),
    ).toThrow(/overlap/);
  });

  it("refuses public REST policy drift across date versions", () => {
    expect(() =>
      resolveVersions([
        event("2025-01-01", {
          kind: "public-rest",
          method: "get",
          path: "/things",
          config: { meta: { policy: "one" } },
        }),
        event("2025-06-01", {
          kind: "public-rest",
          method: "get",
          path: "/things",
          config: { meta: { policy: "two" } },
        }),
      ]),
    ).toThrow(/changes its mounted access policy/);
  });

  it("compares declarative access policy rather than middleware identity", () => {
    expect(() =>
      resolveVersions([
        event("2025-01-01", {
          kind: "public-rest",
          method: "get",
          path: "/things",
          config: {
            meta: { audience: ["member"], policy: "things:read" },
            middleware: [async () => {}],
          },
        }),
        event("2025-06-01", {
          kind: "public-rest",
          method: "get",
          path: "/things",
          config: {
            cache: { tag: "things-v2", ttlSeconds: 30 },
            deprecated: "Use /widgets",
            meta: { policy: "things:read", audience: ["member"] },
            middleware: [async () => {}],
          },
        }),
      ]),
    ).not.toThrow();
  });

  it.each(["/things/:id?", "/things/:id{\\d+}", "/things/*", "/things/:id/:id"])(
    "rejects unsupported modern REST route grammar in %s",
    (path) => {
      expect(() =>
        resolveVersions([
          event("2025-01-01", {
            kind: "public-rest",
            method: "get",
            path,
          }),
        ]),
      ).toThrow(/unique, required, unconstrained :name parameters/);
    },
  );

  it("leaves compatibility route grammar unchanged", () => {
    expect(() =>
      resolveVersions([
        event("2025-01-01", {
          kind: "rest",
          method: "get",
          path: "/things/:id?",
        }),
      ]),
    ).not.toThrow();
  });

  it("keeps preview endpoints in their own namespace, out of latest", () => {
    const result = resolveVersions([
      event("2025-01-01"),
      event("preview", { path: "/things.beta" }),
    ]);

    expect(result.get("preview")).toHaveLength(1);
    expect(result.get("preview")![0]!.path).toBe("/things.beta");
    expect(result.get("latest")!.map((ep) => ep.path)).not.toContain("/things.beta");
  });

  it("applies a preview withdrawal within the preview namespace only", () => {
    const result = resolveVersions([
      event("2025-01-01", { path: "/things.beta" }),
      event("preview", { path: "/things.beta" }),
      {
        version: "preview",
        endpoint: makeEndpoint({ path: "/things.beta", withdrawn: true }),
      },
    ]);

    expect(result.get("preview")![0]!.withdrawn).toBe(true);
    // The dated registration of the same path is untouched.
    const dated = result.get("2025-01-01")!;
    expect(dated.find((ep) => ep.path === "/things.beta")!.withdrawn).not.toBe(true);
  });
});

describe("isDateVersion", () => {
  it("accepts real dates and rejects impossible calendar dates", () => {
    expect(isDateVersion("2024-02-29")).toBe(true);
    expect(isDateVersion("2025-02-29")).toBe(false);
    expect(isDateVersion("2025-13-01")).toBe(false);
    expect(isDateVersion("v1")).toBe(false);
  });
});

describe("date fallback path matching", () => {
  it.each(["a%2Fb", "%41%ZZ"])(
    "decodes path parameter %s exactly like Hono",
    async (encoded) => {
      const app = new Hono().get("/:id", (context) => context.json(context.req.param()));
      const response = await app.request(`/${encoded}`);

      await expect(response.json()).resolves.toEqual(matchPath("/:id", `/${encoded}`));
    },
  );
});

// ---------------------------------------------------------------------------
// Routing behavior (specs/versioned-routing.feature)
// ---------------------------------------------------------------------------

function buildRoutedService(onRouteMounted?: (route: MountedRoute) => void) {
  return createService({
    name: "things",
    basePath: "/api/things",
    logger: false,
    tracer: false,
    onRouteMounted,
  })
    .register(
      "things.list",
      "2026-01-15",
      async () => ["january"],
      (b) => b.withOutput(z.array(z.string())),
    )
    .register(
      "things.list",
      "2026-08-07",
      async () => ["august"],
      (b) => b.withOutput(z.array(z.string())),
    )
    .register(
      "things.get",
      "2026-01-15",
      async () => "kept",
      (b) => b.withOutput(z.string()),
    )
    .withdraw("things.get", "2026-08-07")
    .register(
      "things.experimental",
      "preview",
      async () => "beta",
      (b) => b.withOutput(z.string()),
    )
    .build();
}

describe("explicit version namespaces", () => {
  it("serves a dated URL with the latest registration on or before it", async () => {
    const app = buildRoutedService();

    const res = await app.request("/api/things/2026-03-01/things.list", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(["january"]);
    expect(res.headers.get("X-API-Version")).toBe("2026-03-01");
    expect(res.headers.get("X-API-Version-Status")).toBe("stable");
  });

  it("serves the newest registrations under latest", async () => {
    const app = buildRoutedService();

    const res = await app.request("/api/things/latest/things.list", {
      method: "POST",
    });

    await expect(res.json()).resolves.toEqual(["august"]);
    expect(res.headers.get("X-API-Version")).toBe("latest");
    expect(res.headers.get("X-API-Version-Status")).toBe("latest");
  });

  it("keeps preview separate from latest", async () => {
    const app = buildRoutedService();

    const underLatest = await app.request("/api/things/latest/things.experimental", {
      method: "POST",
    });
    expect(underLatest.status).toBe(404);

    const underPreview = await app.request("/api/things/preview/things.experimental", {
      method: "POST",
    });
    expect(underPreview.status).toBe(200);
    expect(underPreview.headers.get("X-API-Version-Status")).toBe("preview");
  });

  it("answers 404 from the namespace guard when no version segment is given", async () => {
    const mounted: MountedRoute[] = [];
    const app = buildRoutedService((route) => mounted.push(route));

    const res = await app.request("/api/things/things.list", {
      method: "POST",
    });

    expect(res.status).toBe(404);
    // From the guard, not from a missing route: the catch-all guard is a real,
    // reported route, and no endpoint mount ever answered for the bare path.
    const guards = mounted.filter((route) => route.isNamespaceGuard);
    expect(guards.length).toBeGreaterThan(0);
    expect(
      mounted.some((route) => !route.isNamespaceGuard && route.path === "/api/things/things.list"),
    ).toBe(false);
    expect(res.headers.get("X-API-Version")).toBeNull();
  });

  it("rejects an unknown version namespace with a 404", async () => {
    const app = buildRoutedService();

    for (const path of [
      // Not a real calendar date.
      "/api/things/2026-13-99/things.list",
      // Not a date at all.
      "/api/things/v1/things.list",
      // A real date before the first registration.
      "/api/things/2020-01-01/things.list",
    ]) {
      const res = await app.request(path, { method: "POST" });
      expect(res.status).toBe(404);
    }
  });

  it("serves a real date past every registration with the newest registrations", async () => {
    const app = buildRoutedService();

    const res = await app.request("/api/things/2099-01-01/things.list", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(["august"]);
    // The header names the namespace that was asked for.
    expect(res.headers.get("X-API-Version")).toBe("2099-01-01");
    expect(res.headers.get("X-API-Version-Status")).toBe("stable");
  });

  it("answers 410 from the withdrawal version onward, with the version headers", async () => {
    const app = buildRoutedService();

    const withdrawn = await app.request("/api/things/2026-08-07/things.get", {
      method: "POST",
    });
    expect(withdrawn.status).toBe(410);
    const body = (await withdrawn.json()) as { code: string; retryable: boolean };
    expect(body).toEqual(expect.objectContaining({ code: "endpoint_withdrawn", retryable: false }));
    expect(withdrawn.headers.get("X-API-Version")).toBe("2026-08-07");
    expect(withdrawn.headers.get("X-API-Version-Status")).toBe("stable");

    const latest = await app.request("/api/things/latest/things.get", {
      method: "POST",
    });
    expect(latest.status).toBe(410);

    // ...including real dates past the withdrawal that were never registered.
    const later = await app.request("/api/things/2026-12-31/things.get", {
      method: "POST",
    });
    expect(later.status).toBe(410);
    expect(later.headers.get("X-API-Version")).toBe("2026-12-31");

    const earlier = await app.request("/api/things/2026-01-15/things.get", {
      method: "POST",
    });
    expect(earlier.status).toBe(200);
  });

  it("keeps the legacy name withdrawal compatible with SSE", async () => {
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
    })
      .registerSse("things.watch", "2026-01-15", async (_context, stream) => {
        stream.close();
      })
      .withdraw("things.watch", "2026-08-07")
      .build();

    const response = await app.request("/api/things/2026-08-07/things.watch");

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: "endpoint_withdrawn" });
  });

  it("keeps the legacy path withdrawal compatible with one non-POST operation", async () => {
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
    })
      .registerRoute("get", "/legacy", "2026-01-15", async () => ({ ok: true }), (builder) =>
        builder.withOutput(z.object({ ok: z.boolean() })),
      )
      .withdraw("/legacy", "2026-08-07")
      .build();

    const response = await app.request("/api/things/2026-08-07/legacy");

    expect(response.status).toBe(410);
  });

  it("carries the version headers on error responses too", async () => {
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
    })
      .register(
        "things.create",
        "2026-01-15",
        async () => ({}),
        (b) => b.withInput(z.object({ name: z.string() })).withOutput(z.object({})),
      )
      .build();

    const res = await app.request("/api/things/2026-01-15/things.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("X-API-Version")).toBe("2026-01-15");
    expect(res.headers.get("X-API-Version-Status")).toBe("stable");
  });
});
