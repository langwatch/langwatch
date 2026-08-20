/**
 * @vitest-environment node
 *
 * The factory's whole job is that one declaration per endpoint feeds two
 * consumers that must never disagree: the route-policy registry the
 * authorization audit reads, and the enforcement chain that refuses requests.
 * These tests pin both halves structurally: every mount shape lands in the
 * registry (dated, latest, bare, and both version-namespace guards), the
 * enforcement chain runs auth, then the permission check, then the plan gate,
 * and an endpoint that never declared a policy cannot build at all.
 */
import type { MiddlewareHandler } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getRoutePolicy } from "~/server/api/security";

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
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/org-auth")>();
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
    await importOriginal<
      typeof import("~/app/api/middleware/enterprise-gate")
    >();
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
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.get(
            "/things",
            {
              ...guard("organization:manage"),
              output: z.object({ ok: z.boolean() }),
              description: "toy",
              docs: { operationId: "listToyThings" },
            },
            async () => ({ ok: true }),
          );
        })
        .build();
    });

    describe("when the service builds", () => {
      it("registers the declared policy for the dated, latest and bare mounts", () => {
        for (const path of [
          `/api/toy-management/${MANAGEMENT_API_VERSION}/things`,
          "/api/toy-management/latest/things",
          "/api/toy-management/things",
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
            expect(registered.policy.reason).toContain(
              "version-namespace guard",
            );
          }
        }
      });
    });

    describe("when a request reaches a guarded endpoint", () => {
      it("runs auth, then the permission check, then the plan gate, then the handler", async () => {
        executionOrder.length = 0;

        const response = await app.request("/api/toy-management/things");

        expect(response.status).toBe(200);
        expect(executionOrder).toEqual([
          "auth",
          "permission:organization:manage",
          "plan:MANAGEMENT_API",
        ]);
      });
    });
  });

  describe("given an endpoint that also carries its own middleware", () => {
    /** @scenario "An endpoint's middleware array cannot displace its declared check" */
    it("still runs the declared permission check the framework mounted", async () => {
      const { service, guard } = createManagementService({
        name: "toy-overwrite",
        basePath: "/api/toy-overwrite",
        feature: "MANAGEMENT_API",
      });
      const app = service
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.get(
            "/things",
            {
              ...guard("organization:manage"),
              // The overwrite that used to bypass enforcement: a middleware
              // key after the spread replaces the guard's array wholesale.
              middleware: [
                (async (_c, next) => {
                  executionOrder.push("endpoint-middleware");
                  await next();
                }) satisfies MiddlewareHandler,
              ],
              output: z.object({ ok: z.boolean() }),
              description: "toy",
              docs: { operationId: "listOverwriteThings" },
            },
            async () => ({ ok: true }),
          );
        })
        .build();

      executionOrder.length = 0;
      const response = await app.request("/api/toy-overwrite/things");

      expect(response.status).toBe(200);
      expect(executionOrder).toEqual([
        "auth",
        "permission:organization:manage",
        "endpoint-middleware",
      ]);
    });
  });

  describe("given a policy that promises a permission the config does not enforce", () => {
    /** @scenario "A registered policy that promises an unenforced permission fails the build" */
    it("fails the build naming both halves", () => {
      const { service, guard } = createManagementService({
        name: "toy-mismatch",
        basePath: "/api/toy-mismatch",
        feature: "MANAGEMENT_API",
      });

      expect(() =>
        service
          .version(MANAGEMENT_API_VERSION, (v) => {
            v.get(
              "/things",
              {
                ...guard("organization:manage"),
                permission: undefined,
                output: z.object({ ok: z.boolean() }),
              },
              async () => ({ ok: true }),
            );
          })
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
          .version(MANAGEMENT_API_VERSION, (v) => {
            v.get(
              "/things",
              { output: z.object({ ok: z.boolean() }) },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).toThrow(/declares no access policy/);
    });
  });
});
