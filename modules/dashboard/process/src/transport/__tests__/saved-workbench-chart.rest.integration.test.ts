/**
 * The saved workbench chart REST family, mounted on the runtime over the real dashboard
 * application, its memory repositories and the real LangWatchQL validator. Only the credential
 * chain and the workbench switch are faked.
 * @see specs/lwql/saved-charts.feature
 * @see specs/lwql/langy-authoring.feature
 * @vitest-environment node
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  langWatchQLCallerProtections,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-contract/visualization/validation";
import { createLangWatchQLService } from "@langwatch/analytics-process/testing";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  FULLY_PERMITTED,
} from "../../app/__tests__/dashboard.fixture.ts";
import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import {
  savedWorkbenchChartRest,
  savedWorkbenchChartUrl,
} from "../saved-workbench-chart.rest.ts";

const PLATFORM_URL = "https://app.langwatch.test/project-one/analytics/workbench";
const EVERY_PERMISSION = ["analytics:view", "analytics:create", "analytics:update", "analytics:delete"];
const VIEW_ONLY = ["analytics:view"];
const WITHOUT_CONTENT: LangWatchQLProtections = { ...FULLY_PERMITTED, canSeeCapturedInput: false };

const SPECIFICATION = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { y: { field: "value", type: "quantitative" } },
};
const DEFINITION = {
  version: 1,
  sql: "SELECT count() AS value FROM analytics.traces",
  parameters: { since: "2026-02-01", limit: 10, exact: true },
  vegaLiteSpec: SPECIFICATION,
};

/** A handled refusal reaches the caller at its own status with its own code and meta. */
const boundaryErrorHandler: RestErrorHandler = (error) => {
  if (error instanceof Error && "httpStatus" in error && typeof error.httpStatus === "number") {
    return Response.json(
      {
        code: "code" in error ? error.code : undefined,
        meta: "meta" in error ? error.meta : undefined,
      },
      { status: error.httpStatus },
    );
  }

  return Response.json({ code: "unhandled", error: String(error) }, { status: 500 });
};

