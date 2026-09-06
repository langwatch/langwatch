/**
 * @see specs/security/api-endpoint-authorization.feature
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { publicEndpoint, requires } from "../../../access-policy.js";
import type { RegisteredRoute } from "../route-registry.js";
import { assertEveryRouteDeclared, undeclaredRoutes } from "../route-declaration.js";

function declared(
  method: string,
  path: string,
  extra: Partial<RegisteredRoute> = {},
): RegisteredRoute {
  return {
    method,
    path,
    policy: requires("traces:view"),
    family: "fixture",
    credentialClass: "project_api_key",
    ...extra,
  };
}

function fixtureApp(routes: Array<[string, string]>): Hono {
  const app = new Hono();
  for (const [method, path] of routes) {
    app.on(method, path, (c) => c.text("ok"));
  }
  return app;
}

describe("given a composed app and the route registry", () => {
  describe("when every mounted route is registered", () => {
    /** @scenario "A mounted route with no declared policy stops the boot" */
    it("lets the composition through", () => {
      const app = fixtureApp([
        ["GET", "/api/fixture/things"],
        ["POST", "/api/fixture/things"],
      ]);
      const registry = [
        declared("GET", "/api/fixture/things"),
        declared("POST", "/api/fixture/things"),
      ];

      expect(undeclaredRoutes({ app, registry })).toEqual([]);
      expect(() => assertEveryRouteDeclared({ app, registry })).not.toThrow();
    });
  });

  describe("when a route was mounted around the builder", () => {
    /** @scenario "A mounted route with no declared policy stops the boot" */
    it("throws naming the method and path", () => {
      const app = fixtureApp([
        ["GET", "/api/fixture/things"],
        ["GET", "/api/fixture/bypass"],
      ]);
      const registry = [declared("GET", "/api/fixture/things")];

      expect(undeclaredRoutes({ app, registry })).toEqual(["GET /api/fixture/bypass"]);
      expect(() => assertEveryRouteDeclared({ app, registry })).toThrow(
        /GET \/api\/fixture\/bypass/,
      );
    });
  });

  describe("when a registered route also answers at its canonical twin", () => {
    /** @scenario "A mounted route with no declared policy stops the boot" */
    it("accepts both addresses from the one registration", () => {
      const app = fixtureApp([
        ["GET", "/api/fixture/things"],
        ["GET", "/api/v1/fixture/things"],
      ]);
      const registry = [
        declared("GET", "/api/fixture/things", { canonicalPath: "/api/v1/fixture/things" }),
      ];

      expect(undeclaredRoutes({ app, registry })).toEqual([]);
    });
  });

  describe("when the mount is app-level middleware rather than an endpoint", () => {
    /** @scenario "A mounted route with no declared policy stops the boot" */
    it("ignores wildcard ALL mounts on both sides", () => {
      const app = fixtureApp([["ALL", "/api/fixture/*"]]);

      expect(undeclaredRoutes({ app, registry: [] })).toEqual([]);
    });
  });

  describe("when several routes were mounted around the builder", () => {
    /** @scenario "A mounted route with no declared policy stops the boot" */
    it("names every one of them once", () => {
      const app = fixtureApp([
        ["GET", "/api/fixture/one"],
        ["POST", "/api/fixture/two"],
        ["GET", "/api/fixture/one"],
      ]);
      const registry = [
        declared("GET", "/api/fixture/allowed", { policy: publicEndpoint("open") }),
      ];

      expect(undeclaredRoutes({ app, registry })).toEqual([
        "GET /api/fixture/one",
        "POST /api/fixture/two",
      ]);
    });
  });
});
