/**
 * @vitest-environment node
 * Board scope at the doors: the member tRPC procedures and the REST routes, called with a key
 * that names a person and with one that names nobody, over the real application and its memory
 * repositories. Spec: dashboards-v2.feature AC171 to AC174, AC189, AC196 and AC197.
 */
import { langWatchQLCallerProtections } from "@langwatch/analytics-contract";
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  type RestMountOptions,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { Actor } from "@langwatch/authorization";
import type { DashboardApi, DashboardScope } from "@langwatch/dashboard-contract";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  createDashboardTestProjects,
  FULLY_PERMITTED,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import {
  dashboardWidgetCallerSource,
  dashboardWidgetRest,
  dashboardWidgetUrl,
} from "../dashboard-widget.rest.ts";
import { dashboardWidgetTrpcTransport } from "../dashboard-widget.trpc.ts";
import { dashboardRest } from "../dashboard.rest.ts";
import { dashboardTrpcTransport } from "../dashboard.trpc.ts";
import { graphRest } from "../graph.rest.ts";
import { graphTrpcTransport } from "../graph.trpc.ts";
import { savedWorkbenchChartRest, savedWorkbenchChartUrl } from "../saved-workbench-chart.rest.ts";
import { savedWorkbenchChartTrpcTransport } from "../saved-workbench-chart.trpc.ts";

type Context = object;
/** A procedure's input: always in one project, the rest as that procedure takes it. */
type Input = { projectId: string } & Record<string, unknown>;
type Handle = (args: {
  app: DashboardApi;
  input: unknown;
  actor: { id: string };
  scope: { tier: "project"; id: string };
  signal: undefined;
}) => unknown;

const HOME = "project-home";
const SIBLING = "project-sibling";
const AUTHOR = "author";
const TEAMMATE = "teammate";
const WIDGET = {
  name: "Usage",
  code: "export default () => null;",
  queries: [{ name: "usage", sql: "SELECT 1" }],
};
const GRAPH = { name: "Latency", graph: { graphType: "line" } };
const CHART_ID = "chart-on-board";
const BOX = { gridColumn: 0, gridRow: 0, colSpan: 2, rowSpan: 2 };
const PLATFORM_URL = "https://app.langwatch.test/dashboards";

/** The board and what is on it, by id; or ids that name nothing. */
type Ids = Readonly<{ boardId: string; widgetId: string; graphId: string; chartId: string }>;
const MISSING: Ids = {
  boardId: "no-such-board",
  widgetId: "no-such-widget",
  graphId: "no-such-graph",
  chartId: "no-such-chart",
};

/** The member doors: every dashboards, widgets and graphs procedure, called as one member. */
function memberDoors(app: DashboardApi) {
  const handlers = new Map<string, Handle>();
  const runtime: TrpcProcedureFactory<Context> = {
    procedure: (request) => {
      handlers.set(request.procedure, (args) => Reflect.apply(request.handle, undefined, [args]));
      return {};
    },
    router: (record) => record,
  };
  dashboardTrpcTransport.router(runtime, () => app);
  dashboardWidgetTrpcTransport.router(runtime, () => app);
  graphTrpcTransport.router(runtime, () => app);
  savedWorkbenchChartTrpcTransport.router(runtime, () => app);

  return async (actorId: string, procedure: string, input: Input) => {
    const handle = handlers.get(procedure);
    if (handle === undefined) throw new Error(`no procedure ${procedure}`);
    return handle({
      app,
      input,
      actor: { id: actorId },
      scope: { tier: "project", id: input.projectId },
      signal: undefined,
    });
  };
}

/** The actor the project door resolves a key to: its owner, or nobody for a project key. */
const PROJECT_KEY: Actor = { type: "api_key", id: "key-1" };
const NOBODY = null;
const keyOf = (userId: string): Actor => ({ type: "user", id: userId });

