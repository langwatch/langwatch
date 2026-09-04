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

describe("given the query door's result and refusal shapes", () => {
  const fullResult = {
    columns: [{ name: "Model", type: "String" }],
    rows: [{ Model: "gpt-5-mini" }],
    statistics: { elapsedMs: 12, rowsRead: 3, bytesRead: 300, rowsReturned: 1 },
    truncated: false,
    followsTimeWindow: false,
    followsGranularity: false,
    diagnostics: [
      { code: "POSSIBLE_FANOUT", message: "joined rows may repeat", meta: { columns: ["SpanId"] } },
    ],
  };

  describe("when a query executes successfully", () => {
    /** @scenario "Results carry typed columns, rows, execution statistics, truncation state, and diagnostics" */
    it("returns typed columns, rows, execution statistics, truncation state, and structured diagnostics", async () => {
      const api = mountQuery({ execute: vi.fn(async () => fullResult) });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT Model FROM traces" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(fullResult);
    });
  });

  describe("when the same parameterized query is re-submitted with the same bound parameters", () => {
    /** @scenario "Parameterized queries re-run deterministically through the REST API" */
    it("returns an identical result across runs over unchanged data", async () => {
      const execute = vi.fn(async () => fullResult);
      const api = mountQuery({ execute });
      const body = JSON.stringify({
        sql: "SELECT Model FROM traces WHERE ProjectId = {project_id:String}",
        parameters: { project_id: "project-1" },
      });

      const first = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const second = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      await expect(first.json()).resolves.toEqual(await second.json());
      expect(execute).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ parameters: { project_id: "project-1" } }),
      );
      expect(execute).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ parameters: { project_id: "project-1" } }),
      );
    });
  });

  describe("when a parameterized query is missing a bound value", () => {
    /** @scenario "A parameterized query missing a bound value is refused before execution" */
    it("is refused with lwql_parameter_missing naming the unset parameters, without reaching the database", async () => {
      const execute = vi.fn(async () => {
        throw Object.assign(
          new Error("The query declares bound parameters the request did not supply values for."),
          { code: "lwql_parameter_missing", httpStatus: 400, meta: { parameters: ["project_id"] } },
        );
      });
      const api = mountQuery({ execute });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sql: "SELECT Model FROM traces WHERE ProjectId = {project_id:String}",
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ code: "lwql_parameter_missing" }),
      );
    });
  });

  describe("when a client attempts to supply, override, inspect, or widen tenant scope", () => {
    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("ignores any tenant field the request body carries and uses only the authenticated project", async () => {
      const execute = vi.fn(async () => fullResult);
      const api = mountQuery({ execute });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sql: "SELECT 1",
          // Not a field the request schema declares — an attempt to widen scope.
          projectId: "victim-project",
          tenantId: "victim-tenant",
        }),
      });

      expect(response.status).toBe(200);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ project: { id: "project-1", lwqlKey: "lwql-secret" } }),
      );
    });
  });

  describe("when a caller without content permissions references a content-gated field", () => {
    /** @scenario "Content-gated fields are refused in every expression position" */
    it("is rejected with lwql_not_permitted naming the GATED_COLUMN rule", async () => {
      const execute = vi.fn(async () => {
        throw Object.assign(
          new Error("The submitted SQL is not permitted by the LangWatchQL analytics policy."),
          {
            code: "lwql_not_permitted",
            httpStatus: 400,
            meta: { violations: [{ code: "GATED_COLUMN", column: "input" }] },
          },
        );
      });
      const api = mountQuery({ execute });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT input FROM traces" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          code: "lwql_not_permitted",
        }),
      );
    });
  });

  describe("when a caller whose permissions withhold a whole dataset names it", () => {
    /** @scenario "A dataset withheld from a caller cannot be named in a query" */
    it("is rejected before it reaches the database, while a permitted caller reads the same dataset normally", async () => {
      const withheld = vi.fn(async () => {
        throw Object.assign(
          new Error("The submitted SQL is not permitted by the LangWatchQL analytics policy."),
          {
            code: "lwql_not_permitted",
            httpStatus: 400,
            meta: { violations: [{ code: "GATED_COLUMN", dataset: "evaluation_analytics" }] },
          },
        );
      });
      const withheldApi = mountQuery({ execute: withheld });
      const withheldResponse = await withheldApi.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT * FROM evaluation_analytics" }),
      });
      expect(withheldResponse.status).toBe(400);

      const permitted = vi.fn(async () => fullResult);
      const permittedApi = mountQuery({ execute: permitted });
      const permittedResponse = await permittedApi.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT * FROM evaluation_analytics" }),
      });
      expect(permittedResponse.status).toBe(200);
    });
  });

  describe("when SQL uses postgresql, url, s3, remote, or another table function", () => {
    /** @scenario "External and table-function access is blocked by AST policy before reaching the database" */
    it("rejects the query by AST policy with lwql_not_permitted naming the TABLE_FUNCTION rule", async () => {
      const execute = vi.fn(async () => {
        throw Object.assign(
          new Error("The submitted SQL is not permitted by the LangWatchQL analytics policy."),
          {
            code: "lwql_not_permitted",
            httpStatus: 400,
            meta: { violations: [{ code: "TABLE_FUNCTION", name: "s3" }] },
          },
        );
      });
      const api = mountQuery({ execute });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT * FROM s3('https://example.com/x.csv')" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ code: "lwql_not_permitted" }),
      );
    });
  });

  describe("when a LangWatchQL query succeeds or fails", () => {
    /** @scenario "Query database credentials never reach the caller" */
    it("never lets the project's LangWatchQL credential reach the response", async () => {
      const secretProject = { id: "project-1", lwqlKey: "lwql-secret-DO-NOT-LEAK" };
      const api = mountQuery({
        execute: vi.fn(async () => {
          throw Object.assign(
            new Error("The LangWatchQL analytics SQL API is not available on this deployment."),
            { code: "lwql_unavailable", httpStatus: 503 },
          );
        }),
      });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });
      const text = await response.text();

      expect(text).not.toContain(secretProject.lwqlKey);
      expect(text).not.toContain("lwql-secret");
    });
  });

  describe("when a query's results are truncated by the result-size limit", () => {
    /** @scenario "Truncation diagnostic fires when results are cut off" */
    it("marks truncation explicitly", async () => {
      const truncated = {
        ...fullResult,
        truncated: true,
        diagnostics: [{ code: "RESULT_TRUNCATED", message: "The result was cut off." }],
      };
      const api = mountQuery({ execute: vi.fn(async () => truncated) });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT * FROM traces" }),
      });

      await expect(response.json()).resolves.toEqual(expect.objectContaining({ truncated: true }));
    });
  });

  describe("when a query compares periods of unequal or incomplete coverage", () => {
    /** @scenario "Incomplete or misaligned comparison period diagnostic fires" */
    it("carries the comparison-period diagnostic", async () => {
      const result = {
        ...fullResult,
        diagnostics: [
          {
            code: "INCOMPLETE_COMPARISON_PERIOD",
            message: "The compared periods are not equivalent.",
          },
        ],
      };
      const api = mountQuery({ execute: vi.fn(async () => result) });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });

      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          diagnostics: [expect.objectContaining({ code: "INCOMPLETE_COMPARISON_PERIOD" })],
        }),
      );
    });
  });

  describe("when a time-bucketed query has empty buckets in range", () => {
    /** @scenario "Missing time buckets diagnostic fires" */
    it("carries the missing-time-buckets diagnostic", async () => {
      const result = {
        ...fullResult,
        diagnostics: [
          { code: "MISSING_TIME_BUCKETS", message: "Some buckets in range are missing." },
        ],
      };
      const api = mountQuery({ execute: vi.fn(async () => result) });

      const response = await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });

      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          diagnostics: [expect.objectContaining({ code: "MISSING_TIME_BUCKETS" })],
        }),
      );
    });
  });

  describe("when a client attempts to execute SQL against a PostgreSQL query endpoint", () => {
    /** @scenario "No PostgreSQL native-SQL execution endpoint exists" */
    it("finds no such endpoint on the public API surface", async () => {
      const api = mountQuery({ execute: vi.fn() });

      const response = await api.fetch("/api/v1/query/postgres", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when a client submits a LangWatchQL query", () => {
    /** @scenario "Submitted SQL is never automatically rewritten" */
    it("passes the submitted SQL to the service unchanged, with no rewriting layer in between", async () => {
      const execute = vi.fn(async () => fullResult);
      const api = mountQuery({ execute });
      const submitted = "SELECT   Model   FROM traces  -- trailing comment";

      await api.fetch("/api/v1/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: submitted }),
      });

      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ sql: submitted }));
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
    authorizeRouteTeamPermission: () => noop,
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
