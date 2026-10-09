/**
 * @vitest-environment node
 * Board scope at the doors: the member tRPC procedures and the project-credential REST routes,
 * over the real application and its memory repositories.
 * Spec: dashboards-v2.feature AC171 to AC174.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { DashboardApi, DashboardScope } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestApp,
  createDashboardTestProjects,
} from "../../app/__tests__/dashboard.fixture.ts";
import { dashboardWidgetTrpcTransport } from "../dashboard-widget.trpc.ts";
import { dashboardRest } from "../dashboard.rest.ts";
import { dashboardTrpcTransport } from "../dashboard.trpc.ts";
import { graphRest } from "../graph.rest.ts";
import { graphTrpcTransport } from "../graph.trpc.ts";

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

/** The credential doors: `/api/dashboards` and `/api/graphs` with one project's API key. */
function credentialDoors(app: DashboardApi, projectId: string) {
  const caller = {
    actor: { type: "api_key" as const, id: "key-1" },
    scope: { tier: "project" as const, id: projectId },
  };
  const runtime = createRestRuntime({
    identity: { authenticate: () => caller, identify: () => caller },
  });
  const mounted = [dashboardRest, graphRest].map((family) =>
    runtime.mount(family.router(), { app: () => app, facts: [], onError: canonicalErrorResponse }),
  );

  return async (method: string, path: string, body?: unknown) => {
    const hono = path.startsWith("/api/dashboards") ? mounted[0] : mounted[1];
    const response = await hono!.fetch(
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

/** The author's board in HOME, with a widget and a graph, at the scope asked for. */
async function boardAt(scope: DashboardScope) {
  const app = createDashboardTestApp({
    dependencies: {
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
  if (scope !== "PROJECT") await call(AUTHOR, "dashboards.setScope", { ...on, scope });

  return { app, call, boardId: board.id, widgetId: widget.id, graphId: graph.id };
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
