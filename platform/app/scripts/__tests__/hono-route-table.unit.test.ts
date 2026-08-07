/**
 * @vitest-environment node
 *
 * scripts/lib/hono-route-table.ts.
 *
 * Two gates read the route table out of the app's own source, and both are
 * only as trustworthy as this parse. The failure mode that matters is silent
 * under-reporting: a registration this misses is a route neither gate can
 * notice is missing from the document, so the checks stay green while the
 * reference stays wrong. Every case below is a shape the repo actually
 * contains.
 */

import { describe, expect, it } from "vitest";

import {
  apiBasePathsOf,
  collectRouteRegistrations,
  honoPathToTemplate,
  joinRoutePath,
  serviceBasePathsOf,
} from "../lib/hono-route-table";

/** The import that tells the parse a framework shape is the framework's. */
const FRAMEWORK_IMPORT = 'import { createService } from "@langwatch/api";';

describe("honoPathToTemplate", () => {
  it("rewrites Hono parameters into OpenAPI templates", () => {
    expect(honoPathToTemplate("/api/gateway/v1/virtual-keys/:id/spend")).toBe(
      "/api/gateway/v1/virtual-keys/{id}/spend",
    );
  });

  it("rewrites every parameter in a multi-parameter path", () => {
    expect(
      honoPathToTemplate("/api/workflows/:workflowId/:versionId/run"),
    ).toBe("/api/workflows/{workflowId}/{versionId}/run");
  });

  describe("when a parameter carries a Hono regex constraint", () => {
    /** @scenario "A parameter's routing constraint does not reach the template" */
    it("drops the constraint, which has no OpenAPI equivalent", () => {
      // `{.+}` lets one parameter match a slash, so a prompt id can look like
      // a path. Left in, the template read `{idOrSlug}{.+}` and matched no
      // documented path at all, so the whole prompts surface read as missing.
      expect(honoPathToTemplate("/api/prompts/:idOrSlug{.+}")).toBe(
        "/api/prompts/{idOrSlug}",
      );
      expect(honoPathToTemplate("/api/prompts/:id{.+?}/versions")).toBe(
        "/api/prompts/{id}/versions",
      );
    });

    it("still rewrites the parameters around it", () => {
      expect(honoPathToTemplate("/api/prompts/:id{.+?}/tags/:tag")).toBe(
        "/api/prompts/{id}/tags/{tag}",
      );
    });
  });
});

describe("joinRoutePath", () => {
  it("joins a basePath to a route path without doubling the separator", () => {
    expect(
      joinRoutePath({ basePath: "/api/experiments", routePath: "/runs" }),
    ).toBe("/api/experiments/runs");
  });

  it("keeps the basePath alone when the route is the collection root", () => {
    expect(
      joinRoutePath({ basePath: "/api/experiments", routePath: "/" }),
    ).toBe("/api/experiments");
  });
});

