/**
 * @vitest-environment node
 *
 * The `/api/experiments` door: the three routes it publishes, the permission
 * each declares, the page window it derives from the query string, the one row
 * shape both the list and the read answer with, and the attribution it hands
 * the application on a create.
 *
 * Ported from three files under `platform/app/src/app/api/experiments/__tests__`:
 * `experiments-list.integration.test.ts` and `runs-list.integration.test.ts`
 * (both `describe.skipIf(CI)` against a running dev server on :5560),
 * `experiments-read-one.integration.test.ts`, and `create-broadcast.integration.test.ts`.
 * The runs endpoints those files also exercised are NOT this family's — they
 * are still `platform/app/src/server/routes/experiments-v3.ts` — so nothing
 * about them is claimed here.
 *
 * The application is stubbed. This file asserts what the transport does, never
 * what the domain decides.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { Experiment } from "@langwatch/experiment-contract";
import { ExperimentNotFoundError } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ExperimentApp } from "../experiment.app";
import { createExperimentsRestApp } from "../../transport/api-rest/experiment.api";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const experiment = {
  id: "experiment-1",
  projectId: "project-1",
  slug: "support-email-classifier",
  name: "Support email classifier",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Experiment;

/**
 * The process's own boundary renderer, reduced to what these tests read back:
 * a handled refusal keeps its own status and its own `code` in `error`. The
 * real renderer adds remediation tips, a trace block and the log line; none of
 * that is the door's, and none of it is asserted here.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      {
        error: serialized.code,
        message: error.message,
        ...serialized.meta,
        reasons: serialized.reasons,
      },
      serialized.httpStatus as 400,
    );
  }
  return c.json({ error: "internal_server_error" }, 500);
};

/**
 * Every enforcement step the builder chose for the route under test.
 *
 * `requireToken` makes the stubbed project authentication behave the way the
 * process's own does: a request carrying no credential is refused there, before
 * any handler runs. It is the one thing about a 401 this family owns — that
 * every one of its routes sits behind that middleware.
 */
function testSecurity({ requireToken = false } = {}): {
  security: AppRestSecurity;
  chain: string[];
} {
  const chain: string[] = [];
  const record =
    (label: string): MiddlewareHandler =>
    async (_c, next) => {
      chain.push(label);
      await next();
    };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    chain.push("authenticateProject");
    if (requireToken && !c.req.header("X-Auth-Token")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    c.set("resolvedToken", { type: "apiKey", apiKeyId: "key-1", userId: "user-1" });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: ({ permission }) => record(`authorize:${permission}`),
    authorizeApiKeyCeiling: ({ permission }) => record(`ceiling:${permission}`),
    authenticateOrganization: () => record("authenticateOrganization"),
    authorizeOrganizationPermission: ({ permission }) => record(`authorizeOrg:${permission}`),
    authorizeRouteProjectPermission: ({ permission }) =>
      record(`authorizeRouteProject:${permission}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrgThrowing:${permission}`),
  };

  return { security: createAppRestSecurity(ports), chain };
}

function buildApi(
  overrides: Record<string, unknown> = {},
  options: { requireToken?: boolean } = {},
) {
  const { security, chain } = testSecurity(options);
  const stub = {
    getPage: vi.fn(async () => ({ experiments: [experiment], totalHits: 1 })),
    getBySlugOrId: vi.fn(async () => experiment),
    withRunAggregates: vi.fn(async () => [{ experiment, runsCount: 3, lastRunAt: 1700000000000 }]),
    createEvaluationsV3: vi.fn(async () => ({
      experimentId: "experiment-1",
      slug: "support-email-classifier",
      version: 1,
    })),
    ...overrides,
  } as unknown as ExperimentApp;

  const family = createExperimentsRestApp({ security, app: () => stub });

  return { hono: family.hono, stub, chain };
}

const summary = {
  id: "experiment-1",
  slug: "support-email-classifier",
  name: "Support email classifier",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  runsCount: 3,
  lastRunAt: new Date(1700000000000).toISOString(),
};

