/**
 * The REST service's whole job is that one declaration per endpoint feeds two
 * consumers that must never disagree: the route-policy registry the
 * authorization audit reads, and the enforcement chain that refuses requests.
 * These tests pin both halves structurally for a versioned family: every mount
 * shape lands in the registry (dated, latest and both version-namespace
 * guards), the enforcement chain runs auth, then the permission check, then
 * the family's route middleware — the Enterprise plan gate in production —
 * and an endpoint that never declared a policy cannot build at all.
 *
 * No module mocking: every check is a port, so the fakes below ARE the process
 * the service is bound to.
 */
import type { MiddlewareHandler } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createAppRestSecurity,
  getRoutePolicy,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";

const executionOrder: string[] = [];

const recording =
  (label: string): MiddlewareHandler =>
  async (_c, next) => {
    executionOrder.push(label);
    await next();
  };

const passthrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

/**
 * The plan gate as a versioned family really receives it: an ordinary
 * middleware the mount hands over, which the service knows nothing about.
 */
const enterpriseGate = recording("plan:MANAGEMENT_API");

const security = createAppRestSecurity({
  appContext: passthrough,
  requestLogger: () => passthrough,
  requestTracer: () => passthrough,
  legacyErrorHandler: (error, c) => c.json({ error: error.message }, 500),
  canonicalErrorHandler: (error, c) => c.json({ error: { message: error.message } }, 500),

  authenticateProject: () => passthrough,
  authorizeProjectPermission: () => passthrough,
  authorizeApiKeyCeiling: () => passthrough,
  authenticateOrganization: () => passthrough,
  authorizeOrganizationPermission: () => passthrough,
  authorizeRouteProjectPermission: () => passthrough,

  authenticateOrganizationThrowing: recording("auth"),
  authorizeOrganizationPermissionThrowing: (permission) => recording(`permission:${permission}`),
});

describe("createVersionedApp", () => {
  describe("given a family with one guarded endpoint", () => {
    let app: import("hono").Hono;

    beforeAll(() => {
      const { service, policy } = security.createVersionedApp({
        name: "toy-management",
        basePath: "/api/toy-management",
        routeMiddleware: [enterpriseGate],
      });
      app = service
        .registerRoute(
          "get",
          "/things",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            policy("organization:manage")(b)
              .withOutput(z.object({ ok: z.boolean() }))
              .withDocs({ operationId: "listToyThings", description: "toy" }),
        )
        .build();
    });

    describe("when the family builds", () => {
      it("registers the declared policy for the dated and latest mounts", () => {
        for (const path of [
          `/api/toy-management/${MANAGEMENT_API_VERSION}/things`,
          "/api/toy-management/latest/things",
        ]) {
          const registered = getRoutePolicy("GET", path);
          expect(registered, path).toBeDefined();
          expect(registered?.policy).toEqual({
            kind: "permission",
            permission: "organization:manage",
          });
          expect(registered?.family).toBe("toy-management");
        }
      });

      it("registers both version-namespace guards as reasoned public endpoints", () => {
        const namespace = "/api/toy-management/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
        for (const path of [namespace, `${namespace}/*`]) {
          const registered = getRoutePolicy("ALL", path);
          expect(registered, path).toBeDefined();
          expect(registered?.policy.kind).toBe("public");
          if (registered?.policy.kind === "public") {
            expect(registered.policy.reason).toContain("version-namespace guard");
          }
        }
      });
    });

    describe("when a request reaches a guarded endpoint", () => {
      it("runs auth, then the permission check, then the plan gate, then the handler", async () => {
        executionOrder.length = 0;

        const response = await app.request(`/api/toy-management/${MANAGEMENT_API_VERSION}/things`);

        expect(response.status).toBe(200);
        expect(executionOrder).toEqual([
          "auth",
          "permission:organization:manage",
          "plan:MANAGEMENT_API",
        ]);
      });
    });
  });

  describe("given a policy-bearing endpoint adds its own middleware", () => {
    it("keeps the declared permission check in the framework-owned chain", async () => {
      const { service, policy } = security.createVersionedApp({
        name: "toy-additive",
        basePath: "/api/toy-additive",
        routeMiddleware: [enterpriseGate],
      });
      const app = service
        .registerRoute(
          "get",
          "/things",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (builder) =>
            policy("organization:manage")(builder)
              .withMiddleware(async (_context, next) => {
                executionOrder.push("endpoint-middleware");
                await next();
              })
              .withOutput(z.object({ ok: z.boolean() })),
        )
        .build();

      executionOrder.length = 0;
      const response = await app.request(`/api/toy-additive/${MANAGEMENT_API_VERSION}/things`);

      expect(response.status).toBe(200);
      expect(executionOrder).toEqual([
        "auth",
        "permission:organization:manage",
        "plan:MANAGEMENT_API",
        "endpoint-middleware",
      ]);
    });
  });

  describe("given policy metadata and enforcement disagree", () => {
    it("refuses the route at build time", () => {
      const { service, policy } = security.createVersionedApp({
        name: "toy-mismatch",
        basePath: "/api/toy-mismatch",
        routeMiddleware: [enterpriseGate],
      });

      expect(() =>
        service
          .registerRoute(
            "get",
            "/things",
            MANAGEMENT_API_VERSION,
            async () => ({ ok: true }),
            (builder) =>
              policy("organization:manage")(builder)
                .withoutPermission("policy mismatch probe")
                .withOutput(z.object({ ok: z.boolean() })),
          )
          .build(),
      ).toThrow(/declares policy "organization:manage" but enforces "nothing"/);
    });
  });

  describe("given an endpoint declares no policy", () => {
    it("refuses to build rather than mounting an unclassified route", () => {
      const { service } = security.createVersionedApp({
        name: "toy-unguarded",
        basePath: "/api/toy-unguarded",
        routeMiddleware: [enterpriseGate],
      });

      expect(() =>
        service
          .registerRoute(
            "get",
            "/things",
            MANAGEMENT_API_VERSION,
            async () => ({ ok: true }),
            (b) => b.withOutput(z.object({ ok: z.boolean() })),
          )
          .build(),
      ).toThrow(/must declare exactly one of/);
    });

    it("refuses an explicit opt-out with no registered access policy", () => {
      const { service } = security.createVersionedApp({
        name: "toy-policyless",
        basePath: "/api/toy-policyless",
        routeMiddleware: [enterpriseGate],
      });

      expect(() =>
        service
          .registerRoute(
            "get",
            "/things",
            MANAGEMENT_API_VERSION,
            async () => ({ ok: true }),
            (builder) =>
              builder
                .withoutPermission("versioned routes always declare a policy")
                .withOutput(z.object({ ok: z.boolean() })),
          )
          .build(),
      ).toThrow(/declares no access policy/);
    });
  });
});