describe("collectRouteRegistrations", () => {
  it("finds a registration whose path argument sits on the next line", () => {
    const registrations = collectRouteRegistrations(
      [
        'secured.access(requires("things:view")).get(',
        '  "/things",',
        '  zValidator("query", schema),',
        "  async (c) => c.json({}),",
        ");",
      ].join("\n"),
    );

    expect(registrations).toEqual([
      { method: "get", path: "/things", readsQuery: true, described: false },
    ]);
  });

  it("does not mistake a context read for a route", () => {
    const registrations = collectRouteRegistrations(
      [
        'secured.access(publicEndpoint("probe")).get("/health", (c) => {',
        '  const project = c.get("project");',
        '  cache.delete("stale");',
        "  return c.body(null, 204);",
        "});",
      ].join("\n"),
    );

    expect(registrations).toEqual([
      { method: "get", path: "/health", readsQuery: false, described: false },
    ]);
  });

  it("attributes a query read to the registration it sits inside", () => {
    const registrations = collectRouteRegistrations(
      [
        'secured.get("/first", async (c) => c.json({}));',
        'secured.get("/second", async (c) => {',
        '  const limit = c.req.query("limit");',
        "  return c.json({ limit });",
        "});",
      ].join("\n"),
    );

    expect(registrations).toEqual([
      { method: "get", path: "/first", readsQuery: false, described: false },
      { method: "get", path: "/second", readsQuery: true, described: false },
    ]);
  });

  describe("when a registration carries describeRoute", () => {
    it("marks that registration and not its neighbour", () => {
      const registrations = collectRouteRegistrations(
        [
          'secured.post("/init", describeRoute({ summary: "Create" }), async (c) =>',
          "  c.json({}),",
          ");",
          'secured.post("/authorize", async (c) => c.json({}));',
        ].join("\n"),
      );

      expect(registrations).toEqual([
        { method: "post", path: "/init", readsQuery: false, described: true },
        {
          method: "post",
          path: "/authorize",
          readsQuery: false,
          described: false,
        },
      ]);
    });
  });

  describe("when the file declares its service through @langwatch/api", () => {
    /** @scenario "An SSE endpoint is counted as a GET route" */
    it("reads an sse endpoint as the GET it is mounted as", () => {
      // The framework mounts `sse` with `app.get`, so a stream is one more
      // route on the surface: it is either documented or excluded like any
      // other GET. Read as a method of its own it would be neither, and a
      // whole endpoint would sit outside the gate.
      const registrations = collectRouteRegistrations(
        [
          FRAMEWORK_IMPORT,
          'v.sse("/runs/:id/events", { events: { token: Token } }, stream);',
        ].join("\n"),
      );

      expect(registrations).toEqual([
        {
          method: "get",
          path: "/runs/:id/events",
          readsQuery: false,
          described: false,
          sse: true,
        },
      ]);
    });

    it("marks a withdrawn endpoint, keeping the path it tombstones", () => {
      const registrations = collectRouteRegistrations(
        [
          FRAMEWORK_IMPORT,
          'v.withdraw("get", "/roles/:id/legacy");',
          'v.get("/roles/:id", { output: Role }, read);',
        ].join("\n"),
      );

      expect(registrations).toEqual([
        {
          method: "get",
          path: "/roles/:id/legacy",
          readsQuery: false,
          described: false,
          withdrawn: true,
        },
        {
          method: "get",
          path: "/roles/:id",
          readsQuery: false,
          described: true,
        },
      ]);
    });

    it("keeps spans in source order when a withdrawal precedes a read", () => {
      // The two shapes are matched by separate patterns. Merged by index they
      // span correctly; appended one list after the other, the withdrawal would
      // own the source from its own line to the end of the file and take the
      // query read below it with it.
      const registrations = collectRouteRegistrations(
        [
          FRAMEWORK_IMPORT,
          'v.withdraw("delete", "/roles/:id");',
          'v.get("/roles", { query: Filters }, async (c) => {',
          '  const scope = c.req.query("scope");',
          "  return list(scope);",
          "});",
        ].join("\n"),
      );

      expect(registrations).toEqual([
        {
          method: "delete",
          path: "/roles/:id",
          readsQuery: false,
          described: false,
          withdrawn: true,
        },
        {
          method: "get",
          path: "/roles",
          readsQuery: true,
          described: false,
        },
      ]);
    });

    it("counts an output schema as describing the endpoint", () => {
      const registrations = collectRouteRegistrations(
        [
          FRAMEWORK_IMPORT,
          'v.get("/roles", { output: RoleList }, list);',
          'v.post("/roles", { input: NewRole }, create);',
        ].join("\n"),
      );

      expect(registrations.map((r) => r.described)).toEqual([true, false]);
    });
  });

  describe("when the file has nothing to do with @langwatch/api", () => {
    it("does not read an output key as a described endpoint", () => {
      // `output:` is an ordinary word. Only the framework turns it into a
      // describeRoute, so only a file importing the framework may be read
      // that way.
      const registrations = collectRouteRegistrations(
        'secured.get("/things", async (c) => c.json({ output: result }));',
      );

      expect(registrations).toEqual([
        { method: "get", path: "/things", readsQuery: false, described: false },
      ]);
    });
  });
});

