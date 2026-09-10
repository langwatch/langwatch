/**
 * The saved-workbench-chart REST family — `/api/v1/projects/:projectId/analytics/charts*` —
 * driven through the runtime's own `mount`, not a hand-rolled Hono app.
 */
// @vitest-environment node
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { RestProjectIdentity, RestResolvedProjectCredential } from "@langwatch/api/rest";
import type { SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountLangWatchQLRest } from "../langwatch-ql-rest.mount.ts";

const PROJECT: RestProjectIdentity = {
  id: "project-1",
  name: "Acme",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

const PROTECTIONS: LangWatchQLProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: false,
};

function chart(overrides: Partial<SavedWorkbenchChart> = {}): SavedWorkbenchChart {
  return {
    id: "chart-1",
    projectId: PROJECT.id,
    name: "Latency by model",
    definition: { version: 1, sql: "SELECT 1", parameters: {} },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    dashboardId: null,
    gridColumn: 0,
    gridRow: 0,
    colSpan: 1,
    rowSpan: 1,
    ...overrides,
  };
}

describe("given a project credential on the saved-workbench-chart family", () => {
  describe("when the workbench is enabled and charts are listed", () => {
    it("reads them off the dashboard application, at the deep link into the workbench", async () => {
      const listSavedWorkbenchCharts = vi.fn(async () => [chart()]);
      const world = mountCharts({ listSavedWorkbenchCharts });

      const response = await world.send("/api/v1/projects/project-1/analytics/charts");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [
          expect.objectContaining({
            id: "chart-1",
            platformUrl: "https://app.langwatch.test/acme/analytics/query",
          }),
        ],
      });
      expect(listSavedWorkbenchCharts).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });

  describe("when the workbench is not enabled for the project", () => {
    it("refuses every route in the family with lwql_not_enabled", async () => {
      const world = mountCharts({ enabled: false });

      const response = await world.send("/api/v1/projects/project-1/analytics/charts");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.objectContaining({ code: "lwql_not_enabled" }) }),
      );
    });
  });

  describe("when a chart is saved", () => {
    it("passes the credential's own content protections to the dashboard application", async () => {
      const createSavedWorkbenchChart = vi.fn(async () => chart());
      const world = mountCharts({ createSavedWorkbenchChart });

      const response = await world.send("/api/v1/projects/project-1/analytics/charts", {
        method: "POST",
        body: { name: "New chart", definition: { version: 1, sql: "SELECT 1", parameters: {} } },
      });

      expect(response.status).toBe(201);
      expect(createSavedWorkbenchChart).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1", protections: PROTECTIONS }),
      );
    });
  });

  describe("when a chart is placed on a dashboard", () => {
    it("dispatches through the dashboard application's own placement operation", async () => {
      const placeSavedWorkbenchChart = vi.fn(async () => chart({ dashboardId: "dashboard-1" }));
      const world = mountCharts({ placeSavedWorkbenchChart });

      const response = await world.send(
        "/api/v1/projects/project-1/analytics/charts/chart-1/placement",
        { method: "PUT", body: { dashboardId: "dashboard-1" } },
      );

      expect(response.status).toBe(200);
      expect(placeSavedWorkbenchChart).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1", chartId: "chart-1", dashboardId: "dashboard-1" }),
      );
    });
  });
});

// ---------------------------------------------------------------------------

interface Overrides {
  enabled?: boolean;
  listSavedWorkbenchCharts?: (input: { projectId: string }) => Promise<SavedWorkbenchChart[]>;
  createSavedWorkbenchChart?: (input: unknown) => Promise<SavedWorkbenchChart>;
  placeSavedWorkbenchChart?: (input: unknown) => Promise<SavedWorkbenchChart>;
}

/** The family as the process serves it: through `runtime.mount`, and no other way. */
function mountCharts(overrides: Overrides) {
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

  const dashboard = {
    listSavedWorkbenchCharts: overrides.listSavedWorkbenchCharts ?? (async () => []),
    getSavedWorkbenchChart: async () => chart(),
    createSavedWorkbenchChart: overrides.createSavedWorkbenchChart ?? (async () => chart()),
    updateSavedWorkbenchChart: async () => chart(),
    deleteSavedWorkbenchChart: async () => {},
    placeSavedWorkbenchChart: overrides.placeSavedWorkbenchChart ?? (async () => chart()),
    unplaceSavedWorkbenchChart: async () => {},
  } as never;

  const mounted = mountLangWatchQLRest(runtime, {
    collaborators: {
      featureFlags: () => ({ isEnabled: async () => overrides.enabled ?? true }) as never,
      projects: () => ({ getOrganizationId: async () => PROJECT.organizationId }) as never,
      langWatchQL: () => ({}) as never,
      protectionsFor: async () => PROTECTIONS,
    },
    dashboard: () => dashboard,
    publicBaseUrl: "https://app.langwatch.test",
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
