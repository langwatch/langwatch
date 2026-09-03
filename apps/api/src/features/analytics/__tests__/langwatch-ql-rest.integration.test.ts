/**
 * The two analytics REST families, driven through the real Hono apps the API
 * process mounts.
 *
 * Raw LangWatchQL is `/api/v1/query` and nothing else: the per-project pair at
 * `.../analytics/query/clickhouse` and `.../analytics/schema` was removed with
 * issue #7565, so there is no path project id left to cross-check and no
 * rollout flag left to consult. What is pinned here is that the statement runs
 * as the CREDENTIAL's project, with the tenant key read server-side, and that
 * the saved-chart family still reads off the same dashboard application the
 * browser reads.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountLangWatchQLRest } from "../langwatch-ql-rest.mount";
import { mountQueryRest } from "../query-rest.mount";

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

describe("given the query door", () => {
  describe("when a project key runs a statement", () => {
    it("runs it as the credential's project, with the tenant key read server-side", async () => {
      const execute = vi.fn(async () => emptyResult);
      const api = mountQuery({ execute });

      const response = await api.fetch("/api/v1/query", {
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

  describe("when a project key asks what it may query", () => {
    it("answers the catalog for the credential's own protections", async () => {
      const api = mountQuery({ execute: vi.fn() });

      const response = await api.fetch("/api/v1/query/schema");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        database: "langwatch",
        datasets: [],
      });
    });
  });
});

describe("given the saved-chart door", () => {
  describe("when a project's saved charts are listed", () => {
    it("reads them off the same dashboard application the browser reads", async () => {
      const listSavedWorkbenchCharts = vi.fn(async () => []);
      const api = mountCharts({ execute: vi.fn(), listSavedWorkbenchCharts });

      const response = await api.fetch("/api/v1/projects/project-1/analytics/charts");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [] });
      expect(listSavedWorkbenchCharts).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });
});

interface Overrides {
  execute: (...args: never[]) => unknown;
  isEnabled?: (input: unknown) => Promise<boolean>;
  listSavedWorkbenchCharts?: (input: unknown) => Promise<unknown[]>;
}

/** The three collaborators both families dispatch through. */
function collaborators(overrides: Overrides) {
  const isEnabled = overrides.isEnabled ?? (async () => true);
  return {
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
  };
}

function fetcher(hono: Hono) {
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function mountQuery(overrides: Overrides) {
  return fetcher(
    new Hono().route(
      "/",
      mountQueryRest({
        security: passThroughSecurity(),
        collaborators: collaborators(overrides),
      }),
    ),
  );
}

function mountCharts(overrides: Overrides) {
  return fetcher(
    new Hono().route(
      "/",
      mountLangWatchQLRest({
        security: passThroughSecurity(),
        collaborators: collaborators(overrides),
        dashboard: () =>
          ({
            listSavedWorkbenchCharts: overrides.listSavedWorkbenchCharts ?? (async () => []),
          }) as never,
        publicBaseUrl: "https://app.langwatch.test",
      }),
    ),
  );
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
