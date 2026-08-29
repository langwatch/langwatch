/**
 * @vitest-environment node
 *
 * The `/api/monitors` door: the six routes it publishes, the permission each
 * one declares, the wire shape a monitor goes out as, and the two statuses it
 * renders — the 404 it makes out of the application's `null`, and whatever
 * status a refusal already carries.
 *
 * Ported from `platform/app/src/app/api/monitors/__tests__/monitors-api.integration.test.ts`,
 * which drove the same family against Postgres. What that file proved about
 * the SERVICE — that a create with no evaluator is refused, that setting
 * `evaluatorId` to null is refused, that an omitted evaluator survives an
 * update — is already pinned by `monitor.service.unit.test.ts`. What was
 * proved about the DOOR and about nothing else is here: that those refusals
 * reach the wire with their own status and code rather than as a 500, and
 * that a legacy monitor with no evaluator still answers `evaluatorId: null`.
 *
 * The application is stubbed. This file asserts what the transport does, never
 * what the domain decides.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { MonitorEvaluatorRequiredError, type Monitor } from "@langwatch/monitor-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MonitorApp } from "../src/app/monitor.app";
import { createMonitorRestApp } from "../src/transport/api-rest/monitor.api";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const monitor: Monitor = {
  id: "monitor-1",
  projectId: "project-1",
  experimentId: null,
  evaluatorId: "evaluator-1",
  checkType: "langevals/llm_boolean",
  name: "Toxicity Monitor",
  slug: "toxicity-monitor-tor-1",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: { model: "openai/gpt-5-mini" },
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
};

/** A monitor from before evaluators existed: its settings live inline. */
const legacyMonitor: Monitor = { ...monitor, id: "monitor-legacy", evaluatorId: null };

/**
 * The process's own boundary renderer, reduced to the two facts these tests
 * read back: a refusal that knows its own status answers with that status, and
 * with its own `code` in the `error` field. The real renderer adds remediation
 * tips, a trace block and the log line; none of that is the door's, and none of
 * it is asserted here.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  const handled = error as Error & { code?: string; httpStatus?: number };
  if (typeof handled.code === "string" && typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code, message: handled.message }, handled.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error", message: "Internal server error" }, 500);
};

/** Every enforcement step the builder chose for the route under test. */
function testSecurity(): { security: AppRestSecurity; chain: string[] } {
  const chain: string[] = [];
  const record =
    (label: string): MiddlewareHandler =>
    async (_c, next) => {
      chain.push(label);
      await next();
    };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    chain.push("authenticateProject");
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
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
    authorizeRouteProjectPermission: ({ permission }) => record(`authorizeRouteProject:${permission}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrgThrowing:${permission}`),
  };

  return { security: createAppRestSecurity(ports), chain };
}

/**
 * The operations this family calls, each answering the happy path, so a test
 * overrides only the one it is about.
 */
function buildApi(overrides: Record<string, unknown> = {}) {
  const { security, chain } = testSecurity();
  const stub = {
    list: vi.fn(async () => [monitor]),
    tryGetById: vi.fn(async () => monitor),
    create: vi.fn(async () => monitor),
    patch: vi.fn(async () => monitor),
    toggleExisting: vi.fn(async () => true),
    deleteExisting: vi.fn(async () => true),
    ...overrides,
  } as unknown as MonitorApp;

  const family = createMonitorRestApp({
    security,
    app: () => stub,
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    // Which trace sources a mapping may name is the trace vertical's
    // vocabulary, injected by the process. The door only hands it to the
    // validator, so its contents do not matter here — but its OPTIONALITY
    // does: the door spreads this schema in as a bare key, so a required
    // stub makes every body without `mappings` a 422, which the real
    // `monitorMappingsSchema` (`.nullable().optional()`) never does. Under
    // zod 4 a key is optional only if its schema accepts `undefined`, and
    // `z.unknown()` alone does not.
    mappingsSchema: z.unknown().optional(),
  });

  return { hono: family.hono, stub, chain };
}