/** The credential doors: boards, graphs, widgets and saved charts with one project's API key. */
function credentialDoors(app: DashboardApi, projectId: string, actor: Actor | null = PROJECT_KEY) {
  const caller = { actor, scope: { tier: "project" as const, id: projectId } };
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: { authenticate: () => caller, identify: () => caller },
  });
  const mount = (
    family: { router: () => RestTransportDeclaration<DashboardApi> },
    middlewareContext: RestMountOptions<DashboardApi>["middlewareContext"] = [],
  ) =>
    runtime.mount(family.router(), {
      app: () => app,
      middlewareContext,
      onError: canonicalErrorResponse,
    });
  const families = [
    { under: "/analytics/dashboard-widgets", hono: mount(dashboardWidgetRest, WIDGET_CONTEXT) },
    { under: "/analytics/charts", hono: mount(savedWorkbenchChartRest, CHART_CONTEXT) },
    { under: "/api/dashboards", hono: mount(dashboardRest) },
    { under: "/api/graphs", hono: mount(graphRest) },
  ];

  return async (method: string, path: string, body?: unknown) => {
    const hono = families.find(({ under }) => path.includes(under))?.hono;
    if (hono === undefined) throw new Error(`no route family serves ${path}`);
    const response = await hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };
}

const WIDGET_CONTEXT = [
  bindMiddlewareContext(dashboardWidgetUrl, () => PLATFORM_URL),
  bindMiddlewareContext(dashboardWidgetCallerSource, () => ({ kind: "api" as const })),
];
const CHART_CONTEXT = [
  bindMiddlewareContext(langWatchQLCallerProtections, () => FULLY_PERMITTED),
  bindMiddlewareContext(savedWorkbenchChartUrl, () => PLATFORM_URL),
];

/** The author's board in HOME, with a widget, a graph and a saved chart, at the scope asked for. */
async function boardAt(scope: DashboardScope, world: { dashboardsOffIn?: string[] } = {}) {
  const repositories = MemoryDashboardRepositories.create();
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isDashboardsEnabled: async ({ projectId }) => !world.dashboardsOffIn?.includes(projectId),
      }),
      projects: createDashboardTestProjects({
        organizations: { [HOME]: "organization-1", [SIBLING]: "organization-1" },
      }),
    },
  });
  const call = memberDoors(app);
  const board = (await call(AUTHOR, "dashboards.create", { projectId: HOME, name: "Reports" })) as {
    id: string;
  };
  const on = { projectId: HOME, dashboardId: board.id };
  const widget = (await call(AUTHOR, "dashboardWidgets.create", { ...WIDGET, ...on })) as {
    id: string;
  };
  const graph = (await call(AUTHOR, "graphs.create", { ...GRAPH, ...on })) as { id: string };
  await repositories.dashboards.createSavedWorkbenchChart({
    id: CHART_ID,
    projectId: HOME,
    name: "Spend",
    definition: { version: 1, sql: "SELECT 1", parameters: {} },
  });
  await app.placeSavedWorkbenchChart({ ...on, chartId: CHART_ID, viewer: { userId: AUTHOR } });
  await call(TEAMMATE, "dashboards.star", { projectId: HOME, star: starOf(board.id) });
  if (scope !== "PROJECT") await call(AUTHOR, "dashboards.setScope", { ...on, scope });

  const ids: Ids = { boardId: board.id, widgetId: widget.id, graphId: graph.id, chartId: CHART_ID };
  return { app, call, ids, ...ids };
}

const starOf = (dashboardId: string) => ({ kind: "board" as const, dashboardId });

