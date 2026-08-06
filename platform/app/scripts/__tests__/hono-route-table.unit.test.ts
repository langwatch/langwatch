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
} from "../lib/hono-route-table";

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
