/**
 * @see specs/security/api-endpoint-authorization.feature
 * Enforcement is structural: `verifySecret` gates every route the family
 * registers, and each route is asserted on its own so an escapee fails here.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createApiProcessRestFeatures,
  type ApiProcessRestPorts,
} from "../app-rest.process-features.ts";

const SECRET = "integration-internal-secret";

const CRON_ROUTES: { method: "GET" | "POST"; path: string }[] = [
  { method: "POST", path: "/api/cron/old_lambdas_cleanup" },
  { method: "GET", path: "/api/cron/old_lambdas_cleanup" },
];

describe("internal/service route authentication", () => {
  describe("when a cron route is called without credentials", () => {
    /** @scenario "A destructive cron route rejects callers without the secret" */
    it.each(CRON_ROUTES)(
      "rejects $method $path with no Authorization header",
      async ({ method, path }) => {
        const cleanupOldLambdas = vi.fn(async () => {});
        const api = mount({ cleanupOldLambdas });

        const res = await api.fetch(path, { method });

        expect(res.status).toBe(401);
        expect(cleanupOldLambdas).not.toHaveBeenCalled();
      },
    );
  });

  describe("when a cron route is called with the wrong secret", () => {
    it.each(CRON_ROUTES)(
      "rejects $method $path with a mismatched bearer token",
      async ({ method, path }) => {
        const cleanupOldLambdas = vi.fn(async () => {});
        const api = mount({ cleanupOldLambdas });

        const res = await api.fetch(path, {
          method,
          headers: { authorization: "Bearer wrong" },
        });

        expect(res.status).toBe(401);
        expect(cleanupOldLambdas).not.toHaveBeenCalled();
      },
    );
  });

  describe("when the deployment configured no cron secret", () => {
    it.each(CRON_ROUTES)(
      "refuses $method $path rather than falling open",
      async ({ method, path }) => {
        const cleanupOldLambdas = vi.fn(async () => {});
        const api = mount({ cleanupOldLambdas, secret: undefined });

        const res = await api.fetch(path, {
          method,
          headers: { authorization: "Bearer " },
        });

        expect(res.status).toBe(401);
        expect(cleanupOldLambdas).not.toHaveBeenCalled();
      },
    );
  });

  describe("when a cron route is called with the configured secret", () => {
    it.each(CRON_ROUTES)("runs the sweep for $method $path", async ({ method, path }) => {
      const cleanupOldLambdas = vi.fn(async () => {});
      const api = mount({ cleanupOldLambdas });

      const res = await api.fetch(path, {
        method,
        headers: { authorization: `Bearer ${SECRET}` },
      });

      expect(res.status).toBe(200);
      expect(cleanupOldLambdas).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a deployment that composed no cron collaborators", () => {
  it("does not mount the destructive door at all", () => {
    const hono = new Hono();
    for (const app of createApiProcessRestFeatures({
      security: passThroughSecurity(),
      services: {},
      ports: {
        handlerManagedCredential: async () => ({
          ok: true as const,
          project,
          resolved: { type: "legacyProjectKey" as const, project: project as never },
          markUsed: () => {},
        }),
        rateLimit: async () => ({ allowed: true }),
      } as ApiProcessRestPorts,
    })) {
      hono.route("/", app);
    }

    expect(hono.routes.some((route) => route.path === "/api/cron/old_lambdas_cleanup")).toBe(false);
  });
});

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

function mount(options: { cleanupOldLambdas: () => Promise<void>; secret?: string | undefined }) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: {},
    ports: {
      handlerManagedCredential: async () => ({
        ok: true as const,
        project,
        resolved: { type: "legacyProjectKey" as const, project: project as never },
        markUsed: () => {},
      }),
      rateLimit: async () => ({ allowed: true }),
      cron: {
        internalSecret: () => ("secret" in options ? options.secret : SECRET),
        cleanupOldLambdas: options.cleanupOldLambdas,
      },
    } as ApiProcessRestPorts,
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: "organization-1" });
    c.set("apiKeyUserId", "user-1");
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