/** Every member procedure that names a board, or something on one, by id. */
function memberAsks({ boardId, widgetId, graphId, chartId }: Ids): Record<string, [string, Input]> {
  const here = { projectId: HOME };
  const on = { ...here, dashboardId: boardId };
  const star = starOf(boardId);
  return {
    open: ["dashboards.getById", on],
    rename: ["dashboards.rename", { ...on, name: "Taken" }],
    describe: ["dashboards.updateDetails", { ...on, description: "Mine" }],
    reorder: ["dashboards.reorderDashboards", { ...here, dashboardIds: [boardId] }],
    setScope: ["dashboards.setScope", { ...on, scope: "PROJECT" }],
    scopeImpact: ["dashboards.scopeImpact", on],
    scopeProjects: ["dashboards.scopeProjects", on],
    star: ["dashboards.star", { ...here, star }],
    unstar: ["dashboards.unstar", { ...here, star }],
    reorderStars: ["dashboards.reorderStars", { ...here, stars: [star] }],
    widgets: ["dashboardWidgets.list", on],
    addWidget: ["dashboardWidgets.create", { ...WIDGET, ...on }],
    editWidget: ["dashboardWidgets.update", { ...WIDGET, ...here, id: widgetId }],
    placeWidget: ["dashboardWidgets.assignDashboard", { ...on, id: widgetId }],
    moveWidget: ["dashboardWidgets.updateLayout", { ...here, graphId: widgetId, ...BOX }],
    moveWidgets: [
      "dashboardWidgets.batchUpdateLayouts",
      { ...here, layouts: [{ graphId: widgetId, ...BOX }] },
    ],
    deleteWidget: ["dashboardWidgets.delete", { ...here, id: widgetId }],
    boardGraphs: ["graphs.getAll", on],
    addGraph: ["graphs.create", { ...GRAPH, ...on }],
    readGraph: ["graphs.getById", { ...here, id: graphId }],
    moveGraphs: ["graphs.batchUpdateLayouts", { ...here, layouts: [{ graphId, ...BOX }] }],
    deleteGraph: ["graphs.delete", { ...here, id: graphId }],
    readChart: ["analytics.savedWorkbenchCharts.getById", { ...here, id: chartId }],
    editChart: ["analytics.savedWorkbenchCharts.update", { ...here, id: chartId, name: "X" }],
    runChart: ["analytics.savedWorkbenchCharts.run", { ...here, id: chartId }],
    deleteChart: ["analytics.savedWorkbenchCharts.delete", { ...here, id: chartId }],
    delete: ["dashboards.delete", on],
  };
}

const WIDGETS = `/api/v1/projects/${HOME}/analytics/dashboard-widgets`;
const CHARTS = `/api/v1/projects/${HOME}/analytics/charts`;

/** Every REST route that names a board, or something on one, by id: method, path and body. */
function credentialAsks({
  boardId,
  widgetId,
  graphId,
  chartId,
}: Ids): Record<string, [string, string, unknown?]> {
  return {
    open: ["GET", `/api/dashboards/${boardId}`],
    rename: ["PATCH", `/api/dashboards/${boardId}`, { name: "Taken" }],
    reorder: ["PUT", "/api/dashboards/reorder", { dashboardIds: [boardId] }],
    readGraph: ["GET", `/api/graphs/${graphId}`],
    addGraph: ["POST", "/api/graphs", { ...GRAPH, dashboardId: boardId }],
    editGraph: ["PATCH", `/api/graphs/${graphId}`, { name: "X" }],
    deleteGraph: ["DELETE", `/api/graphs/${graphId}`],
    readWidget: ["GET", `${WIDGETS}/${widgetId}`],
    editWidget: ["PATCH", `${WIDGETS}/${widgetId}`, { name: "X" }],
    placeWidget: ["POST", `${WIDGETS}/${widgetId}/dashboard`, { dashboardId: boardId }],
    deleteWidget: ["DELETE", `${WIDGETS}/${widgetId}`],
    readChart: ["GET", `${CHARTS}/${chartId}`],
    editChart: ["PATCH", `${CHARTS}/${chartId}`, { name: "X" }],
    placeChart: ["PUT", `${CHARTS}/${chartId}/placement`, { dashboardId: boardId }],
    unplaceChart: ["DELETE", `${CHARTS}/${chartId}/placement`],
    deleteChart: ["DELETE", `${CHARTS}/${chartId}`],
    delete: ["DELETE", `/api/dashboards/${boardId}`],
  };
}

/** An answer less the ids the caller named, so a hidden board compares with a missing one. */
function withoutIds(answer: unknown, ids: Ids): unknown {
  const told = JSON.stringify(answer);
  return JSON.parse(Object.values(ids).reduce((text, id) => text.replaceAll(id, "<id>"), told));
}

/** Everything a call answers: what it resolved with, or the whole refusal it raised. */
async function outcomeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    return { resolved: (await call) ?? null };
  } catch (error) {
    const refusal = error as Error & { serialize?: () => object };
    return { refused: { name: refusal.name, message: refusal.message, ...refusal.serialize?.() } };
  }
}

