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
          v.rpc(
            "/things.list",
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
          `/api/toy-management/${MANAGEMENT_API_VERSION}/things.list`,
          "/api/toy-management/latest/things.list",
          "/api/toy-management/things.list",
        ]) {
          const registered = getRoutePolicy("POST", path);
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

        const response = await app.request("/api/toy-management/things.list", {
          method: "POST",
        });

        expect(response.status).toBe(200);
        expect(executionOrder).toEqual([
          "auth",
          "permission:organization:manage",
          "plan:MANAGEMENT_API",
        ]);
      });
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
            v.rpc(
              "/things.list",
              { output: z.object({ ok: z.boolean() }) },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).toThrow(/declares no access policy/);
    });
  });

  /**
   * The one way to hold this factory wrong. `guard()` returns the policy AND
   * the chain that enforces it, so an endpoint that supplies its own middleware
   * by writing `{ ...guard(p), middleware: [mine] }` replaces the chain instead
   * of extending it. Nothing downstream notices: `meta.policy` survives, so the
   * route-policy registry — and the authorization audit that reads it — still
   * report the endpoint as guarded while the permission check and the plan gate
   * no longer run. Passing the extra middleware THROUGH guard is the fix, and
   * this pins it.
   */
  describe("given a guarded endpoint supplies its own middleware", () => {
    it("keeps the permission check and the plan gate ahead of it", async () => {
      const { service, guard } = createManagementService({
        name: "toy-extra",
        basePath: "/api/toy-extra",
        feature: "MANAGEMENT_API",
      });
      const ownMiddleware: MiddlewareHandler = async (_c, next) => {
        executionOrder.push("endpoint-own");
        await next();
      };
      const app = service
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.rpc(
            "/things.list",
            {
              ...guard("organization:manage", { extra: [ownMiddleware] }),
              output: z.object({ ok: z.boolean() }),
            },
            async () => ({ ok: true }),
          );
        })
        .build();
      executionOrder.length = 0;

      const response = await app.request("/api/toy-extra/things.list", {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(executionOrder).toEqual([
        "auth",
        "permission:organization:manage",
        "plan:MANAGEMENT_API",
        "endpoint-own",
      ]);
    });

    it("still registers the declared policy", () => {
      const registered = getRoutePolicy("POST", "/api/toy-extra/things.list");

      expect(registered?.policy).toEqual({
        kind: "permission",
        permission: "organization:manage",
      });
    });
  });

  /**
   * Passing `extra` is the safe spelling, but until now nothing MADE it the
   * only one — the unsafe spelling merely went unwritten. The mount callback
   * now checks that a route declaring a policy still carries the chain that
   * enforces it, so the bypass fails the build instead of shipping a route
   * that authenticates and then admits anyone.
   */
  describe("given an endpoint overwrites the guard's middleware", () => {
    function buildWithOverwrittenMiddleware(): void {
      const { service, guard } = createManagementService({
        name: "toy-bypass",
        basePath: "/api/toy-bypass",
        feature: "MANAGEMENT_API",
      });
      const ownMiddleware: MiddlewareHandler = async (_c, next) => {
        await next();
      };
      service
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.rpc(
            "/things.list",
            {
              ...guard("organization:manage"),
              middleware: [ownMiddleware],
              output: z.object({ ok: z.boolean() }),
            },
            async () => ({ ok: true }),
          );
        })
        .build();
    }

    it("refuses to build", () => {
      expect(buildWithOverwrittenMiddleware).toThrow(
        /missing the permission and plan check/,
      );
    });
  });

  /**
   * `@langwatch/api` still exposes the resource-REST helpers — it is a general
   * framework, and SSE plus the four pre-ADR-094 families need them. What makes
   * RPC the only way to add a LangWatch management endpoint is this factory:
   * it is the single product caller of `createService`, so a new family cannot
   * reach the verb helpers without going through the check these pin.
   */
  describe("given a family added after the webhooks pilot", () => {
    /** @scenario A new family may not register a resource-REST route */
    it("refuses a resource-REST route", () => {
      const { service: svc, guard } = createManagementService({
        name: "toy-rest-newcomer",
        basePath: "/api/toy-rest-newcomer",
        feature: "MANAGEMENT_API",
      });

      expect(() =>
        svc
          .version(MANAGEMENT_API_VERSION, (v) => {
            v.get(
              "/things",
              {
                ...guard("organization:manage"),
                output: z.object({ ok: z.boolean() }),
              },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).toThrow(/is not RPC-named/);
    });

    it("names the legacy families it is not one of", () => {
      const { service: svc, guard } = createManagementService({
        name: "toy-rest-newcomer-2",
        basePath: "/api/toy-rest-newcomer-2",
        feature: "MANAGEMENT_API",
      });

      expect(() =>
        svc
          .version(MANAGEMENT_API_VERSION, (v) => {
            v.delete(
              "/things",
              {
                ...guard("organization:manage"),
                output: z.object({ ok: z.boolean() }),
              },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).toThrow(/organization, role-bindings, roles, scim-tokens/);
    });

    /** @scenario A new family may register an RPC operation */
    it("admits an RPC operation", () => {
      const { service: svc, guard } = createManagementService({
        name: "toy-rpc-newcomer",
        basePath: "/api/toy-rpc-newcomer",
        feature: "MANAGEMENT_API",
      });

      expect(() =>
        svc
          .version(MANAGEMENT_API_VERSION, (v) => {
            v.rpc(
              "/things.list",
              {
                ...guard("organization:manage"),
                output: z.object({ ok: z.boolean() }),
              },
              async () => ({ ok: true }),
            );
          })
          .build(),
      ).not.toThrow();
    });
  });

  /**
   * The success status is a property of the endpoint, fixed when it is
   * registered. `packages/api` pins the framework rule directly; these pin it
   * through the factory every management endpoint is actually built with, and
   * are what binds the scenarios — `check-feature-parity` does not glob
   * `packages/**`, so coverage that lives only there enforces nothing.
   */
  describe("given an endpoint's success status", () => {
    const family = (name: string) =>
      createManagementService({
        name,
        basePath: `/api/${name}`,
        feature: "MANAGEMENT_API",
      });

    /** @scenario An output schema that accepts both a value and nothing is refused */
    it("refuses an output schema accepting undefined as well as a value", () => {
      const { service: svc, guard } = family("toy-optional-output");

      expect(() =>
        svc
          .version(MANAGEMENT_API_VERSION, (v) => {
            v.rpc(
              "/things.get",
              {
                ...guard("organization:manage"),
                output: z.object({ ok: z.boolean() }).optional(),
                status: 201,
              },
              async () => undefined,
            );
          })
          .build(),
      ).toThrow(/204 when undefined, 201 otherwise/);
    });

    /** @scenario An endpoint that never sends a body always answers 204 */
    it("answers 204 with an empty body when none is declared", async () => {
      const { service: svc, guard } = family("toy-no-body");
      const app = svc
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.rpc(
            "/things.purge",
            { ...guard("organization:manage"), output: z.void() },
            async () => undefined,
          );
        })
        .build();

      const response = await app.request("/api/toy-no-body/things.purge", {
        method: "POST",
      });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    });

    /** @scenario An endpoint that declares a body always answers its declared status */
    it("answers the declared status with the body, and fails when the body is missing", async () => {
      const { service: svc, guard } = family("toy-created");
      const app = svc
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.rpc(
            "/things.create",
            {
              ...guard("organization:manage"),
              output: z.object({ id: z.string() }),
              status: 201,
            },
            async () => ({ id: "a" }),
          );
          v.rpc(
            "/things.createBroken",
            {
              ...guard("organization:manage"),
              output: z.object({ id: z.string() }),
              status: 201,
            },
            // The cast is the point: a handler that sends nothing where a
            // body is declared.
            async () => undefined as unknown as { id: string },
          );
        })
        .build();

      const created = await app.request("/api/toy-created/things.create", {
        method: "POST",
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: "a" });

      const broken = await app.request("/api/toy-created/things.createBroken", {
        method: "POST",
      });
      expect(broken.status).toBe(500);
    });

    /** @scenario An undeclared payload never reaches the wire */
    it("sends no body for an endpoint that declared no output schema", async () => {
      const { service: svc, guard } = family("toy-undeclared");
      const app = svc
        .version(MANAGEMENT_API_VERSION, (v) => {
          v.rpc(
            "/things.leak",
            { ...guard("organization:manage") },
            (async () => ({ leaked: "secret" })) as never,
          );
        })
        .build();

      const response = await app.request("/api/toy-undeclared/things.leak", {
        method: "POST",
      });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    });
  });
});
