/**
 * @vitest-environment node
 * Board scope and the two areas' boards at the doors: member tRPC procedures and REST routes,
 * over the real application and its memory repositories.
 * Spec: dashboards-v2.feature AC171 to AC174, AC189, AC196, AC197 and AC199 to AC199j.
 */
import { langWatchQLCallerProtections } from "@langwatch/analytics-contract";
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  recordProjectCredential,
  type RestMountOptions,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { Actor, RestResolvedProjectCredential } from "@langwatch/authorization";
import {
  MY_DASHBOARD_NAME,
  type DashboardApi,
  type DashboardScope,
} from "@langwatch/dashboard-contract";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  createDashboardTestProjects,
  FULLY_PERMITTED,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { boardTrpcTransport } from "../board.trpc.ts";
import {
  dashboardWidgetCaller,
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
const BOX = { gridColumn: 0, gridRow: 0, colSpan: 2, rowSpan: 2 };
const PLATFORM_URL = "https://app.langwatch.test/dashboards";

/** The board and its widget, by id; or ids that name nothing. */
type Ids = Readonly<{ boardId: string; widgetId: string }>;
const MISSING: Ids = { boardId: "no-such-board", widgetId: "no-such-widget" };

/** The member doors: every boards, dashboards, widgets and graphs procedure, as one member. */
function memberDoors(app: DashboardApi) {
  const handlers = new Map<string, Handle>();
  const runtime: TrpcProcedureFactory<Context> = {
    procedure: (request) => {
      handlers.set(request.procedure, (args) => Reflect.apply(request.handle, undefined, [args]));
      return {};
    },
    router: (record) => record,
  };
  boardTrpcTransport.router(runtime, () => app);
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

/** What the project door resolves a key that names nobody to: an API key with no owner. */
const ownerlessKeyOf = (projectId: string): RestResolvedProjectCredential => ({
  type: "apiKey",
  apiKeyId: "key-nobody",
  userId: null,
  organizationId: "organization-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: {
    id: projectId,
    slug: projectId,
    name: projectId,
    teamId: "team-1",
    organizationId: "organization-1",
    isPersonal: false,
    ownerUserId: null,
    kind: "application",
  },
});

/** The credential doors: boards, graphs, widgets and saved charts with one project's API key. */
function credentialDoors(app: DashboardApi, projectId: string, actor: Actor | null = PROJECT_KEY) {
  const caller = { actor, scope: { tier: "project" as const, id: projectId } };
  // The door states what it resolved, so a key that names nobody reads on its own project's proof.
  const admit = ({ request }: { request: Request }) => {
    if (actor === NOBODY) recordProjectCredential(request, ownerlessKeyOf(projectId));
    return caller;
  };
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: { authenticate: admit, identify: admit },
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
    { under: "/api/v1/analytics/reports", hono: mount(dashboardRest) },
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
  bindMiddlewareContext(dashboardWidgetCaller, () => ({ source: { kind: "api" as const } })),
];
const CHART_CONTEXT = [
  bindMiddlewareContext(langWatchQLCallerProtections, () => FULLY_PERMITTED),
  bindMiddlewareContext(savedWorkbenchChartUrl, () => PLATFORM_URL),
];

/** The app over memory repositories, with HOME and SIBLING in one organization. */
function appWith(world: { dashboardsOffIn?: string[] } = {}) {
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
  return { app, repositories, call: memberDoors(app) };
}

/** The author's Dashboards board in HOME with a widget on it, at the scope asked for. */
async function boardAt(scope: DashboardScope, world: { dashboardsOffIn?: string[] } = {}) {
  const { app, repositories, call } = appWith(world);
  const board = (await call(AUTHOR, "boards.create", { projectId: HOME, name: "Usage" })) as {
    id: string;
  };
  const on = { projectId: HOME, dashboardId: board.id };
  const widget = (await call(AUTHOR, "dashboardWidgets.create", { ...WIDGET, ...on })) as {
    id: string;
  };
  await call(TEAMMATE, "boards.star", { projectId: HOME, star: starOf(board.id) });
  if (scope !== "PROJECT") await call(AUTHOR, "boards.setScope", { ...on, scope });

  const ids: Ids = { boardId: board.id, widgetId: widget.id };
  return { app, repositories, call, ids, ...ids };
}

const starOf = (dashboardId: string) => ({ kind: "board" as const, dashboardId });

/** Every member procedure that names a board, or a widget on one, by id. */
function memberAsks({ boardId, widgetId }: Ids): Record<string, [string, Input]> {
  const here = { projectId: HOME };
  const on = { ...here, dashboardId: boardId };
  const star = starOf(boardId);
  return {
    open: ["boards.getById", on],
    rename: ["boards.update", { ...on, name: "Taken" }],
    describe: ["boards.update", { ...on, description: "Mine" }],
    setScope: ["boards.setScope", { ...on, scope: "PROJECT" }],
    scopeImpact: ["boards.scopeImpact", on],
    scopeProjects: ["boards.scopeProjects", on],
    star: ["boards.star", { ...here, star }],
    unstar: ["boards.unstar", { ...here, star }],
    reorderStars: ["boards.reorderStars", { ...here, stars: [star] }],
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
    delete: ["boards.delete", on],
  };
}

const WIDGETS = `/api/v1/projects/${HOME}/analytics/dashboard-widgets`;

/** Every REST route that names a board's widget, or the board, by id: method, path and body. */
function credentialAsks({ boardId, widgetId }: Ids): Record<string, [string, string, unknown?]> {
  return {
    readWidget: ["GET", `${WIDGETS}/${widgetId}`],
    editWidget: ["PATCH", `${WIDGETS}/${widgetId}`, { name: "X" }],
    placeWidget: ["POST", `${WIDGETS}/${widgetId}/dashboard`, { dashboardId: boardId }],
    deleteWidget: ["DELETE", `${WIDGETS}/${widgetId}`],
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

/** The widgets the REST list of HOME answers one key. */
async function restWidgets(send: ReturnType<typeof credentialDoors>) {
  return idsOf((await send("GET", WIDGETS)).json.data);
}

/** What every REST route answers one key for these ids, less the ids themselves. */
async function restTold(send: ReturnType<typeof credentialDoors>, named: Ids) {
  const result: Record<string, { status: number }> = {};
  for (const [name, [method, path, body]] of Object.entries(credentialAsks(named))) {
    result[name] = withoutIds(await send(method, path, body), named) as { status: number };
  }
  return result;
}

describe("board scope at the doors", () => {
  describe("given a board its author set to Only me", () => {
    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is in no member procedure's list for a teammate", async () => {
      const { call } = await boardAt("PRIVATE");
      const listed = async (actor: string) => ({
        boards: idsOf(
          await call(actor, "boards.getAll", { projectId: HOME, includeOrganization: true }),
        ),
        widgets: idsOf(await call(actor, "dashboardWidgets.list", { projectId: HOME })),
      });

      const [author, teammate] = [await listed(AUTHOR), await listed(TEAMMATE)];

      expect({
        author: [author.boards.length, author.widgets.length],
        teammate,
      }).toEqual({ author: [1, 1], teammate: { boards: [], widgets: [] } });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("answers a teammate who names it by id as not found on every member procedure", async () => {
      const { call, boardId, widgetId } = await boardAt("PRIVATE");
      const on = { projectId: HOME, dashboardId: boardId };
      const asked = (procedure: string, input: Input) => codeOf(call(TEAMMATE, procedure, input));

      expect({
        open: await asked("boards.getById", on),
        rename: await asked("boards.update", { ...on, name: "Taken" }),
        describe: await asked("boards.update", { ...on, description: "Mine" }),
        delete: await asked("boards.delete", on),
        setScope: await asked("boards.setScope", { ...on, scope: "PROJECT" }),
        scopeImpact: await asked("boards.scopeImpact", on),
        scopeProjects: await asked("boards.scopeProjects", on),
        star: await asked("boards.star", { projectId: HOME, star: starOf(boardId) }),
        widgets: await asked("dashboardWidgets.list", on),
        addWidget: await asked("dashboardWidgets.create", { ...WIDGET, ...on }),
        editWidget: await asked("dashboardWidgets.update", {
          ...WIDGET,
          projectId: HOME,
          id: widgetId,
        }),
        deleteWidget: await asked("dashboardWidgets.delete", { projectId: HOME, id: widgetId }),
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
        addWidget: "dashboard_not_found",
        editWidget: "dashboard_widget_not_found",
        deleteWidget: "dashboard_widget_not_found",
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is not there for a project credential on any REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME);
      const statuses = Object.fromEntries(
        Object.entries(await restTold(send, ids)).map(([name, { status }]) => [name, status]),
      );

      expect({ listed: await restWidgets(send), statuses }).toEqual({
        listed: [],
        statuses: { readWidget: 404, editWidget: 404, placeWidget: 404, deleteWidget: 404 },
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
        accepted: ["unstar", "reorderStars", "moveWidget", "moveWidgets"],
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("lists a teammate's stars and finds their first board as it does once the board is deleted", async () => {
      const read = async ({ call }: Awaited<ReturnType<typeof boardAt>>) => {
        const starred = await call(TEAMMATE, "boards.listStarred", { projectId: HOME });
        const first = (await call(TEAMMATE, "dashboards.getOrCreateFirst", {
          projectId: HOME,
        })) as { name: string; scope: string; createdById: string | null } | null;
        return {
          starred,
          name: first?.name,
          scope: first?.scope,
          createdById: first?.createdById,
        };
      };
      const deleted = await boardAt("PROJECT");
      await deleted.call(AUTHOR, "boards.delete", {
        projectId: HOME,
        dashboardId: deleted.boardId,
      });

      expect(await read(await boardAt("PRIVATE"))).toEqual(await read(deleted));
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("tells a project credential no more than a missing id does, on any REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME);
      const missing = await restTold(send, MISSING);

      expect({
        hidden: await restTold(send, ids),
        accepted: Object.keys(missing).filter((name) => missing[name]!.status < 400),
      }).toEqual({ hidden: missing, accepted: [] });
    });

    /** @scenario "AC196 Scope: a key that names a person reads and writes as that person over REST" */
    it("lists, reads and edits its widget with its author's own key on every REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME, keyOf(AUTHOR));

      const listed = await restWidgets(send);
      const refused: string[] = [];
      for (const [name, [method, path, body]] of Object.entries(credentialAsks(ids))) {
        if ((await send(method, path, body)).status >= 400) refused.push(name);
      }

      expect({ listed, refused }).toEqual({ listed: [ids.widgetId], refused: [] });
    });

    /** @scenario "AC196 Scope: a key that names a person reads and writes as that person over REST" */
    it("tells another person's key no more than a missing id does, on any REST route", async () => {
      const { app, ids } = await boardAt("PRIVATE");
      const send = credentialDoors(app, HOME, keyOf(TEAMMATE));
      const missing = await restTold(send, MISSING);

      expect({
        listed: await restWidgets(send),
        hidden: await restTold(send, ids),
        accepted: Object.keys(missing).filter((name) => missing[name]!.status < 400),
      }).toEqual({ listed: [], hidden: missing, accepted: [] });
    });

    /** @scenario "AC197 Scope: a key that names no person stands where a project credential does" */
    it("is not read by a key that names nobody, which reads a Project board's widget", async () => {
      const hidden = await boardAt("PRIVATE");
      const shared = await boardAt("PROJECT");
      const read = async ({ app, widgetId }: typeof hidden) =>
        (await credentialDoors(app, HOME, NOBODY)("GET", `${WIDGETS}/${widgetId}`)).status;

      expect({
        listed: await restWidgets(credentialDoors(hidden.app, HOME, NOBODY)),
        onlyMe: await read(hidden),
        project: await read(shared),
      }).toEqual({ listed: [], onlyMe: 404, project: 200 });
    });
  });

  describe("when a key makes a board over REST", () => {
    /** @scenario "AC197 Scope: a key that names no person stands where a project credential does" */
    /** @scenario "AC199i Split: a board made in Analytics Reports is not pinned and not Only me" */
    it.each([
      { key: "its author's own key", actor: keyOf(AUTHOR) },
      { key: "a key that names nobody", actor: NOBODY },
    ])("makes a Reports board with no author, at Project, for $key", async ({ actor }) => {
      const { app, call } = appWith();
      const created = await credentialDoors(app, HOME, actor)("POST", "/api/v1/analytics/reports", {
        name: MY_DASHBOARD_NAME,
      });
      const board = (await call(AUTHOR, "dashboards.getById", {
        projectId: HOME,
        dashboardId: created.json.id,
      })) as { createdById: string | null; scope: string };

      expect({
        status: created.status,
        createdById: board.createdById,
        scope: board.scope,
        starred: await call(AUTHOR, "boards.listStarred", { projectId: HOME }),
      }).toEqual({ status: 201, createdById: null, scope: "PROJECT", starred: [] });
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

      const renamed = await send("PATCH", `/api/v1/analytics/reports/${boardId}`, {
        name: "Renamed",
        scope: "PRIVATE",
      });
      const board = (await call(AUTHOR, "boards.getById", {
        projectId: HOME,
        dashboardId: boardId,
      })) as { name: string; scope: string };

      expect({ status: renamed.status, name: board.name, scope: board.scope }).toEqual({
        status: 404,
        name: "Usage",
        scope: "PROJECT",
      });
    });
  });

  describe("given a board its author set to Organization", () => {
    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is listed and opened by a member in another project of the organization", async () => {
      const { call, boardId, widgetId } = await boardAt("ORGANIZATION");
      const from = { projectId: SIBLING, dashboardId: boardId };

      const listed = (await call(TEAMMATE, "boards.getAll", {
        projectId: SIBLING,
        includeOrganization: true,
      })) as { id: string; ownerProject: { id: string } | null }[];

      expect({
        listed: listed.map(({ id, ownerProject }) => ({ id, owner: ownerProject?.id })),
        opened: ((await call(TEAMMATE, "boards.getById", from)) as { id: string }).id,
        widgets: idsOf(await call(TEAMMATE, "dashboardWidgets.list", from)),
      }).toEqual({
        listed: [{ id: boardId, owner: HOME }],
        opened: boardId,
        widgets: [widgetId],
      });
    });

    /** @scenario "AC189 Scope: board scope reaches only a project where Dashboards is switched on" */
    it("is a board that does not exist for a project where Dashboards is switched off", async () => {
      const { call, ids } = await boardAt("ORGANIZATION", { dashboardsOffIn: [SIBLING] });
      const opened = async (named: Ids) =>
        withoutIds(
          await outcomeOf(
            call(TEAMMATE, "boards.getById", { projectId: SIBLING, dashboardId: named.boardId }),
          ),
          named,
        );
      const listed = await call(TEAMMATE, "boards.getAll", {
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
        rename: await asked("boards.update", { ...from, name: "Taken" }),
        describe: await asked("boards.update", { ...from, description: "Mine" }),
        delete: await asked("boards.delete", from),
        setScope: await asked("boards.setScope", { ...from, scope: "PROJECT" }),
        addWidget: await asked("dashboardWidgets.create", { ...WIDGET, ...from }),
      }).toEqual({
        rename: "dashboard_read_only_here",
        describe: "dashboard_read_only_here",
        delete: "dashboard_read_only_here",
        setScope: "dashboard_read_only_here",
        addWidget: "dashboard_read_only_here",
      });
    });
  });

  describe("when a member who did not make a board changes its scope", () => {
    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("is refused at the member door, and the author is not", async () => {
      const { call, boardId } = await boardAt("PROJECT");
      const change = { projectId: HOME, dashboardId: boardId, scope: "PRIVATE" };

      const refused = await codeOf(call(TEAMMATE, "boards.setScope", change));
      const changed = (await call(AUTHOR, "boards.setScope", change)) as { scope: string };

      expect({ refused, scope: changed.scope }).toEqual({
        refused: "dashboard_scope_author_only",
        scope: "PRIVATE",
      });
    });
  });
});

describe("the Dashboards and Analytics Reports boards at the doors", () => {
  /**
   * A Reports board with a builder graph, a Dashboards board with a widget, and a mixed board in
   * both areas under one id: a graph in Reports, a widget and a member's star in Dashboards.
   */
  async function threeBoards() {
    const { app, repositories, call } = appWith();
    const here = { projectId: HOME };
    const made = (procedure: string, name: string) =>
      call(AUTHOR, procedure, { ...here, name }) as Promise<{ id: string }>;
    const reports = await made("dashboards.create", "Reports");
    const board = await made("boards.create", "Usage");
    const mixed = await made("dashboards.create", "Mixed");
    for (const { id } of [reports, mixed]) {
      await call(AUTHOR, "graphs.create", { ...here, ...GRAPH, dashboardId: id });
    }
    // The split copied the mixed board into DashboardsV2 under its id.
    await repositories.boards.createBoard({ id: mixed.id, projectId: HOME, name: "Mixed" });
    for (const { id } of [board, mixed]) {
      await call(AUTHOR, "dashboardWidgets.create", { ...here, ...WIDGET, dashboardId: id });
    }
    await call(TEAMMATE, "boards.star", { ...here, star: starOf(mixed.id) });
    return { app, call, reports, board, mixed };
  }

  type Boards = Awaited<ReturnType<typeof threeBoards>>;
  const lists = async ({ call }: Boards) => ({
    dashboards: idsOf(await call(AUTHOR, "boards.getAll", { projectId: HOME })).toSorted(),
    reports: idsOf(await call(AUTHOR, "dashboards.getAll", { projectId: HOME })).toSorted(),
  });

  /** @scenario "AC199 Split: Dashboards and Analytics Reports each list and open only their own boards" */
  /** @scenario "AC199c Legacy board: Langy saves a chart only onto a board made in Analytics Reports" */
  it("lists each board in its own area, the mixed board in both, and opens none across", async () => {
    const world = await threeBoards();
    const { call, reports, board, mixed } = world;
    const opened = (procedure: string, dashboardId: string) =>
      codeOf(call(AUTHOR, procedure, { projectId: HOME, dashboardId }));

    expect({
      ...(await lists(world)),
      reportsInDashboards: await opened("boards.getById", reports.id),
      boardInReports: await opened("dashboards.getById", board.id),
    }).toEqual({
      dashboards: [board.id, mixed.id].toSorted(),
      reports: [reports.id, mixed.id].toSorted(),
      reportsInDashboards: "dashboard_not_found",
      boardInReports: "dashboard_not_found",
    });
  });

  /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
  it("deletes the mixed board from Dashboards and leaves its Reports board and graph", async () => {
    const world = await threeBoards();
    const { call, reports, board, mixed } = world;
    const deleted = (dashboardId: string) =>
      codeOf(call(AUTHOR, "boards.delete", { projectId: HOME, dashboardId }));
    const graphs = async () =>
      idsOf(await call(AUTHOR, "graphs.getAll", { projectId: HOME })).length;
    const graphsBefore = await graphs();

    expect({
      mixed: await deleted(mixed.id),
      reportsOnly: await deleted(reports.id),
      ...(await lists(world)),
      graphs: [graphsBefore, await graphs()],
      starred: await call(TEAMMATE, "boards.listStarred", { projectId: HOME }),
    }).toEqual({
      mixed: "<resolved>",
      reportsOnly: "dashboard_not_found",
      dashboards: [board.id],
      reports: [reports.id, mixed.id].toSorted(),
      graphs: [2, 2],
      starred: [],
    });
  });

  /** @scenario "AC199d Split: a Reports delete leaves the Dashboards area unchanged" */
  it("deletes the mixed board from Reports, over tRPC and REST, and leaves its Dashboards board", async () => {
    const world = await threeBoards();
    const { app, call, reports, board, mixed } = world;

    const removed = await call(AUTHOR, "dashboards.delete", {
      projectId: HOME,
      dashboardId: mixed.id,
    });
    const overRest = await credentialDoors(app, HOME)(
      "DELETE",
      `/api/v1/analytics/reports/${reports.id}`,
    );

    expect({
      removed: (removed as { id: string }).id,
      restStatus: overRest.status,
      ...(await lists(world)),
      widgets: idsOf(
        await call(AUTHOR, "dashboardWidgets.list", { projectId: HOME, dashboardId: mixed.id }),
      ).length,
      starred: idsOf(
        (
          (await call(TEAMMATE, "boards.listStarred", { projectId: HOME })) as {
            dashboard: { id: string };
          }[]
        ).map(({ dashboard }) => dashboard),
      ),
    }).toEqual({
      removed: mixed.id,
      restStatus: 200,
      dashboards: [board.id, mixed.id].toSorted(),
      reports: [],
      widgets: 1,
      starred: [mixed.id],
    });
  });

  /** @scenario "AC199i Split: a board made in Analytics Reports is not pinned and not Only me" */
  it("makes My dashboard in Reports at Project with no star, and in Dashboards Only me and starred", async () => {
    const { call } = appWith();
    const made = (procedure: string) =>
      call(AUTHOR, procedure, { projectId: HOME, name: MY_DASHBOARD_NAME }) as Promise<{
        id: string;
        scope: string;
        createdById: string | null;
      }>;

    const reports = await made("dashboards.create");
    const board = await made("boards.create");
    const starred = (await call(AUTHOR, "boards.listStarred", { projectId: HOME })) as {
      dashboard: { id: string };
    }[];

    expect({
      reports: [reports.scope, reports.createdById],
      board: [board.scope, board.createdById],
      starred: starred.map(({ dashboard }) => dashboard.id),
    }).toEqual({
      reports: ["PROJECT", null],
      board: ["PRIVATE", AUTHOR],
      starred: [board.id],
    });
  });

  /** @scenario "AC199j Split: a Reports write refuses the id of a board only Dashboards holds" */
  it("answers a Reports write over tRPC or REST naming a Dashboards board as for a missing id", async () => {
    const { app, call, board } = await threeBoards();
    const send = credentialDoors(app, HOME);
    const asked = async (dashboardId: string) => ({
      rename: await codeOf(
        call(AUTHOR, "dashboards.rename", { projectId: HOME, dashboardId, name: "X" }),
      ),
      delete: await codeOf(call(AUTHOR, "dashboards.delete", { projectId: HOME, dashboardId })),
      addGraph: await codeOf(
        call(AUTHOR, "graphs.create", { projectId: HOME, ...GRAPH, dashboardId }),
      ),
      restRename: (await send("PATCH", `/api/v1/analytics/reports/${dashboardId}`, { name: "X" }))
        .status,
      restDelete: (await send("DELETE", `/api/v1/analytics/reports/${dashboardId}`)).status,
      restReorder: (
        await send("PUT", "/api/v1/analytics/reports/reorder", { dashboardIds: [dashboardId] })
      ).status,
    });

    expect(await asked(board.id)).toEqual(await asked("no-such-board"));
    expect(await asked(board.id)).toMatchObject({
      rename: "dashboard_not_found",
      delete: "dashboard_not_found",
      restDelete: 404,
    });
  });
});