describe("serviceBasePathsOf", () => {
  it("derives /api/<name> from a service that only names itself", () => {
    const source = [
      FRAMEWORK_IMPORT,
      'export const app = createService({ name: "roles" }).build();',
    ].join("\n");

    expect(serviceBasePathsOf(source)).toEqual(["/api/roles"]);
  });

  it("reads a service that names its project type", () => {
    const source = [
      FRAMEWORK_IMPORT,
      'const app = createService<Project>({ name: "role-bindings" });',
    ].join("\n");

    expect(serviceBasePathsOf(source)).toEqual(["/api/role-bindings"]);
  });

  describe("when the config spells its basePath out", () => {
    it("derives nothing, because the explicit value is the served one", () => {
      const source = [
        FRAMEWORK_IMPORT,
        'createService({ name: "organization", basePath: "/api/organization" });',
      ].join("\n");

      // `apiBasePathsOf` reads that form already, and it is the form the
      // framework itself prefers. Deriving here too would only make it
      // possible to disagree.
      expect(serviceBasePathsOf(source)).toEqual([]);
      expect(apiBasePathsOf(source)).toEqual(["/api/organization"]);
    });
  });

  describe("when a name sits inside a nested option", () => {
    it("reads only the service's own name", () => {
      const source = [
        FRAMEWORK_IMPORT,
        "createService({",
        '  _legacy: { organizationMiddleware, name: "legacy" },',
        '  name: "roles",',
        "});",
      ].join("\n");

      expect(serviceBasePathsOf(source)).toEqual(["/api/roles"]);
    });
  });

  describe("when a file declares two services", () => {
    it("returns both, and repeats neither", () => {
      const source = [
        FRAMEWORK_IMPORT,
        'createService({ name: "roles" });',
        'createService({ name: "role-bindings" });',
        'createService({ name: "roles" });',
      ].join("\n");

      expect(serviceBasePathsOf(source)).toEqual([
        "/api/roles",
        "/api/role-bindings",
      ]);
    });
  });

  describe("when a test defines its own helper called createService", () => {
    /** @scenario "A test helper named createService declares no service" */
    it("declares no service, because the framework is not in the file", () => {
      // A billing unit test builds its subject with a local factory of that
      // name. Reading the call as a service declaration would invent an
      // `/api/eu` surface out of a fixture argument, and every route the gate
      // then thought lived there would be reported missing from the document.
      const source = [
        'function createService({ region = "us" } = {}) {',
        "  return { service: new NurturingService({ region }), fetchFn };",
        "}",
        'const { service } = createService({ name: "eu" });',
      ].join("\n");

      expect(serviceBasePathsOf(source)).toEqual([]);
    });
  });
});

describe("apiBasePathsOf", () => {
  it("reads the object-literal form the app builders use", () => {
    expect(
      apiBasePathsOf('createServiceApp({ basePath: "/api/experiments" })'),
    ).toEqual(["/api/experiments"]);
  });

  it("reads the chained form a bare Hono app uses", () => {
    expect(
      apiBasePathsOf('new Hono().basePath("/api/evaluations/v3")'),
    ).toEqual(["/api/evaluations/v3"]);
  });

  it("ignores a basePath outside the /api surface", () => {
    expect(apiBasePathsOf('basePath: "/internal/metrics"')).toEqual([]);
  });

  describe("when one file mounts two apps", () => {
    it("returns both, because both spellings are served", () => {
      const source = [
        'const secured = createServiceApp({ basePath: "/api/experiments" });',
        'export const legacyAliasApp = new Hono().basePath("/api/evaluations/v3");',
      ].join("\n");

      expect(apiBasePathsOf(source)).toEqual([
        "/api/experiments",
        "/api/evaluations/v3",
      ]);
    });

    it("does not repeat a basePath declared twice", () => {
      const source = [
        'createServiceApp({ basePath: "/api" });',
        'createServiceApp({ basePath: "/api" });',
      ].join("\n");

      expect(apiBasePathsOf(source)).toEqual(["/api"]);
    });
  });
});
