/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 */
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { internalSecret, publicEndpoint } from "../access-policy";
import { getRoutePolicy } from "../route-registry";
import { createServiceApp } from "../secured-app";

const noopSecret: MiddlewareHandler = async (_c, next) => next();

describe("SecuredApp", () => {
  describe("when a route is registered through access()", () => {
    it("records the route's policy in the registry under its full merged path", () => {
      const app = createServiceApp({
        basePath: "/api/__test_secured",
        family: "test-secured",
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
      expect(recorded?.family).toBe("test-secured");
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
        family: "test-chain",
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
        family: "test-public",
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

  describe("the compile-time guarantee", () => {
    /** @scenario "Registering a route without an access policy is a type error" */
    it("does not expose verb methods on the bare app — only via access()", () => {
      const app = createServiceApp({
        basePath: "/api/__test_guard",
        family: "test-guard",
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