/** One project's key over the shared repositories, holding exactly the permissions named. */
function mountKey({
  repositories,
  projectId = "project-1",
  held = EVERY_PERMISSION,
  enabled = true,
  protections = FULLY_PERMITTED,
}: {
  repositories: DashboardRepositories;
  projectId?: string;
  held?: readonly string[];
  enabled?: boolean;
  protections?: LangWatchQLProtections;
}) {
  const langWatchQL = createLangWatchQLService({ executor: null, database: "analytics" });
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isWorkbenchEnabled: async () => enabled,
        validateLangWatchQL: (input) => langWatchQL.validate(input),
      }),
    },
  });
  const caller = {
    actor: { type: "api_key" as const, id: `key-of-${projectId}` },
    scope: { tier: "project" as const, id: projectId },
  };
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => caller,
      identify: () => caller,
      authorize: ({ permission }) => ({ permitted: held.includes(permission), organizationRole: null }),
    },
  });
  const hono = runtime.mount(savedWorkbenchChartRest.router(), {
    app: () => app,
    facts: [
      bindRestMiddleware(langWatchQLCallerProtections, () => protections),
      bindRestMiddleware(savedWorkbenchChartUrl, () => PLATFORM_URL),
    ],
    onError: boundaryErrorHandler,
  });
  const base = `/api/v1/projects/${projectId}/analytics/charts`;

  const send = async ({ path = "", method = "GET", body }: {
    path?: string;
    method?: string;
    body?: unknown;
  } = {}) => {
    const response = await hono.fetch(
      new Request(`http://api.test${base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const text = await response.text();

    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };

  return {
    list: () => send(),
    read: (id: string) => send({ path: `/${id}` }),
    create: (body: unknown) => send({ method: "POST", body }),
    update: (id: string, body: unknown) => send({ path: `/${id}`, method: "PATCH", body }),
    remove: (id: string) => send({ path: `/${id}`, method: "DELETE" }),
    place: (id: string, body: unknown) =>
      send({ path: `/${id}/placement`, method: "PUT", body }),
    unplace: (id: string) => send({ path: `/${id}/placement`, method: "DELETE" }),
  };
}

async function seededChart(repositories: DashboardRepositories) {
  const created = await mountKey({ repositories }).create({ name: "Spend", definition: DEFINITION });
  expect(created.status).toBe(201);

  return created.json.id as string;
}

describe("given the saved workbench chart REST family", () => {
  describe("when a chart is created, read back, listed and deleted", () => {
    /** @scenario "A chart created over the API reads back exactly as it was submitted" */
    it("returns the definition as submitted and lists the chart", async () => {
      const key = mountKey({ repositories: MemoryDashboardRepositories.create() });

      const created = await key.create({ name: "Spend", definition: DEFINITION });
      const read = await key.read(created.json.id);
      const listed = await key.list();

      expect(created.status).toBe(201);
      expect(read.status).toBe(200);
      expect(read.json.definition).toEqual(DEFINITION);
      expect(listed.json.data.map((chart: { id: string }) => chart.id)).toEqual([created.json.id]);
    });

    /** @scenario "Deleting a chart answers with no content and empties the listing" */
    it("answers 204, empties the listing and then refuses a second delete as not found", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const key = mountKey({ repositories });
      const id = await seededChart(repositories);

      const removed = await key.remove(id);
      const listed = await key.list();
      const again = await key.remove(id);

      expect(removed).toEqual({ status: 204, json: undefined });
      expect(listed.json.data).toEqual([]);
      expect(again.status).toBe(404);
      expect(again.json.code).toBe("saved_workbench_chart_not_found");
    });
  });

  describe("when a definition is refused", () => {
    /** @scenario "A specification the chart policy refuses is refused over the API, and nothing is written" */
    it("names the rule and the place, and leaves the listing unchanged", async () => {
      const key = mountKey({ repositories: MemoryDashboardRepositories.create() });

      const refused = await key.create({
        name: "Bad",
        definition: {
          ...DEFINITION,
          vegaLiteSpec: { ...SPECIFICATION, data: { url: "https://example.invalid/data.json" } },
        },
      });

      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.json.code).toBe("saved_workbench_chart_specification_refused");
      expect(refused.json.meta.errors.length).toBeGreaterThan(0);
      expect((await key.list()).json.data).toEqual([]);
    });

    /** @scenario "SQL the LangWatchQL validator refuses earns the same code over the API as the query endpoint" */
    it("refuses SQL naming a column the key's protections withhold, writing nothing", async () => {
      const key = mountKey({
        repositories: MemoryDashboardRepositories.create(),
        protections: WITHOUT_CONTENT,
      });

      const refused = await key.create({
        name: "Gated",
        definition: { ...DEFINITION, sql: "SELECT CapturedInput AS value FROM analytics.traces" },
      });

      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe("lwql_not_permitted");
      expect((await key.list()).json.data).toEqual([]);
    });

    /** @scenario "A definition larger than the endpoint's ceiling is refused before anything is stored" */
    it("refuses an oversized definition on create and on edit, storing nothing", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const key = mountKey({ repositories });
      const oversized = { ...DEFINITION, parameters: { big: "x".repeat(400_000) } };
      const id = await seededChart(repositories);

      const created = await key.create({ name: "Huge", definition: oversized });
      const edited = await key.update(id, { definition: oversized });

      expect(created.json.code).toBe("validation_error");
      expect(edited.json.code).toBe("validation_error");
      const listed = (await key.list()).json.data;
      expect(listed.map((chart: { name: string }) => chart.name)).toEqual(["Spend"]);
      expect(listed[0].definition).toEqual(DEFINITION);
    });

    /** @scenario "An update naming neither a name nor a definition is refused rather than quietly doing nothing" */
    it("refuses an empty update and leaves the chart as it was", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const key = mountKey({ repositories });
      const id = await seededChart(repositories);
      const before = (await key.read(id)).json;

      const refused = await key.update(id, {});

      expect(refused.json.code).toBe("validation_error");
      expect((await key.read(id)).json).toEqual(before);
    });
  });

  describe("when the workbench switch is off", () => {
    /** @scenario "Every chart endpoint stays dark while the workbench switch is off" */
    it("refuses list, read, create, update and delete with lwql_not_enabled", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const id = await seededChart(repositories);
      const dark = mountKey({ repositories, enabled: false });

      const answers = [
        await dark.list(),
        await dark.read(id),
        await dark.create({ name: "New", definition: DEFINITION }),
        await dark.update(id, { name: "Renamed" }),
        await dark.remove(id),
      ];

      expect(answers.map((answer) => answer.json.code)).toEqual(Array(5).fill("lwql_not_enabled"));
      expect((await mountKey({ repositories }).read(id)).json.name).toBe("Spend");
    });

    /** @scenario "Placement routes stay dark while the workbench switch is off" */
    it("refuses put and delete of a placement and leaves the placement unchanged", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const id = await seededChart(repositories);
      await repositories.dashboards.createDashboard({
        id: "dashboard-1",
        projectId: "project-1",
        name: "Reports",
        order: 0,
      });
      const dark = mountKey({ repositories, enabled: false });

      const put = await dark.place(id, { dashboardId: "dashboard-1" });
      const removed = await dark.unplace(id);

      expect([put.json.code, removed.json.code]).toEqual(["lwql_not_enabled", "lwql_not_enabled"]);
      expect((await mountKey({ repositories }).read(id)).json.dashboardId).toBeNull();
    });
  });

  describe("when another project's key reaches for a chart", () => {
    /** @scenario "A chart is invisible to another project's key" */
    it("finds it nowhere and leaves it exactly as it was", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const id = await seededChart(repositories);
      const home = mountKey({ repositories });
      const before = (await home.read(id)).json;
      const stranger = mountKey({ repositories, projectId: "project-2" });

      const answers = [
        await stranger.read(id),
        await stranger.update(id, { name: "Stolen" }),
        await stranger.remove(id),
      ];

      expect(answers.map((answer) => [answer.status, answer.json.code])).toEqual(
        Array(3).fill([404, "saved_workbench_chart_not_found"]),
      );
      expect((await stranger.list()).json.data).toEqual([]);
      expect((await home.read(id)).json).toEqual(before);
    });

    /** @scenario "Placing an unknown chart id is refused as not found, indistinguishable from a foreign one" */
    it("answers a foreign chart id and an id that never existed identically", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const foreignId = await seededChart(repositories);
      await repositories.dashboards.createDashboard({
        id: "dashboard-2",
        projectId: "project-2",
        name: "Reports",
        order: 0,
      });
      const stranger = mountKey({ repositories, projectId: "project-2" });

      const foreign = await stranger.place(foreignId, { dashboardId: "dashboard-2" });
      const unknown = await stranger.place("chart-that-never-existed", { dashboardId: "dashboard-2" });

      expect(foreign.status).toBe(404);
      expect(unknown).toEqual(foreign);
    });
  });

  describe("when a key may read charts and nothing more", () => {
    /** @scenario "A key that may read charts may not write them" */
    it("reads them, is refused every write, and leaves the listing unchanged", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const id = await seededChart(repositories);
      const viewer = mountKey({ repositories, held: VIEW_ONLY });

      const reads = [await viewer.list(), await viewer.read(id)];
      const writes = [
        await viewer.create({ name: "New", definition: DEFINITION }),
        await viewer.update(id, { name: "Renamed" }),
        await viewer.remove(id),
      ];

      expect(reads.map((answer) => answer.status)).toEqual([200, 200]);
      expect(writes.map((answer) => answer.status)).toEqual([403, 403, 403]);
      const listed = (await viewer.list()).json.data;
      expect(listed.map((chart: { name: string }) => chart.name)).toEqual(["Spend"]);
    });

    /** @scenario "A key that may read charts may not place or unplace them" */
    it("is refused a placement and its removal, leaving the placement unchanged", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const id = await seededChart(repositories);
      await repositories.dashboards.createDashboard({
        id: "dashboard-1",
        projectId: "project-1",
        name: "Reports",
        order: 0,
      });
      const viewer = mountKey({ repositories, held: VIEW_ONLY });

      const put = await viewer.place(id, { dashboardId: "dashboard-1" });
      const removed = await viewer.unplace(id);

      expect([put.status, removed.status]).toEqual([403, 403]);
      expect((await viewer.read(id)).json.dashboardId).toBeNull();
    });
  });

  describe("when a chart is placed on a dashboard", () => {
    const withDashboard = async () => {
      const repositories = MemoryDashboardRepositories.create();
      const id = await seededChart(repositories);
      await repositories.dashboards.createDashboard({
        id: "dashboard-1",
        projectId: "project-1",
        name: "Reports",
        order: 0,
      });
      await repositories.dashboards.createDashboard({
        id: "dashboard-foreign",
        projectId: "project-2",
        name: "Foreign",
        order: 0,
      });

      return { repositories, id, key: mountKey({ repositories }) };
    };

    /** @scenario "An integration places a saved chart on a dashboard over the API" */
    it("answers the chart with its placement, and reading it back shows the same", async () => {
      const { id, key } = await withDashboard();

      const placed = await key.place(id, { dashboardId: "dashboard-1", gridColumn: 0, gridRow: 3 });
      const read = await key.read(id);

      expect(placed.status).toBe(200);
      expect(placed.json).toMatchObject({ id, dashboardId: "dashboard-1", gridRow: 3 });
      expect(read.json).toMatchObject({ dashboardId: "dashboard-1", gridColumn: 0, gridRow: 3 });
    });

    /** @scenario "An integration unplaces a saved chart over the API" */
    it("answers 204 and clears the dashboard id and the grid position", async () => {
      const { id, key } = await withDashboard();
      await key.place(id, { dashboardId: "dashboard-1", gridColumn: 1, gridRow: 4 });

      const removed = await key.unplace(id);
      const read = await key.read(id);

      expect(removed).toEqual({ status: 204, json: undefined });
      expect(read.json).toMatchObject({ dashboardId: null, gridColumn: 0, gridRow: 0 });
    });

    /** @scenario "Placement onto a foreign dashboard is refused over the API the same way it is inside the application" */
    it("refuses a dashboard of another project and leaves the placement unchanged", async () => {
      const { id, key } = await withDashboard();

      const refused = await key.place(id, { dashboardId: "dashboard-foreign" });

      expect(refused.status).toBe(404);
      expect(refused.json.code).toBe("saved_workbench_chart_dashboard_not_found");
      expect((await key.read(id)).json.dashboardId).toBeNull();
    });
  });
});
