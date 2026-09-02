/**
 * The governed-SQL family, driven through the real Hono app the API process
 * mounts.
 *
 * What is pinned is the pair of guards that make a project id in the URL safe
 * to publish, and the fact that the statement runs as the CREDENTIAL's project
 * rather than the path's. The order of the two guards is the claim: a path
 * naming another project is refused BEFORE the rollout flag is consulted, so a
 * caller cannot use the two answers together to learn which projects exist on
 * a deployment that has the surface switched off.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountLangWatchQLRest } from "../langwatch-ql-rest.mount";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

const emptyResult = {
  columns: [],
  rows: [],
  statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
  truncated: false,
  followsTimeWindow: false,
  followsGranularity: false,
  diagnostics: [],
};

describe("given the governed analytics SQL door", () => {
  describe("when a project key runs a statement on its own project", () => {
    it("runs it as that project, with the tenant key read server-side", async () => {
      const execute = vi.fn(async () => emptyResult);
      const api = mount({ execute });

      const response = await api.fetch("/api/v1/projects/project-1/analytics/query/clickhouse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });

      expect(response.status).toBe(200);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          project: { id: "project-1", lwqlKey: "lwql-secret" },
          sql: "SELECT 1",
          // An API key holds full project access, so costs are visible; the
          // captured content follows the project's own privacy policy.
          protections: {
            canSeeCosts: true,
            canSeeCapturedInput: true,
            canSeeCapturedOutput: false,
          },
        }),
      );
    });
  });

  describe("when the path names a project the credential does not hold", () => {
    it("answers not found, and never consults the rollout flag", async () => {
      const isEnabled = vi.fn(async () => true);
      const execute = vi.fn();
      const api = mount({ execute, isEnabled });

      const response = await api.fetch("/api/v1/projects/someone-else/analytics/query/clickhouse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });

      expect(response.status).toBe(404);
      expect(execute).not.toHaveBeenCalled();
      // The order is the claim: refusing the path first is what stops the two
      // answers being read together as a project-existence oracle.
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when the surface is not switched on for the project", () => {
    it("refuses by the feature's own code rather than a bare forbidden", async () => {
      const execute = vi.fn();
      const api = mount({ execute, isEnabled: async () => false });

      const response = await api.fetch("/api/v1/projects/project-1/analytics/schema");

      await expect(response.json()).resolves.toMatchObject({ code: "lwql_not_enabled" });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("when a project's saved charts are listed", () => {
    it("reads them off the same dashboard application the browser reads", async () => {
      const listSavedWorkbenchCharts = vi.fn(async () => []);
      const api = mount({ execute: vi.fn(), listSavedWorkbenchCharts });

      const response = await api.fetch("/api/v1/projects/project-1/analytics/charts");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [] });
      expect(listSavedWorkbenchCharts).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });
});

function mount(overrides: {
  execute: (...args: never[]) => unknown;
  isEnabled?: (input: unknown) => Promise<boolean>;
  listSavedWorkbenchCharts?: (input: unknown) => Promise<unknown[]>;
}) {
  const isEnabled = overrides.isEnabled ?? (async () => true);
  const hono = new Hono().route(
    "/",
    mountLangWatchQLRest({
      security: passThroughSecurity(),
      collaborators: {
        featureFlags: () => ({ isEnabled }) as never,
        projects: () =>
          ({
            getById: async () => ({ id: "project-1", lwqlKey: "lwql-secret" }),
            getOrganizationId: async () => "organization-1",
          }) as never,
        langWatchQL: () =>
          ({
            execute: overrides.execute,
            describeSchema: () => ({ database: "langwatch", datasets: [] }),
          }) as never,
        protectionsFor: async () => ({
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: false,
        }),
      },
      dashboard: () =>
        ({
          listSavedWorkbenchCharts: overrides.listSavedWorkbenchCharts ?? (async () => []),
        }) as never,
      publicBaseUrl: "https://app.langwatch.test",
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
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
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
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

/** A handled refusal must reach the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { code: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
