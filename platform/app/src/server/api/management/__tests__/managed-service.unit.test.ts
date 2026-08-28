/**
 * @vitest-environment node
 *
 * The factory's whole job is that one declaration per endpoint feeds two
 * consumers that must never disagree: the route-policy registry the
 * authorization audit reads, and the enforcement chain that refuses requests.
 * These tests pin both halves structurally: every mount shape lands in the
 * registry (dated, latest, both version-namespace guards, and the rpc.discover
 * catalogue mounts), the enforcement chain runs auth, then the permission
 * check, then the plan gate, and an endpoint that never declared a policy
 * cannot build at all.
 */
import type { MiddlewareHandler } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getRoutePolicy } from "@langwatch/platform-api/app-rest";

const executionOrder: string[] = [];

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    createOrgAuthMiddleware: (): MiddlewareHandler => async (_c, next) => {
      executionOrder.push("auth");
      await next();
    },
  };
});

vi.mock("~/app/api/middleware/org-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/app/api/middleware/org-auth")>();
  return {
    ...actual,
    requireOrgPermissionOrThrow:
      (permission: string): MiddlewareHandler =>
      async (_c, next) => {
        executionOrder.push(`permission:${permission}`);
        await next();
      },
  };
});

vi.mock("~/app/api/middleware/enterprise-gate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/enterprise-gate")>();
  return {
    ...actual,
    requireEnterprisePlanRest:
      (feature: string): MiddlewareHandler =>
      async (_c, next) => {
        executionOrder.push(`plan:${feature}`);
        await next();
      },
  };
});

import { z } from "zod";
import { createManagementService } from "../managed-service";
import { MANAGEMENT_API_VERSION } from "../version";

describe("createManagementService", () => {
  describe("given a service with one guarded endpoint", () => {
    let app: import("hono").Hono;

    beforeAll(() => {
      const { service, guard } = createManagementService({
        name: "toy-management",
        basePath: "/api/toy-management",
        feature: "MANAGEMENT_API",
      });
      app = service
        .registerRoute(
          "get",
          "/things",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            guard("organization:manage")(b)
              .withOutput(z.object({ ok: z.boolean() }))
              .withDocs({ operationId: "listToyThings", description: "toy" }),
        )
        .build();
    });

    describe("when the service builds", () => {
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
        const namespace =
          "/api/toy-management/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
        for (const path of [namespace, `${namespace}/*`]) {
          const registered = getRoutePolicy("ALL", path);
          expect(registered, path).toBeDefined();
          expect(registered?.policy.kind).toBe("public");
          if (registered?.policy.kind === "public") {
            expect(registered.policy.reason).toContain("version-namespace guard");
          }
        }
      });

      it("registers the rpc.discover catalogue mounts as reasoned public endpoints", () => {
        for (const path of [
          `/api/toy-management/${MANAGEMENT_API_VERSION}/rpc.discover`,
          "/api/toy-management/latest/rpc.discover",
        ]) {
          const registered = getRoutePolicy("POST", path);
          expect(registered, path).toBeDefined();
          expect(registered?.policy.kind).toBe("public");
          if (registered?.policy.kind === "public") {
            expect(registered.policy.reason).toContain("rpc.discover");
          }
        }
      });
    });

    describe("when a request reaches a guarded endpoint", () => {
      it("runs auth, then the permission check, then the plan gate, then the handler", async () => {
        executionOrder.length = 0;

        const response = await app.request(
          `/api/toy-management/${MANAGEMENT_API_VERSION}/things`,
        );

        expect(response.status).toBe(200);
        expect(executionOrder).toEqual([
          "auth",
          "permission:organization:manage",
          "plan:MANAGEMENT_API",
        ]);
      });
    });
  });

  describe("given a guarded endpoint adds its own middleware", () => {
    it("keeps the declared permission check in the framework-owned chain", async () => {
      const { service, guard } = createManagementService({
        name: "toy-additive",
        basePath: "/api/toy-additive",
        feature: "MANAGEMENT_API",
      });
      const app = service
        .registerRoute(
          "get",
          "/things",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (builder) =>
            guard("organization:manage")(builder)
              .withMiddleware(async (_context, next) => {
                executionOrder.push("endpoint-middleware");
                await next();
              })
              .withOutput(z.object({ ok: z.boolean() })),
        )
        .build();

      executionOrder.length = 0;
      const response = await app.request(
        `/api/toy-additive/${MANAGEMENT_API_VERSION}/things`,
      );

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
      const { service, guard } = createManagementService({
        name: "toy-mismatch",
        basePath: "/api/toy-mismatch",
        feature: "MANAGEMENT_API",
      });

      expect(() =>
        service
          .registerRoute(
            "get",
            "/things",
            MANAGEMENT_API_VERSION,
            async () => ({ ok: true }),
            (builder) =>
              guard("organization:manage")(builder)
                .withoutPermission("policy mismatch probe")
                .withOutput(z.object({ ok: z.boolean() })),
          )
          .build(),
      ).toThrow(/declares policy "organization:manage" but enforces "nothing"/);
    });
  });

  describe("given an endpoint declares no guard", () => {
    it("refuses to build rather than mounting an unclassified route", () => {
      const { service } = createManagementService({
        name: "toy-unguarded",
        basePath: "/api/toy-unguarded",
        feature: "MANAGEMENT_API",
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

    it("refuses an explicit opt-out with no registered management policy", () => {
      const { service } = createManagementService({
        name: "toy-policyless",
        basePath: "/api/toy-policyless",
        feature: "MANAGEMENT_API",
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
                .withoutPermission("management routes always guard")
                .withOutput(z.object({ ok: z.boolean() })),
          )
          .build(),
      ).toThrow(/declares no access policy/);
    });
  });
});
