/**
 * @vitest-environment node
 *
 * `DELETE /api/scenario-events` archives a whole scenario set. A
 * `scenarioSetId` is MANDATORY — an unscoped request, or one that names an
 * empty set id, is refused before anything is archived, so a single call can
 * never wipe every run in a project.
 *
 * @see specs/scenarios/scenario-events-scoped-archive.feature
 */
import { bodyLimit, createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createScenarioEventsRestApp } from "../scenario-event.api";

const PROJECT = { id: "project-1", slug: "project-one" };

function mount(getRunIdsForSet = vi.fn()) {
  const simulations = { getRunIdsForSet, deleteRun: vi.fn() };

  const events = createScenarioEventsRestApp({
    security: passThroughSecurity(),
    simulations: () => simulations as never,
    scenarioTabs: () => ({ resolve: () => undefined }) as never,
    broadcast: () => ({ publish: async () => undefined }) as never,
    extractInlineMedia: async ({ event }) => ({ rewrittenEvent: event, refs: [] }),
    traceUsageGuard: async (_c, next) => next(),
    bodyLimit,
    platformUrl: ({ path }) => `https://app.langwatch.test${path}`,
  });

  const hono = new Hono().route("/", events.hono as never);

  return {
    delete: (query: string) =>
      hono.fetch(new Request(`http://api.test/api/scenario-events${query}`, { method: "DELETE" })),
    getRunIdsForSet,
  };
}

const renderError: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number };
  const status = handled.status ?? handled.httpStatus;
  return c.json({ error: String(error) }, (typeof status === "number" ? status : 500) as never);
};

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => next();
  const authenticate: () => MiddlewareHandler = () => async (c, next) => {
    c.set("project", PROJECT as never);
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderError,
    canonicalErrorHandler: renderError,
    authenticateProject: authenticate,
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

describe("given DELETE /api/scenario-events", () => {
  describe("when the request carries no scenarioSetId", () => {
    /** @scenario "DELETE without a scope is refused" */
    it("refuses as not matching the expected shape, archiving nothing", async () => {
      const api = mount();

      const response = await api.delete("");

      expect(response.status).toBe(422);
      expect(api.getRunIdsForSet).not.toHaveBeenCalled();
    });
  });

  describe("when the request carries an empty scenarioSetId", () => {
    /** @scenario "DELETE with empty scenarioSetId is refused" */
    it("refuses as not matching the expected shape, archiving nothing", async () => {
      const api = mount();

      const response = await api.delete("?scenarioSetId=");

      expect(response.status).toBe(422);
      expect(api.getRunIdsForSet).not.toHaveBeenCalled();
    });
  });
});
