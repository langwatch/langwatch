/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 */
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import {
  describeAccessPolicy,
  internalSecret,
  patPermission,
  publicEndpoint,
} from "../access-policy";
import { getRoutePolicy } from "../route-registry";
import { createProjectApp, createServiceApp } from "../secured-app";

const noopSecret: MiddlewareHandler = async (_c, next) => next();

describe("SecuredApp", () => {
  describe("when a route is registered through access()", () => {
    it("records the route's policy in the registry under its full merged path", () => {
      const app = createServiceApp({
        basePath: "/api/__test_secured",
        verifySecret: noopSecret,
      });

      app
        .access(internalSecret("unit test route"))
        .get("/ping", (c) => c.text("ok"));

      const recorded = getRoutePolicy("GET", "/api/__test_secured/ping");
      expect(recorded).toBeDefined();
      expect(recorded?.policy).toEqual({
        kind: "internal",
        reason: "unit test route",
      });
      // family is derived from basePath, never hand-passed.
      expect(recorded?.family).toBe("__test_secured");
    });
  });

  describe("when a route enforces a policy", () => {
    it("runs the strategy chain before the handler for non-public policies", async () => {
      const calls: string[] = [];
      const secret: MiddlewareHandler = async (_c, next) => {
        calls.push("secret");
        await next();
      };
      const app = createServiceApp({
        basePath: "/api/__test_chain",
        verifySecret: secret,
      });
      app.access(internalSecret("chain test")).get("/x", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const res = await app.hono.request("/api/__test_chain/x");
      expect(res.status).toBe(200);
      expect(calls).toEqual(["secret", "handler"]);
    });

    it("skips the auth chain for public policies", async () => {
      const calls: string[] = [];
      const secret: MiddlewareHandler = async (_c, next) => {
        calls.push("secret");
        await next();
      };
      const app = createServiceApp({
        basePath: "/api/__test_public",
        verifySecret: secret,
      });
      app.access(publicEndpoint("open probe")).get("/health", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const res = await app.hono.request("/api/__test_public/health");
      expect(res.status).toBe(200);
      expect(calls).toEqual(["handler"]); // secret middleware NOT run
    });
  });

  describe("when a project route declares a patPermission policy", () => {
    /** @scenario "A PAT-ceiling route records its real required permission" */
    it("records the real permission in the registry (not 'any authenticated')", () => {
      const app = createProjectApp({ basePath: "/api/__test_pat" });

      app
        .access(patPermission("virtualKeys:view"))
        .get("/keys", (c) => c.text("ok"));

      const recorded = getRoutePolicy("GET", "/api/__test_pat/keys");
      expect(recorded?.policy).toEqual({
        kind: "patPermission",
        permission: "virtualKeys:view",
      });
      expect(describeAccessPolicy(recorded!.policy)).toContain(
        "virtualKeys:view",
      );
    });
  });

  describe("when an any-method route is registered with .all()", () => {
    /** @scenario "An any-method route enforces its policy on every method" */
    it("records method ALL and runs the strategy chain before the handler", async () => {
      const calls: string[] = [];
      const secret: MiddlewareHandler = async (_c, next) => {
        calls.push("secret");
        await next();
      };
      const app = createServiceApp({
        basePath: "/api/__test_all",
        verifySecret: secret,
      });
      app.access(internalSecret("any-method shim")).all("/everything", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const recorded = getRoutePolicy("ALL", "/api/__test_all/everything");
      expect(recorded?.policy).toEqual({
        kind: "internal",
        reason: "any-method shim",
      });

      for (const method of ["GET", "POST", "DELETE"] as const) {
        calls.length = 0;
        const res = await app.hono.request("/api/__test_all/everything", {
          method,
        });
        expect(res.status).toBe(200);
        expect(calls).toEqual(["secret", "handler"]);
      }
    });
  });

  describe("the compile-time guarantee", () => {
    /** @scenario "Registering a route without an access policy is a type error" */
    it("does not expose verb methods on the bare app — only via access()", () => {
      const app = createServiceApp({
        basePath: "/api/__test_guard",
        verifySecret: noopSecret,
      });

      // @ts-expect-error — verb methods are not on the bare app; you must go
      // through access(policy) first. If this ever compiles, the guarantee is
      // broken and tsgo flags the unused @ts-expect-error.
      const leaked = app.get;
      void leaked;

      // Runtime: the bare app genuinely has no `.get`.
      expect((app as unknown as { get?: unknown }).get).toBeUndefined();
    });
  });
});
