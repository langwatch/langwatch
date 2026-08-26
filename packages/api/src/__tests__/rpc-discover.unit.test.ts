import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import type { ServiceCatalogue } from "../discover.js";
import type { MountedRoute } from "../types.js";

// ---------------------------------------------------------------------------
// rpc.discover (specs/api-discovery.feature): every service serves its own RPC
// catalogue at /api/{service}/{version}/rpc.discover, derived from the same
// registrations the document is generated from. It is meta: never documented,
// and no catalogue ever lists another catalogue.
// ---------------------------------------------------------------------------

const OPENAPI_URL = "/.well-known/openapi";

function buildDiscoverService(onRouteMounted?: (route: MountedRoute) => void) {
  return (
    createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
      openapiUrl: OPENAPI_URL,
      onRouteMounted,
    })
      .register(
        "things.create",
        "2026-01-15",
        async (_c, input: { name: string }) => input,
        (b) =>
          b
            .withInput(z.object({ name: z.string() }))
            .withOutput(z.object({ name: z.string() }))
            .withStatus(201)
            .withDocs({
              operationId: "createThing",
              summary: "Create a thing",
              description: "Creates one thing.",
              tags: ["Things"],
            }),
      )
      // Undocumented: no output, no docs — never reaches the catalogue.
      .register("things.internal", "2026-01-15", async (c) => c.body(null, 204))
      // Hidden: documented shape but opted out — never reaches the catalogue.
      .register(
        "things.hidden",
        "2026-01-15",
        async () => "x",
        (b) => b.withOutput(z.string()).withDocs({ hide: true }),
      )
      // A REST route and a stream are not RPCs, catalogue or no.
      .registerRoute(
        "get",
        "/:id",
        "2026-01-15",
        async (_c, input: { id: string }) => input,
        (b) =>
          b
            .withParams(z.object({ id: z.string() }))
            .withOutput(z.object({ id: z.string() }))
            .withDocs({ operationId: "getThing" }),
      )
      .registerSse(
        "things.watch",
        "2026-01-15",
        async (_c, stream) => {
          stream.close();
        },
        (b) => b.withEvents({ tick: z.object({ n: z.number() }) }),
      )
      // A later override: the v2 catalogue carries the v2 schemas and paths.
      .register(
        "things.create",
        "2026-08-07",
        async () => ({ id: "1" }),
        (b) =>
          b
            .withOutput(z.object({ id: z.string() }))
            .withDocs({ operationId: "createThingV2" }),
      )
      // Preview-only: never documented, so never catalogued, even under preview.
      .register(
        "things.beta",
        "preview",
        async () => "beta",
        (b) => b.withOutput(z.string()),
      )
      .build()
  );
}

async function discover(
  app: ReturnType<typeof buildDiscoverService>,
  namespace: string,
): Promise<{ status: number; body: ServiceCatalogue; headers: Headers }> {
  const res = await app.request(`/api/things/${namespace}/rpc.discover`, {
    method: "POST",
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("rpc.discover", () => {
  it("lists the namespace's documented RPC operations with their schemas", async () => {
    const app = buildDiscoverService();

    const { status, body } = await discover(app, "2026-01-15");

    expect(status).toBe(200);
    expect(body.openapi).toBe(OPENAPI_URL);
    expect(body.operations).toEqual([
      {
        name: "things.create",
        path: "/api/things/2026-01-15/things.create",
        operationId: "createThing",
        summary: "Create a thing",
        description: "Creates one thing.",
        input: expect.objectContaining({
          type: "object",
          properties: { name: { type: "string" } },
        }),
        output: expect.objectContaining({ type: "object" }),
        status: 201,
      },
    ]);
  });

  it("serves each namespace that namespace's mounts", async () => {
    const app = buildDiscoverService();

    const latest = await discover(app, "latest");
    expect(latest.body.operations.map((op) => op.path)).toEqual([
      "/api/things/latest/things.create",
    ]);
    // The override's shape and docs, not the original's.
    expect(latest.body.operations[0]?.operationId).toBe("createThingV2");
    expect(latest.body.operations[0]?.status).toBe(200);
    expect(latest.body.operations[0]?.input).toBeNull();

    const v2 = await discover(app, "2026-08-07");
    expect(v2.body.operations.map((op) => op.path)).toEqual([
      "/api/things/2026-08-07/things.create",
    ]);
  });

  it("answers with version headers like any mount of the namespace", async () => {
    const app = buildDiscoverService();

    const { headers } = await discover(app, "2026-01-15");

    expect(headers.get("X-API-Version")).toBe("2026-01-15");
    expect(headers.get("X-API-Version-Status")).toBe("stable");
  });

  it("reports no operation the document does not carry", async () => {
    const app = buildDiscoverService();
    const spec = await generateSpecs(app, { excludeStaticFile: false });

    for (const namespace of ["2026-01-15", "2026-08-07", "latest"]) {
      const { body } = await discover(app, namespace);
      for (const operation of body.operations) {
        // Every operation the catalogue reports is a path the document carries.
        expect(spec.paths).toHaveProperty(operation.path);
      }
      // And the inverse direction the rule names: internal, hidden, REST and
      // SSE endpoints are nowhere in the catalogue.
      const names = body.operations.map((op) => op.name);
      expect(names).not.toContain("things.internal");
      expect(names).not.toContain("things.hidden");
      expect(names).not.toContain("things.watch");
    }
  });

  it("answers an empty catalogue under preview, still pointing at the document", async () => {
    const app = buildDiscoverService();

    const { status, body } = await discover(app, "preview");

    expect(status).toBe(200);
    expect(body.operations).toEqual([]);
    expect(body.openapi).toBe(OPENAPI_URL);
  });

  it("never reaches the document and never lists itself", async () => {
    const app = buildDiscoverService();
    const spec = await generateSpecs(app, { excludeStaticFile: false });

    const documented = Object.keys(spec.paths ?? {});
    expect(documented.filter((path) => path.includes("rpc.discover"))).toEqual([]);

    for (const namespace of ["2026-01-15", "latest"]) {
      const { body } = await discover(app, namespace);
      expect(body.operations.map((op) => op.name)).not.toContain("rpc.discover");
    }
  });

  it("omits the document pointer when the service declares no openapiUrl", async () => {
    const app = createService({
      name: "things",
      basePath: "/api/things",
      logger: false,
      tracer: false,
    })
      .register(
        "things.list",
        "2026-01-15",
        async () => [],
        (b) => b.withOutput(z.array(z.string())),
      )
      .build();

    const res = await app.request("/api/things/latest/rpc.discover", {
      method: "POST",
    });
    const body = (await res.json()) as ServiceCatalogue;

    expect(body).not.toHaveProperty("openapi");
    expect(body.operations).toHaveLength(1);
  });

  it("is reported on the mount report as a discover mount with no config", () => {
    const mounted: MountedRoute[] = [];
    buildDiscoverService((route) => mounted.push(route));

    const discoverMounts = mounted.filter((route) => route.isDiscoverEndpoint);
    expect(discoverMounts.length).toBeGreaterThan(0);
    for (const route of discoverMounts) {
      expect(route.method).toBe("post");
      expect(route.path).toMatch(/\/rpc\.discover$/);
      expect(route.config).toBeNull();
      expect(route.withdrawn).toBe(false);
    }
    // One per namespace: two dated, latest, preview.
    expect(discoverMounts.map((route) => route.version).sort()).toEqual([
      "2026-01-15",
      "2026-08-07",
      "latest",
      "preview",
    ]);
  });
});