describe("createExperimentsRestApp", () => {
  describe("given the mounted family", () => {
    it("declares the read permission on both reads and create on the write", async () => {
      const list = buildApi();
      await list.hono.request("/api/experiments");
      expect(list.chain).toEqual(["authenticateProject", "authorize:experiments:view"]);

      const read = buildApi();
      await read.hono.request("/api/experiments/support-email-classifier");
      expect(read.chain).toEqual(["authenticateProject", "authorize:experiments:view"]);

      const create = buildApi();
      await create.hono.request("/api/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      });
      expect(create.chain).toEqual(["authenticateProject", "authorize:experiments:create"]);
    });

    it("authenticates before it authorizes", async () => {
      const { hono, chain } = buildApi();

      await hono.request("/api/experiments");

      expect(chain[0]).toBe("authenticateProject");
    });

    /** @scenario "Unauthenticated request returns 401" */
    it("lets the process's authentication refuse a credential-less request before any handler", async () => {
      const { hono, stub } = buildApi({}, { requireToken: true });

      const response = await hono.request("/api/experiments");

      expect(response.status).toBe(401);
      expect(stub.getPage).not.toHaveBeenCalled();
    });
  });

  describe("when the project's experiments are listed", () => {
    /** @scenario "Authenticated request lists experiments scoped to the project" */
    it("answers each entry with its identifiers, its type and its run aggregates", async () => {
      const { hono } = buildApi();

      const response = await hono.request("/api/experiments");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        experiments: [summary],
        pagination: { page: 1, pageSize: 50, totalHits: 1, hasMore: false },
      });
    });

    it("reads the project off the credential, never off the request", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/experiments?projectId=someone-else");

      expect(stub.getPage).toHaveBeenCalledWith({
        projectId: "project-1",
        page: 1,
        pageSize: 50,
      });
    });

    /** @scenario "Pagination returns the requested page" */
    it("takes the page window from the query string", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/experiments?page=2&pageSize=2");

      expect(stub.getPage).toHaveBeenCalledWith({
        projectId: "project-1",
        page: 2,
        pageSize: 2,
      });
    });

    it("reports more pages while the window has not reached the total", async () => {
      const { hono } = buildApi({
        getPage: vi.fn(async () => ({ experiments: [experiment], totalHits: 7 })),
      });

      const response = await hono.request("/api/experiments?page=1&pageSize=2");

      await expect(response.json()).resolves.toMatchObject({
        pagination: { page: 1, pageSize: 2, totalHits: 7, hasMore: true },
      });
    });

    it("caps the page size and falls back on a window that is not a positive number", async () => {
      const capped = buildApi();
      await capped.hono.request("/api/experiments?pageSize=5000");
      expect(capped.stub.getPage).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 200 }));

      const nonsense = buildApi();
      await nonsense.hono.request("/api/experiments?page=0&pageSize=not-a-number");
      expect(nonsense.stub.getPage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 }),
      );
    });
  });

  describe("when one experiment is read", () => {
    /** @scenario "Reading one experiment answers with the same shape the list uses" */
    it("answers the same row shape the list puts in its array", async () => {
      const { hono } = buildApi();

      const response = await hono.request("/api/experiments/support-email-classifier");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(summary);
    });

    /** @scenario "Either identifier the list returns can be read back" */
    it("accepts the id as well, because the same list row carries both", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/experiments/experiment-1");

      expect(response.status).toBe(200);
      expect(stub.getBySlugOrId).toHaveBeenCalledWith({
        projectId: "project-1",
        slugOrId: "experiment-1",
      });
    });

    /** @scenario "An experiment in another project is not readable" */
    it("looks the slug up only inside the credential's project", async () => {
      const { hono, stub } = buildApi();

      // Another project's slug reaches the application as a lookup in THIS
      // project, so it resolves to nothing rather than across the boundary.
      await hono.request("/api/experiments/support-email-classifier?projectId=someone-else");

      expect(stub.getBySlugOrId).toHaveBeenCalledWith({
        projectId: "project-1",
        slugOrId: "support-email-classifier",
      });
    });

    /** @scenario "A slug that names no experiment is refused by name" */
    it("refuses a slug that names no experiment by its own code, not the framework's 404", async () => {
      const { hono } = buildApi({
        getBySlugOrId: vi.fn(async () => {
          throw new ExperimentNotFoundError("no-such-experiment");
        }),
      });

      const response = await hono.request("/api/experiments/no-such-experiment");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "experiment_not_found" });
    });
  });

  describe("when an experiment is created", () => {
    it("answers the identifiers every other endpoint takes", async () => {
      const { hono } = buildApi();

      const response = await hono.request("/api/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Support email classifier" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "experiment-1",
        slug: "support-email-classifier",
        version: 1,
      });
    });

    it("attributes the write to the credential the request arrived on", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Support email classifier" }),
      });

      expect(stub.createEvaluationsV3).toHaveBeenCalledWith(
        { projectId: "project-1", name: "Support email classifier" },
        { kind: "credential", resolved: { type: "apiKey", apiKeyId: "key-1", userId: "user-1" } },
      );
    });

    it("sends no setup when the caller sent none, leaving the default to the application", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(stub.createEvaluationsV3).toHaveBeenCalledWith(
        { projectId: "project-1" },
        expect.objectContaining({ kind: "credential" }),
      );
    });

    it("forwards a setup the caller did send", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Named", state: { name: "Named", datasets: [] } }),
      });

      expect(stub.createEvaluationsV3).toHaveBeenCalledWith(
        expect.objectContaining({ state: { name: "Named", datasets: [] } }),
        expect.anything(),
      );
    });

    it("refuses an empty name before the application is touched", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
      expect(stub.createEvaluationsV3).not.toHaveBeenCalled();
    });
  });
});
