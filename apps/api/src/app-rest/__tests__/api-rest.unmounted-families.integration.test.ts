/**
 * The two families that were BUILT and had no caller, driven through the real
 * Hono app `createApiProcessRestFeatures` returns.
 *
 * `/api/admin/*` and `/api/export/traces/download` both existed in their
 * feature packages and were mounted by nothing, so the back office and the
 * bulk trace download answered 404 on a fully composed deployment. What is
 * under test is the pair of conditions each is now mounted on, and that a
 * process missing one leaves the family OFF rather than serving a door that
 * refuses everybody — which, for the back office, is indistinguishable from
 * the hide it performs for a caller who is not staff.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createApiProcessRestFeatures,
  type ApiProcessRestPorts,
  type ApiProcessRestServices,
} from "../app-rest.process-features";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

describe("given the back office", () => {
  describe("when the deployment composed the operator application and a session", () => {
    /** @scenario "The back office is reachable on a deployment that composed it" */
    it("mounts the impersonation door", () => {
      const api = mount({ ports: { admin: adminPorts({}) } });

      expect(api.claims("/api/admin/impersonate")).toBe(true);
    });

    /** @scenario "An impersonating admin stays the acting person" */
    it("attributes a back-office read to the impersonator rather than their subject", async () => {
      const isAdmin = vi.fn(() => true);
      const api = mount({
        ports: {
          admin: adminPorts({
            isAdmin,
            actor: {
              user: {
                id: "impersonated-user",
                email: "customer@example.test",
                impersonator: { id: "staff-user", email: "staff@langwatch.test" },
              },
            },
          }),
        },
      });

      await api.fetch("/api/admin/impersonate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
      });

      expect(isAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ id: "staff-user", email: "staff@langwatch.test" }),
      );
    });
  });

  describe("when the deployment composed no browser session", () => {
    /** @scenario "A deployment with no browser session leaves the door off" */
    it("does not mount the door at all", () => {
      const api = mount({});

      expect(api.claims("/api/admin/impersonate")).toBe(false);
    });
  });
});

describe("given the bulk trace export", () => {
  describe("when the deployment composed a session, a read stack and a broadcast", () => {
    /** @scenario "The download is reachable on a deployment that composed it" */
    it("mounts the download", () => {
      const api = mount({ services: { traceExport: traceExportCollaborators({}) } });

      expect(api.claims("/api/export/traces/download")).toBe(true);
    });

    /** @scenario "An anonymous caller is refused before anything is read" */
    it("refuses an anonymous caller without reading a trace", async () => {
      const readTraces = vi.fn(async () => ({ totalHits: 0, traces: [] }));
      const api = mount({
        services: { traceExport: traceExportCollaborators({ session: null, readTraces }) },
      });

      const response = await api.fetch("/api/export/traces/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(downloadRequest()),
      });

      expect(response.status).toBe(401);
      expect(readTraces).not.toHaveBeenCalled();
    });

    /** @scenario "A signed-in caller without permission on the project is refused" */
    it("refuses a signed-in caller without the permission, without reading a trace", async () => {
      const readTraces = vi.fn(async () => ({ totalHits: 0, traces: [] }));
      const api = mount({
        services: { traceExport: traceExportCollaborators({ permitted: false, readTraces }) },
      });

      const response = await api.fetch("/api/export/traces/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(downloadRequest()),
      });

      expect(response.status).toBe(403);
      expect(readTraces).not.toHaveBeenCalled();
    });

    /** @scenario "The export reads through the same redactions every other trace surface applies" */
    it("resolves the caller's own protections and hands them to the export", async () => {
      const getViewerProtections = vi.fn(async () => ({ canSeeCosts: false }));
      const readTraces = vi.fn(async () => ({ totalHits: 0, traces: [] }));
      const api = mount({
        services: { traceExport: traceExportCollaborators({ getViewerProtections, readTraces }) },
      });

      await api.fetch("/api/export/traces/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(downloadRequest()),
      });

      expect(getViewerProtections).toHaveBeenCalledWith(
        expect.objectContaining({ session: { user: { id: "user-1" } } }),
        { projectId: "project-1" },
      );
      expect(readTraces).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1" }),
        { canSeeCosts: false },
        expect.anything(),
      );
    });
  });

  describe("when the deployment composed no trace read stack", () => {
    /** @scenario "A deployment with no trace read stack leaves the download off" */
    it("does not mount the download at all", () => {
      const api = mount({});

      expect(api.claims("/api/export/traces/download")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function downloadRequest() {
  return {
    projectId: "project-1",
    mode: "summary",
    format: "csv",
    startDate: 1_767_225_600_000,
    endDate: 1_767_312_000_000,
    filters: {},
  };
}

function adminPorts(overrides: {
  isAdmin?: (user: unknown) => boolean;
  actor?: { user: { id: string; email?: string; impersonator?: { id: string; email: string } } };
}) {
  return {
    ops: () =>
      ({
        isAdmin: overrides.isAdmin ?? (() => true),
        operations: {
          startImpersonation: vi.fn(async () => undefined),
          stopImpersonation: vi.fn(async () => undefined),
        },
      }) as never,
    sessions: {
      resolveActor: async () => overrides.actor ?? { user: { id: "staff-user" } },
      resolveAuthSession: async () => ({ id: "session-1" }),
    },
  };
}

/**
 * The read stack, the session and the broadcast, as the process hands them
 * over. The export itself is NOT faked: the mount builds it from the stack's
 * own `tree` reader, which is the wiring this suite exists to pin, so the
 * stand-in is that reader.
 */
function traceExportCollaborators(overrides: {
  session?: { user: { id: string } } | null;
  permitted?: boolean;
  getViewerProtections?: (ctx: unknown, input: { projectId: string }) => Promise<unknown>;
  readTraces?: (...args: unknown[]) => Promise<{ totalHits: number; traces: unknown[] }>;
}) {
  const session = overrides.session === undefined ? { user: { id: "user-1" } } : overrides.session;
  return {
    reads: {
      readers: () => ({
        tree: {
          getAllTracesForProject:
            overrides.readTraces ?? (async () => ({ totalHits: 0, traces: [] })),
        },
      }),
      getViewerProtections: overrides.getViewerProtections ?? (async () => ({ canSeeCosts: true })),
    } as never,
    session: {
      resolve: async () => session,
      permitted: async () => overrides.permitted ?? true,
    } as never,
    broadcast: () => ({ broadcastToTenant: vi.fn() }) as never,
  };
}

function mount(options: {
  services?: ApiProcessRestServices;
  ports?: Partial<ApiProcessRestPorts>;
}) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: options.services ?? {},
    ports: {
      handlerManagedCredential: async () => ({ ok: true, project, markUsed: () => {} }),
      rateLimit: async () => ({ allowed: true }),
      ...options.ports,
    } as ApiProcessRestPorts,
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
    claims: (path: string) => hono.routes.some((route) => route.path === path),
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