const jsonHeaders = { "content-type": "application/json" };

describe("createMonitorRestApp", () => {
  describe("given the mounted family", () => {
    it("declares the read permission on both reads", async () => {
      const list = buildApi();
      await list.hono.request("/api/monitors");
      expect(list.chain).toEqual(["authenticateProject", "authorize:evaluations:view"]);

      const read = buildApi();
      await read.hono.request("/api/monitors/monitor-1");
      expect(read.chain).toEqual(["authenticateProject", "authorize:evaluations:view"]);
    });

    it("declares create on the create and update on the edits, keeping deletion at manage", async () => {
      const create = buildApi();
      await create.hono.request("/api/monitors", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Toxicity Monitor", checkType: "langevals/llm_boolean" }),
      });
      expect(create.chain).toEqual(["authenticateProject", "authorize:evaluations:create"]);

      const patch = buildApi();
      await patch.hono.request("/api/monitors/monitor-1", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Renamed" }),
      });
      expect(patch.chain).toEqual(["authenticateProject", "authorize:evaluations:update"]);

      const toggle = buildApi();
      await toggle.hono.request("/api/monitors/monitor-1/toggle", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ enabled: false }),
      });
      expect(toggle.chain).toEqual(["authenticateProject", "authorize:evaluations:update"]);

      const remove = buildApi();
      await remove.hono.request("/api/monitors/monitor-1", { method: "DELETE" });
      expect(remove.chain).toEqual(["authenticateProject", "authorize:evaluations:manage"]);
    });

    it("authenticates before it authorizes, on every route", async () => {
      for (const request of [
        ["/api/monitors", { method: "GET" }],
        ["/api/monitors/monitor-1", { method: "GET" }],
        ["/api/monitors/monitor-1", { method: "DELETE" }],
      ] as const) {
        const { hono, chain } = buildApi();
        await hono.request(request[0], request[1]);
        expect(chain[0]).toBe("authenticateProject");
        expect(chain).toHaveLength(2);
      }
    });
  });

  describe("when the project's monitors are listed", () => {
    it("answers each one with its own platform link", async () => {
      const { hono } = buildApi();

      const response = await hono.request("/api/monitors");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([
        {
          id: "monitor-1",
          name: "Toxicity Monitor",
          slug: "toxicity-monitor-tor-1",
          checkType: "langevals/llm_boolean",
          enabled: true,
          executionMode: "ON_MESSAGE",
          sample: 1,
          level: "trace",
          evaluatorId: "evaluator-1",
          preconditions: [],
          parameters: { model: "openai/gpt-5-mini" },
          mappings: { mapping: {}, expansions: [] },
          threadIdleTimeout: null,
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:00.000Z",
          platformUrl:
            "https://app.langwatch.test/project-one/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor-1",
        },
      ]);
    });
  });

  describe("when a create names an evaluator", () => {
    /** @scenario Creating a monitor with an evaluator succeeds */
    it("answers 201 with the evaluator still attached", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/monitors", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "Toxicity Monitor",
          checkType: "langevals/llm_boolean",
          parameters: { model: "openai/gpt-5-mini" },
          evaluatorId: "evaluator-1",
        }),
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: "monitor-1",
        evaluatorId: "evaluator-1",
      });
      // The project is the credential's, never the body's.
      expect(stub.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1", evaluatorId: "evaluator-1" }),
      );
    });

    it("fills the defaults the wire contract promises for an unmentioned field", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/monitors", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Bare", checkType: "langevals/llm_boolean" }),
      });

      expect(stub.create).toHaveBeenCalledWith(
        expect.objectContaining({
          executionMode: "ON_MESSAGE",
          preconditions: [],
          parameters: {},
          sample: 1,
          level: "trace",
        }),
      );
    });
  });

  describe("when the application refuses a write", () => {
    /** @scenario Creating a monitor without an evaluator is rejected */
    it("answers with the refusal's own status and code, not a 500", async () => {
      const { hono } = buildApi({
        create: vi.fn(async () => {
          throw new MonitorEvaluatorRequiredError();
        }),
      });

      const response = await hono.request("/api/monitors", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "No evaluator", checkType: "langevals/llm_boolean" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "monitor_evaluator_required",
      });
    });

    /** @scenario Removing the evaluator from a monitor is rejected */
    it("carries the same refusal out of a partial update", async () => {
      const { hono } = buildApi({
        patch: vi.fn(async () => {
          throw new MonitorEvaluatorRequiredError();
        }),
      });

      const response = await hono.request("/api/monitors/monitor-1", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ evaluatorId: null }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "monitor_evaluator_required",
      });
    });

    it("hands an explicit null evaluatorId through rather than dropping it", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/monitors/monitor-1", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ evaluatorId: null }),
      });

      expect(stub.patch).toHaveBeenCalledWith({
        id: "monitor-1",
        projectId: "project-1",
        changes: expect.objectContaining({ evaluatorId: null }),
      });
    });
  });

  describe("when a legacy monitor carries no evaluator", () => {
    /** @scenario Updating other fields of a legacy monitor without an evaluator still works */
    it("renames it and answers with a null evaluatorId", async () => {
      const { hono } = buildApi({
        patch: vi.fn(async () => ({
          ...legacyMonitor,
          name: "Legacy Check Renamed",
        })),
      });

      const response = await hono.request("/api/monitors/monitor-legacy", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Legacy Check Renamed" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        name: "Legacy Check Renamed",
        evaluatorId: null,
      });
    });
  });

  describe("when the project has no such monitor", () => {
    it("turns the application's null into 404 on the read", async () => {
      const { hono } = buildApi({
        tryGetById: vi.fn(async () => null),
      });

      const response = await hono.request("/api/monitors/ghost");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Monitor not found" });
    });

    it("turns it into 404 on a partial update", async () => {
      const { hono } = buildApi({
        patch: vi.fn(async () => null),
      });

      const response = await hono.request("/api/monitors/ghost", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Whatever" }),
      });

      expect(response.status).toBe(404);
    });

    it("turns a refused toggle and a refused delete into 404", async () => {
      const toggle = buildApi({
        toggleExisting: vi.fn(async () => false),
      });
      const toggled = await toggle.hono.request("/api/monitors/ghost/toggle", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ enabled: true }),
      });
      expect(toggled.status).toBe(404);

      const remove = buildApi({
        deleteExisting: vi.fn(async () => false),
      });
      const removed = await remove.hono.request("/api/monitors/ghost", { method: "DELETE" });
      expect(removed.status).toBe(404);
    });
  });

  describe("when a toggle or a delete lands", () => {
    it("answers the identifier and the new state", async () => {
      const toggle = buildApi();
      const toggled = await toggle.hono.request("/api/monitors/monitor-1/toggle", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ enabled: false }),
      });
      expect(toggled.status).toBe(200);
      await expect(toggled.json()).resolves.toEqual({ id: "monitor-1", enabled: false });
      expect(toggle.stub.toggleExisting).toHaveBeenCalledWith({
        id: "monitor-1",
        projectId: "project-1",
        enabled: false,
      });

      const remove = buildApi();
      const removed = await remove.hono.request("/api/monitors/monitor-1", { method: "DELETE" });
      expect(removed.status).toBe(200);
      await expect(removed.json()).resolves.toEqual({ id: "monitor-1", deleted: true });
    });
  });

  describe("when the request body does not match the schema", () => {
    it("refuses a create with no name before the application is touched", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/monitors", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ checkType: "langevals/llm_boolean" }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
      expect(stub.create).not.toHaveBeenCalled();
    });

    it("refuses a sample outside the zero-to-one range", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/monitors", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "Oversampled",
          checkType: "langevals/llm_boolean",
          sample: 2,
        }),
      });

      expect(response.status).toBe(422);
      expect(stub.create).not.toHaveBeenCalled();
    });
  });
});
