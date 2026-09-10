/**
 * The query REST family — `/api/v1/query` — driven through the runtime's own
 * `mount`, not a hand-rolled Hono app.
 * @see specs/analytics/lwql-api.feature
 */
// @vitest-environment node
import type { RestProjectIdentity, RestResolvedProjectCredential } from "@langwatch/api/rest";
import {
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountQueryRest } from "../query-rest.mount.ts";

const PROJECT: RestProjectIdentity = {
  id: "project-1",
  name: "Acme",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

const emptyResult = {
  columns: [],
  rows: [],
  statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
  truncated: false,
  followsTimeWindow: false,
  followsGranularity: false,
  diagnostics: [],
};

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

describe("given a project credential on the query door", () => {
  describe("when a project key runs a statement", () => {
    it("runs it as the credential's project, with the tenant key read server-side", async () => {
      const execute = vi.fn(async () => emptyResult);
      const world = mountQuery({ execute });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT 1" },
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
      const world = mountQuery({ execute: vi.fn() });

      const response = await world.send("/api/v1/query/schema");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ database: "langwatch", datasets: [] });
    });
  });

  describe("when a query executes successfully", () => {
    /** @scenario "Results carry typed columns, rows, execution statistics, truncation state, and diagnostics" */
    it("returns typed columns, rows, execution statistics, truncation state, and structured diagnostics", async () => {
      const world = mountQuery({ execute: vi.fn(async () => fullResult) });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT Model FROM traces" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(fullResult);
    });
  });

  describe("when the same parameterized query is re-submitted with the same bound parameters", () => {
    /** @scenario "Parameterized queries re-run deterministically through the REST API" */
    it("returns an identical result across runs over unchanged data", async () => {
      const execute = vi.fn(async () => fullResult);
      const world = mountQuery({ execute });
      const body = {
        sql: "SELECT Model FROM traces WHERE ProjectId = {project_id:String}",
        parameters: { project_id: "project-1" },
      };

      const first = await world.send("/api/v1/query", { method: "POST", body });
      const second = await world.send("/api/v1/query", { method: "POST", body });

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
        throw new LangWatchQLParameterMissingError(["project_id"]);
      });
      const world = mountQuery({ execute });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT Model FROM traces WHERE ProjectId = {project_id:String}" },
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.objectContaining({ code: "lwql_parameter_missing" }) }),
      );
    });
  });

  describe("when a client attempts to supply, override, inspect, or widen tenant scope", () => {
    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("ignores any tenant field the request body carries and uses only the authenticated project", async () => {
      const execute = vi.fn(async () => fullResult);
      const world = mountQuery({ execute });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: {
          sql: "SELECT 1",
          // Not a field the request schema declares — an attempt to widen scope.
          projectId: "victim-project",
          tenantId: "victim-tenant",
        },
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
        throw notPermitted([{ code: "GATED_COLUMN", column: "input" }]);
      });
      const world = mountQuery({ execute });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT input FROM traces" },
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.objectContaining({ code: "lwql_not_permitted" }) }),
      );
    });
  });

  describe("when a caller whose permissions withhold a whole dataset names it", () => {
    /** @scenario "A dataset withheld from a caller cannot be named in a query" */
    it("is rejected before it reaches the database, while a permitted caller reads the same dataset normally", async () => {
      const withheld = vi.fn(async () => {
        throw notPermitted([{ code: "GATED_COLUMN", dataset: "evaluation_analytics" }]);
      });
      const withheldResponse = await mountQuery({ execute: withheld }).send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT * FROM evaluation_analytics" },
      });
      expect(withheldResponse.status).toBe(400);

      const permittedResponse = await mountQuery({ execute: vi.fn(async () => fullResult) }).send(
        "/api/v1/query",
        { method: "POST", body: { sql: "SELECT * FROM evaluation_analytics" } },
      );
      expect(permittedResponse.status).toBe(200);
    });
  });

  describe("when SQL uses postgresql, url, s3, remote, or another table function", () => {
    /** @scenario "External and table-function access is blocked by AST policy before reaching the database" */
    it("rejects the query by AST policy with lwql_not_permitted naming the TABLE_FUNCTION rule", async () => {
      const execute = vi.fn(async () => {
        throw notPermitted([{ code: "TABLE_FUNCTION", name: "s3" }]);
      });
      const world = mountQuery({ execute });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT * FROM s3('https://example.com/x.csv')" },
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.objectContaining({ code: "lwql_not_permitted" }) }),
      );
    });
  });

  describe("when a LangWatchQL query succeeds or fails", () => {
    /** @scenario "Query database credentials never reach the caller" */
    it("never lets the project's LangWatchQL credential reach the response", async () => {
      const world = mountQuery({
        execute: vi.fn(async () => {
          throw new LangWatchQLUnavailableError();
        }),
      });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT 1" },
      });
      const text = await response.text();

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
      const world = mountQuery({ execute: vi.fn(async () => truncated) });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT * FROM traces" },
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
      const world = mountQuery({ execute: vi.fn(async () => result) });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT 1" },
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
      const world = mountQuery({ execute: vi.fn(async () => result) });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT 1" },
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
      const world = mountQuery({ execute: vi.fn() });

      const response = await world.send("/api/v1/query/postgres", {
        method: "POST",
        body: { sql: "SELECT 1" },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when a client submits a LangWatchQL query", () => {
    /** @scenario "Submitted SQL is never automatically rewritten" */
    it("passes the submitted SQL to the service unchanged, with no rewriting layer in between", async () => {
      const execute = vi.fn(async () => fullResult);
      const world = mountQuery({ execute });
      const submitted = "SELECT   Model   FROM traces  -- trailing comment";

      await world.send("/api/v1/query", { method: "POST", body: { sql: submitted } });

      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ sql: submitted }));
    });
  });

  describe("when the credential names a project this deployment holds no record of", () => {
    it("refuses with project_not_found rather than reading past a missing tenant", async () => {
      const world = mountQuery({ execute: vi.fn(), findProject: async () => null });

      const response = await world.send("/api/v1/query", {
        method: "POST",
        body: { sql: "SELECT 1" },
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.objectContaining({ code: "project_not_found" }) }),
      );
    });
  });
});

// ---------------------------------------------------------------------------

/** A stand-in for the module's own `LangWatchQLNotPermittedError`, off the same code and status. */
function notPermitted(violations: readonly Record<string, unknown>[]): HandledError {
  return new HandledError(
    "lwql_not_permitted",
    "The submitted SQL is not permitted by the LangWatchQL analytics policy.",
    { httpStatus: 400, fault: "customer", meta: { violations } },
  );
}

interface Overrides {
  execute: (...args: never[]) => unknown;
  findProject?: () => Promise<{ id: string; lwqlKey: string } | null>;
}

/** The family as the process serves it: through `runtime.mount`, and no other way. */
function mountQuery(overrides: Overrides) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const resolved: RestResolvedProjectCredential = { type: "legacyProjectKey", project: PROJECT };

  const runtime = createApiRestRuntime({
    projectCredential: () =>
      Promise.resolve({
        ok: true,
        project: { id: PROJECT.id },
        resolved,
        markUsed: () => {},
      }),
    organizationCredential: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    organizationIdentity: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    errors,
  });

  const mounted = mountQueryRest(runtime, {
    collaborators: {
      projects: () =>
        ({
          tryGetById:
            overrides.findProject ?? (async () => ({ id: "project-1", lwqlKey: "lwql-secret" })),
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
  });

  const hono = new Hono().route("/", mounted);

  return {
    send: (path: string, init: { method?: string; body?: unknown } = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: { "Content-Type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      ),
  };
}
