/**
 * @vitest-environment node
 *
 * The factory's whole job is that one declaration per endpoint feeds two
 * consumers that must never disagree: the route-policy registry the
 * authorization audit reads, and the enforcement chain that refuses requests.
 * These tests pin both halves structurally: every mount shape lands in the
 * registry (dated, latest, bare, and both version-namespace guards), the
 * enforcement chain runs project auth then the permission check, and an
 * endpoint that never declared a policy cannot build at all.
 *
 * @see specs/api-reference/run-plans-rest-api.feature
 */
import type { MiddlewareHandler } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getRoutePolicy } from "~/server/api/security";

const executionOrder: string[] = [];

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    canonicalAuthMiddleware: (async (_c, next) => {
      executionOrder.push("auth");
      await next();
    }) satisfies MiddlewareHandler,
    requirePermission:
      (permission: string, envelope: string): MiddlewareHandler =>
      async (_c, next) => {
        executionOrder.push(`permission:${permission}:${envelope}`);
        await next();
      },
  };
});

import { z } from "zod";
import { createProjectService } from "../project-service";
import { V1_API_VERSION } from "../version";

describe("createProjectService", () => {
  describe("given a service with one guarded endpoint", () => {
    let app: import("hono").Hono;

    beforeAll(() => {
      const { service, guard } = createProjectService({
        name: "toy-project",
        basePath: "/api/v1/toy-project",
      });
      app = service
        .version(V1_API_VERSION, (v) => {
          v.get(
            "/things",
            {
              ...guard("scenarios:view"),
              output: z.object({ ok: z.boolean() }),
              description: "toy",
              docs: { operationId: "listToyProjectThings" },
            },
            async () => ({ ok: true }),
          );
        })
        .build();
    });

    describe("when the service builds", () => {
      /** @scenario "A dated run plans path and the bare alias both answer" */
      it("registers the declared policy for the dated, latest and bare mounts", () => {
        for (const path of [
          `/api/v1/toy-project/${V1_API_VERSION}/things`,
          "/api/v1/toy-project/latest/things",
          "/api/v1/toy-project/things",
        ]) {
          const registered = getRoutePolicy("GET", path);
          expect(registered, path).toBeDefined();
          expect(registered?.policy).toEqual({
            kind: "permission",
            permission: "scenarios:view",
          });
          expect(registered?.family).toBe("v1-toy-project");
        }
      });

      it("publishes the project key as the family's credential class", () => {
        expect(
          getRoutePolicy("GET", "/api/v1/toy-project/things")?.credentialClass,
        ).toBe("project_api_key");
      });

      /** @scenario "An unknown run plans version segment answers 404" */
      it("registers both version-namespace guards as reasoned public endpoints", () => {
        const namespace =
          "/api/v1/toy-project/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
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
      it("runs auth, then the permission check in the canonical envelope", async () => {
        executionOrder.length = 0;

        const response = await app.request("/api/v1/toy-project/things");

        expect(response.status).toBe(200);
        expect(executionOrder).toEqual([
          "auth",
          "permission:scenarios:view:canonical",
        ]);
      });
    });
  });

  describe("given an endpoint that also carries its own middleware", () => {
    it("still runs the declared permission check the framework mounted", async () => {
      const { service, guard } = createProjectService({
        name: "toy-project-overwrite",
        basePath: "/api/v1/toy-project-overwrite",
      });
      const app = service
        .version(V1_API_VERSION, (v) => {
          v.get(
            "/things",
            {
              ...guard("scenarios:view"),
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
              docs: { operationId: "listOverwriteProjectThings" },
            },
            async () => ({ ok: true }),
          );
        })
        .build();

      executionOrder.length = 0;
      const response = await app.request(
        "/api/v1/toy-project-overwrite/things",
      );

      expect(response.status).toBe(200);
      expect(executionOrder).toEqual([
        "auth",
        "permission:scenarios:view:canonical",
        "endpoint-middleware",
      ]);
    });
  });

  describe("given a policy that promises a permission the config does not enforce", () => {
    it("fails the build naming both halves", () => {
      const { service, guard } = createProjectService({
        name: "toy-project-mismatch",
        basePath: "/api/v1/toy-project-mismatch",
      });

      expect(() =>
        service
          .version(V1_API_VERSION, (v) => {
            // Cast: the AccessDeclaration types refuse this shape outright;
            // the runtime cross-check is the layer under test.
            (v.get as (p: string, c: unknown, h: unknown) => void)(
              "/things",
              {
                ...guard("scenarios:view"),
                permission: undefined,
                noPermission: { reason: "policy/permission mismatch probe" },
                output: z.object({ ok: z.boolean() }),
              },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).toThrow(/declares policy "scenarios:view" but enforces "nothing"/);
    });
  });

  describe("given an endpoint declares no guard", () => {
    it("refuses an opt-out that carries no registered policy", () => {
      const { service } = createProjectService({
        name: "toy-project-policyless",
        basePath: "/api/v1/toy-project-policyless",
      });

      expect(() =>
        service
          .version(V1_API_VERSION, (v) => {
            v.get(
              "/things",
              {
                noPermission: { reason: "v1 routes always guard" },
                output: z.object({ ok: z.boolean() }),
              },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).toThrow(/declares no access policy/);
    });
  });
});