/** The `code` a rejected call carries, or that it resolved. */
async function codeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return (error as { code?: unknown }).code ?? String(error);
  }
  return "<resolved>";
}

const idsOf = (rows: unknown) => (rows as { id: string }[]).map(({ id }) => id);

/** What the four REST lists of HOME answer one key: the ids of its boards and what is on them. */
async function restListed(send: ReturnType<typeof credentialDoors>) {
  return {
    boards: idsOf((await send("GET", "/api/dashboards")).json.data),
    graphs: idsOf((await send("GET", "/api/graphs")).json),
    widgets: idsOf((await send("GET", WIDGETS)).json.data),
    charts: idsOf((await send("GET", CHARTS)).json.data),
  };
}

describe("board scope at the doors", () => {
  describe("given a board its author set to Only me", () => {
    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is in no member procedure's list for a teammate", async () => {
      const { call } = await boardAt("PRIVATE");
      const listed = async (actor: string) => ({
        boards: idsOf(
          await call(actor, "dashboards.getAll", { projectId: HOME, includeOrganization: true }),
        ),
        widgets: idsOf(await call(actor, "dashboardWidgets.list", { projectId: HOME })),
        graphs: idsOf(await call(actor, "graphs.getAll", { projectId: HOME })),
      });

      const [author, teammate] = [await listed(AUTHOR), await listed(TEAMMATE)];

      expect({
        author: [author.boards.length, author.widgets.length, author.graphs.length],
        teammate,
      }).toEqual({ author: [1, 1, 1], teammate: { boards: [], widgets: [], graphs: [] } });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("answers a teammate who names it by id as not found on every member procedure", async () => {
      const { call, boardId, widgetId, graphId } = await boardAt("PRIVATE");
      const on = { projectId: HOME, dashboardId: boardId };
      const asked = (procedure: string, input: Input) => codeOf(call(TEAMMATE, procedure, input));

      expect({
        open: await asked("dashboards.getById", on),
        rename: await asked("dashboards.rename", { ...on, name: "Taken" }),
        describe: await asked("dashboards.updateDetails", { ...on, description: "Mine" }),
        delete: await asked("dashboards.delete", on),
        setScope: await asked("dashboards.setScope", { ...on, scope: "PROJECT" }),
        scopeImpact: await asked("dashboards.scopeImpact", on),
        scopeProjects: await asked("dashboards.scopeProjects", on),
        star: await asked("dashboards.star", {
          projectId: HOME,
          star: { kind: "board", dashboardId: boardId },
        }),
        widgets: await asked("dashboardWidgets.list", on),
        addWidget: await asked("dashboardWidgets.create", { ...WIDGET, ...on }),
        editWidget: await asked("dashboardWidgets.update", {
          ...WIDGET,
          projectId: HOME,
          id: widgetId,
        }),
        deleteWidget: await asked("dashboardWidgets.delete", { projectId: HOME, id: widgetId }),
        addGraph: await asked("graphs.create", { ...GRAPH, ...on }),
        readGraph: await asked("graphs.getById", { projectId: HOME, id: graphId }),
        deleteGraph: await asked("graphs.delete", { projectId: HOME, id: graphId }),
      }).toEqual({
        open: "dashboard_not_found",
        rename: "dashboard_not_found",
        describe: "dashboard_not_found",
        delete: "dashboard_not_found",
        setScope: "dashboard_not_found",
        scopeImpact: "dashboard_not_found",
        scopeProjects: "dashboard_not_found",
        star: "dashboard_not_found",
        widgets: "dashboard_not_found",
        addWidget: "dashboard_widget_not_found",
        editWidget: "dashboard_widget_not_found",
        deleteWidget: "dashboard_widget_not_found",
        addGraph: "dashboard_not_found",
        readGraph: "graph_not_found",
        deleteGraph: "graph_not_found",
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is not there for a project credential on any REST route", async () => {
      const { app, boardId, graphId } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME);
      const status = async (method: string, path: string, body?: unknown) =>
        (await send(method, path, body)).status;

      expect({
        listed: (await send("GET", "/api/dashboards")).json.data,
        graphs: (await send("GET", "/api/graphs")).json,
        open: await status("GET", `/api/dashboards/${boardId}`),
        rename: await status("PATCH", `/api/dashboards/${boardId}`, { name: "Taken" }),
        delete: await status("DELETE", `/api/dashboards/${boardId}`),
        reorder: await status("PUT", "/api/dashboards/reorder", { dashboardIds: [boardId] }),
        readGraph: await status("GET", `/api/graphs/${graphId}`),
        addGraph: await status("POST", "/api/graphs", { ...GRAPH, dashboardId: boardId }),
      }).toEqual({
        listed: [],
        graphs: [],
        open: 404,
        rename: 404,
        delete: 404,
        reorder: 404,
        readGraph: 404,
        addGraph: 404,
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("tells a teammate no more than a missing id does, on any member procedure", async () => {
      const { call, ids } = await boardAt("PRIVATE");
      const told = async (named: Ids) => {
        const result: Record<string, unknown> = {};
        for (const [name, [procedure, input]] of Object.entries(memberAsks(named))) {
          result[name] = withoutIds(await outcomeOf(call(TEAMMATE, procedure, input)), named);
        }
        return result;
      };
      const missing = await told(MISSING);

      expect({
        hidden: await told(ids),
        accepted: Object.keys(missing).filter((name) => "resolved" in Object(missing[name])),
      }).toEqual({
        hidden: missing,
        accepted: ["unstar", "reorderStars", "moveWidget", "moveWidgets", "boardGraphs"],
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("lists a teammate's stars and finds their first board as it does once the board is deleted", async () => {
      const read = async ({ call }: Awaited<ReturnType<typeof boardAt>>) => {
        const starred = await call(TEAMMATE, "dashboards.listStarred", { projectId: HOME });
        const first = (await call(TEAMMATE, "dashboards.getOrCreateFirst", {
          projectId: HOME,
        })) as { name: string; scope: string; createdById: string | null } | null;
        // `order` counts every board of the project, hidden ones too: a known side channel.
        return {
          starred,
          name: first?.name,
          scope: first?.scope,
          createdById: first?.createdById,
        };
      };
      const deleted = await boardAt("PROJECT");
      await deleted.call(AUTHOR, "dashboards.delete", {
        projectId: HOME,
        dashboardId: deleted.boardId,
      });

      expect(await read(await boardAt("PRIVATE"))).toEqual(await read(deleted));
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("tells a project credential no more than a missing id does, on any REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME);
      const told = async (named: Ids) => {
        const result: Record<string, { status: number }> = {};
        for (const [name, [method, path, body]] of Object.entries(credentialAsks(named))) {
          result[name] = withoutIds(await send(method, path, body), named) as { status: number };
        }
        return result;
      };
      const missing = await told(MISSING);

      expect({
        hidden: await told(ids),
        accepted: Object.keys(missing).filter((name) => missing[name]!.status < 400),
      }).toEqual({ hidden: missing, accepted: [] });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("says no more to a project credential than a board that does not exist does", async () => {
      const { app, boardId } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME);

      const hidden = await send("GET", `/api/dashboards/${boardId}`);
      const missing = await send("GET", "/api/dashboards/no-such-board");

      expect({
        status: hidden.status,
        code: hidden.json.code,
        message: hidden.json.message,
      }).toEqual({
        status: missing.status,
        code: missing.json.code,
        message: missing.json.message,
      });
    });

    /** @scenario "AC196 Scope: a key that names a person reads and writes as that person over REST" */
    it("is listed, opened and edited by its author's own key on every REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME, keyOf(AUTHOR));

      const listed = await restListed(send);
      const refused: string[] = [];
      for (const [name, [method, path, body]] of Object.entries(credentialAsks(ids))) {
        if ((await send(method, path, body)).status >= 400) refused.push(name);
      }

      expect({ listed, refused }).toEqual({
        listed: {
          boards: [ids.boardId],
          graphs: [ids.graphId],
          widgets: [ids.widgetId],
          charts: [ids.chartId],
        },
        refused: [],
      });
    });

    /** @scenario "AC196 Scope: a key that names a person reads and writes as that person over REST" */
    it("tells another person's key no more than a missing id does, on any REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME, keyOf(TEAMMATE));
      const told = async (named: Ids) => {
        const result: Record<string, { status: number }> = {};
        for (const [name, [method, path, body]] of Object.entries(credentialAsks(named))) {
          result[name] = withoutIds(await send(method, path, body), named) as { status: number };
        }
        return result;
      };
      const missing = await told(MISSING);

      expect({
        listed: await restListed(send),
        hidden: await told(ids),
        accepted: Object.keys(missing).filter((name) => missing[name]!.status < 400),
      }).toEqual({
        listed: { boards: [], graphs: [], widgets: [], charts: [] },
        hidden: missing,
        accepted: [],
      });
    });

    /** @scenario "AC197 Scope: a key that names no person stands where a project credential does" */
    it("is not listed or opened by a key that names nobody, which opens a Project board", async () => {
      const hidden = await boardAt("PRIVATE");
      const shared = await boardAt("PROJECT");
      const opened = async ({ app, boardId }: typeof hidden) =>
        (await credentialDoors(app, HOME, NOBODY)("GET", `/api/dashboards/${boardId}`)).status;

      expect({
        listed: await restListed(credentialDoors(hidden.app, HOME, NOBODY)),
        onlyMe: await opened(hidden),
        project: await opened(shared),
      }).toEqual({
        listed: { boards: [], graphs: [], widgets: [], charts: [] },
        onlyMe: 404,
        project: 200,
      });
    });
  });

  describe("when a key makes a board over REST", () => {
    const made = async (actor: Actor | null) => {
      const { app, call } = await boardAt("PROJECT");
      const created = await credentialDoors(app, HOME, actor)("POST", "/api/dashboards", {
        name: "Made by a key",
      });
      const board = (await call(AUTHOR, "dashboards.getById", {
        projectId: HOME,
        dashboardId: created.json.id,
      })) as { createdById: string | null; scope: string };
      return { status: created.status, createdById: board.createdById, scope: board.scope };
    };

    /** @scenario "AC196 Scope: a key that names a person reads and writes as that person over REST" */
    it("records the person a key names as the board's author", async () => {
      expect(await made(keyOf(AUTHOR))).toEqual({
        status: 201,
        createdById: AUTHOR,
        scope: "PROJECT",
      });
    });

    /** @scenario "AC197 Scope: a key that names no person stands where a project credential does" */
    it("records no author for a key that names nobody", async () => {
      expect(await made(NOBODY)).toEqual({ status: 201, createdById: null, scope: "PROJECT" });
    });
  });

  describe("when a key asks a REST route to change a board's scope", () => {
    /** @scenario "AC197 Scope: a key that names no person stands where a project credential does" */
    it.each([
      { key: "its author's own key", actor: keyOf(AUTHOR) },
      { key: "a key that names nobody", actor: NOBODY },
    ])("leaves the scope as it was for $key", async ({ actor }) => {
      const { app, call, boardId } = await boardAt("PROJECT");
      const send = credentialDoors(app, HOME, actor);

      await send("PATCH", `/api/dashboards/${boardId}`, { name: "Renamed", scope: "PRIVATE" });
      const board = (await call(AUTHOR, "dashboards.getById", {
        projectId: HOME,
        dashboardId: boardId,
      })) as { scope: string };

      expect(board.scope).toBe("PROJECT");
    });
  });

  describe("given a board its author set to Organization", () => {
    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is listed and opened by a member in another project of the organization", async () => {
      const { call, boardId, widgetId } = await boardAt("ORGANIZATION");
      const from = { projectId: SIBLING, dashboardId: boardId };

      const listed = (await call(TEAMMATE, "dashboards.getAll", {
        projectId: SIBLING,
        includeOrganization: true,
      })) as { id: string; ownerProject: { id: string } | null }[];

      expect({
        listed: listed.map(({ id, ownerProject }) => ({ id, owner: ownerProject?.id })),
        opened: ((await call(TEAMMATE, "dashboards.getById", from)) as { id: string }).id,
        widgets: idsOf(await call(TEAMMATE, "dashboardWidgets.list", from)),
      }).toEqual({
        listed: [{ id: boardId, owner: HOME }],
        opened: boardId,
        widgets: [widgetId],
      });
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("opens by its id for the other project's credential, and stays out of its list", async () => {
      const { app, boardId } = await boardAt("ORGANIZATION");
      const send = credentialDoors(app, SIBLING);

      const opened = await send("GET", `/api/dashboards/${boardId}`);
      const listed = await send("GET", "/api/dashboards");

      expect({ status: opened.status, id: opened.json.id, listed: listed.json.data }).toEqual({
        status: 200,
        id: boardId,
        listed: [],
      });
    });

    /** @scenario "AC189 Scope: board scope reaches only a project where Dashboards is switched on" */
    it("is a board that does not exist for a project where Dashboards is switched off", async () => {
      const { app, call, ids } = await boardAt("ORGANIZATION", { dashboardsOffIn: [SIBLING] });
      const send = credentialDoors(app, SIBLING);
      const opened = async (named: Ids) => ({
        credential: withoutIds(await send("GET", `/api/dashboards/${named.boardId}`), named),
        member: withoutIds(
          await outcomeOf(
            call(TEAMMATE, "dashboards.getById", {
              projectId: SIBLING,
              dashboardId: named.boardId,
            }),
          ),
          named,
        ),
      });
      const listed = await call(TEAMMATE, "dashboards.getAll", {
        projectId: SIBLING,
        includeOrganization: true,
      });

      expect({ listed, opened: await opened(ids) }).toEqual({
        listed: [],
        opened: await opened(MISSING),
      });
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("refuses a member's writes from another project, its author's included", async () => {
      const { call, boardId } = await boardAt("ORGANIZATION");
      const from = { projectId: SIBLING, dashboardId: boardId };
      const asked = (procedure: string, input: Input) => codeOf(call(AUTHOR, procedure, input));

      expect({
        rename: await asked("dashboards.rename", { ...from, name: "Taken" }),
        describe: await asked("dashboards.updateDetails", { ...from, description: "Mine" }),
        delete: await asked("dashboards.delete", from),
        setScope: await asked("dashboards.setScope", { ...from, scope: "PROJECT" }),
        addWidget: await asked("dashboardWidgets.create", { ...WIDGET, ...from }),
        addGraph: await asked("graphs.create", { ...GRAPH, ...from }),
      }).toEqual({
        rename: "dashboard_read_only_here",
        describe: "dashboard_read_only_here",
        delete: "dashboard_read_only_here",
        setScope: "dashboard_read_only_here",
        addWidget: "dashboard_read_only_here",
        addGraph: "dashboard_read_only_here",
      });
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("refuses the other project's credential every write with 403", async () => {
      const { app, boardId } = await boardAt("ORGANIZATION");
      const send = credentialDoors(app, SIBLING);

      const rename = await send("PATCH", `/api/dashboards/${boardId}`, { name: "Taken" });
      const remove = await send("DELETE", `/api/dashboards/${boardId}`);
      const addGraph = await send("POST", "/api/graphs", { ...GRAPH, dashboardId: boardId });

      expect(
        [rename, remove, addGraph].map(({ status, json }) => ({ status, code: json.code })),
      ).toEqual([
        { status: 403, code: "dashboard_read_only_here" },
        { status: 403, code: "dashboard_read_only_here" },
        { status: 403, code: "dashboard_read_only_here" },
      ]);
    });
  });

  describe("when a member who did not make a board changes its scope", () => {
    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("is refused at the member door, and the author is not", async () => {
      const { call, boardId } = await boardAt("PROJECT");
      const change = { projectId: HOME, dashboardId: boardId, scope: "PRIVATE" };

      const refused = await codeOf(call(TEAMMATE, "dashboards.setScope", change));
      const changed = (await call(AUTHOR, "dashboards.setScope", change)) as { scope: string };

      expect({ refused, scope: changed.scope }).toEqual({
        refused: "dashboard_scope_author_only",
        scope: "PRIVATE",
      });
    });
  });
});
