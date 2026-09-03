/**
 * The subsystem health probes, driven through the real Hono app the API
 * process mounts.
 *
 * These endpoints exist for an external monitor, so what is pinned is the
 * shape that monitor branches on: the two 401 sentences an unusable credential
 * gets, the 404s the trigger probe tells apart, and — the part the move could
 * have widened silently — that a SCOPED api key is still refused. The probes
 * have only ever accepted the deprecated project key, and they check no
 * permission at all, so accepting a scoped key would have turned every
 * least-privilege key in the fleet into one that can drive a canary.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createHealthProbeRestApp,
  type HealthProbeRestPorts,
} from "../health-probe-rest";

describe("given a subsystem health probe", () => {
  describe("when the request carries no credential", () => {
    it("names all the accepted header spellings, without resolving anything", async () => {
      const resolveProjectByApiKey = vi.fn();
      const api = mount({ resolveProjectByApiKey });

      const response = await api.fetch("/api/health/collector");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        message:
          "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      });
      expect(resolveProjectByApiKey).not.toHaveBeenCalled();
    });
  });

  describe("when the credential resolves to nothing this deployment accepts", () => {
    it("refuses with the invalid-token sentence rather than the missing-token one", async () => {
      const api = mount({ resolveProjectByApiKey: async () => null });

      const response = await api.fetch("/api/health/collector", {
        headers: { "x-auth-token": "scoped-key" },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Invalid auth token." });
    });
  });
});

describe("given the trigger probe", () => {
  describe("when the project has never fired the trigger it names", () => {
    it("tells an absent trigger apart from one that has simply not fired", async () => {
      const api = mount({
        automation: () => ({
          tryGetById: async () => ({ id: "trigger-1" }),
          getRecentFires: async () => [],
        }),
      });

      const response = await api.fetch("/api/health/triggers?triggerId=trigger-1", {
        headers: { "x-auth-token": "project-key" },
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ message: "No trigger sent found." });
    });
  });

  describe("when the trigger fired within the hour", () => {
    it("reports the subsystem healthy", async () => {
      const api = mount({
        automation: () => ({
          tryGetById: async () => ({ id: "trigger-1" }),
          getRecentFires: async () => [{ createdAt: new Date() }],
        }),
      });

      const response = await api.fetch("/api/health/triggers?triggerId=trigger-1", {
        headers: { "x-auth-token": "project-key" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 200,
        body: { message: "Trigger triggered within the last hour." },
      });
    });
  });
});

describe("given the workflow probe", () => {
  describe("when the project does not have the workflow it names", () => {
    it("refuses at 404 without dialling the deployment's own boundary", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const api = mount({ workflowExists: async () => false });

      const response = await api.fetch("/api/health/workflows?workflowId=workflow-1", {
        headers: { "x-auth-token": "project-key" },
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ message: "Workflow not found." });
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});

describe("given a deployment that declared no public origin", () => {
  it("serves no probes at all, rather than five that report on nothing", async () => {
    const hono = new Hono();
    const response = await hono.fetch(new Request("http://api.test/api/health/collector"));
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

function mount(overrides: Partial<HealthProbeRestPorts> = {}) {
  const hono = new Hono().route(
    "/",
    createHealthProbeRestApp({
      security: passThroughSecurity(),
      ports: {
        resolveProjectByApiKey: async () => ({ id: "project-1" }),
        publicBaseUrl: "https://app.langwatch.test",
        automation: () => ({
          tryGetById: async () => null,
          getRecentFires: async () => [],
        }),
        workflowExists: async () => true,
        ...overrides,
      },
    }),
  );

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A public probe must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code ?? "error" }, handled.httpStatus as never);
  }
  return c.json({ error: String(error) }, 500);
};
