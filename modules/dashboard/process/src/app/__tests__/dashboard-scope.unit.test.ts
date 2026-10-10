/**
 * Board scope on the server, through the composed app over memory repositories: what each
 * operation answers for the author, a teammate, another project and a project credential.
 * Spec: dashboards-v2.feature AC170 to AC182 and AC189.
 */
import {
  MY_DASHBOARD_NAME,
  type DashboardApi,
  type DashboardScope,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  createDashboardTestAuthz,
  createDashboardTestProjects,
} from "./dashboard.fixture.ts";

const HOME = "project-home";
const SIBLING = "project-sibling";
const FAR = "project-far";
const ORGANIZATIONS = {
  [HOME]: "organization-1",
  [SIBLING]: "organization-1",
  [FAR]: "organization-2",
};
const AUTHOR = { userId: "author" };
const TEAMMATE = { userId: "teammate" };
const WIDGET = {
  name: "Usage",
  code: "export default () => null;",
  queries: [{ name: "usage", sql: "SELECT 1" }],
};
const LAYOUT = { gridColumn: 0, gridRow: 0, colSpan: 2, rowSpan: 2 };
const CHART_ID = "chart-on-board";

type Viewer = { userId: string } | undefined;
type Target = Readonly<{ dashboardId: string; widgetId: string; graphId: string; chartId: string }>;
/** A board and an unplaced widget every member of HOME sees, for a move to or from a target. */
type Open = Readonly<{ dashboardId: string; widgetId: string }>;
type World = Readonly<{ openProjectIds?: readonly string[]; dashboardsOffIn?: readonly string[] }>;

/** The app, with the projects where Dashboards is off in a set a test may change. */
function appWith(input: World = {}) {
  const repositories = MemoryDashboardRepositories.create();
  const dashboardsOff = new Set(input.dashboardsOffIn);
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isDashboardsEnabled: async ({ projectId }) => !dashboardsOff.has(projectId),
      }),
      projects: createDashboardTestProjects({ organizations: ORGANIZATIONS }),
      authz: createDashboardTestAuthz(input),
    },
  });
  return { app, repositories, dashboardsOff };
}

/** The author's board in HOME with a widget, a graph and a saved chart on it. */
async function boardAt(scope: DashboardScope, world: World = {}) {
  const { app, repositories, dashboardsOff } = appWith(world);
  const board = await app.create({
    projectId: HOME,
    name: "Reports",
    createdById: AUTHOR.userId,
  });
  const on = { projectId: HOME, dashboardId: board.id, viewer: AUTHOR };
  const widget = await app.createDashboardWidget({ ...WIDGET, ...on });
  const graph = await app.createGraph({ ...on, name: "Latency", graph: { graphType: "line" } });
  await repositories.dashboards.createSavedWorkbenchChart({
    id: CHART_ID,
    projectId: HOME,
    name: "Spend",
    definition: { version: 1, sql: "SELECT 1", parameters: {} },
  });
  await app.placeSavedWorkbenchChart({ ...on, chartId: CHART_ID });
  await app.star({ projectId: HOME, userId: TEAMMATE.userId, star: starOf(board.id) });
  if (scope !== "PROJECT") await app.setDashboardScope({ ...on, scope });

  const target: Target = {
    dashboardId: board.id,
    widgetId: widget.id,
    graphId: graph.id,
    chartId: CHART_ID,
  };
  return { app, repositories, dashboardsOff, board, target };
}

/** A Project board and an unplaced widget in HOME, made by the author after the target. */
async function openThings(app: DashboardApi): Promise<Open> {
  const made = { projectId: HOME, viewer: AUTHOR };
  const board = await app.create({ projectId: HOME, name: "Open", createdById: AUTHOR.userId });
  const widget = await app.createDashboardWidget({ ...WIDGET, ...made });
  return { dashboardId: board.id, widgetId: widget.id };
}

const NOTHING_OPEN: Open = { dashboardId: "no-open-board", widgetId: "no-open-widget" };

const starOf = (dashboardId: string) => ({ kind: "board" as const, dashboardId });
const MISSING: Target = {
  dashboardId: "no-such-board",
  widgetId: "no-such-widget",
  graphId: "no-such-graph",
  chartId: "no-such-chart",
};

/** The `code` a rejected call carries, or that it resolved. */
async function codeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return (error as { code?: unknown }).code ?? String(error);
  }
  return "<resolved>";
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

type Asking = Readonly<{ app: DashboardApi; projectId: string; viewer: Viewer; open?: Open }>;

/** Every operation that names a board, or something on one, by id. */
function operations({
  app,
  projectId,
  viewer,
  open = NOTHING_OPEN,
}: Asking): Record<string, (target: Target) => Promise<unknown>> {
  const as = { projectId, viewer };
  const member = viewer ?? TEAMMATE;
  const starring = { projectId, userId: member.userId };
  return {
    open: ({ dashboardId }) => app.getById({ ...as, dashboardId }),
    rename: ({ dashboardId }) => app.rename({ ...as, dashboardId, name: "Taken" }),
    describe: ({ dashboardId }) =>
      app.updateDashboardDetails({ projectId, dashboardId, viewer: member, description: "Mine" }),
    delete: ({ dashboardId }) => app.delete({ ...as, dashboardId }),
    reorder: ({ dashboardId }) => app.reorder({ ...as, dashboardIds: [dashboardId] }),
    star: ({ dashboardId }) => app.star({ ...starring, star: starOf(dashboardId) }),
    unstar: ({ dashboardId }) => app.unstar({ ...starring, star: starOf(dashboardId) }),
    reorderStars: ({ dashboardId }) =>
      app.reorderStars({ ...starring, stars: [starOf(dashboardId)] }),
    setScope: ({ dashboardId }) =>
      app.setDashboardScope({ projectId, dashboardId, viewer: member, scope: "PROJECT" }),
    scopeImpact: ({ dashboardId }) =>
      app.getDashboardScopeImpact({ projectId, dashboardId, viewer: member }),
    scopeProjects: ({ dashboardId }) =>
      app.listDashboardScopeProjects({ projectId, dashboardId, viewer: member }),
    listBoardWidgets: ({ dashboardId }) => app.listDashboardWidgets({ ...as, dashboardId }),
    addWidget: ({ dashboardId }) => app.createDashboardWidget({ ...WIDGET, ...as, dashboardId }),
    readWidget: ({ widgetId }) => app.getDashboardWidget({ ...as, id: widgetId }),
    editWidget: ({ widgetId }) => app.updateDashboardWidget({ ...as, id: widgetId, name: "X" }),
    placeWidget: ({ dashboardId }) =>
      app.assignDashboardWidgetToDashboard({ ...as, id: open.widgetId, dashboardId }),
    takeWidget: ({ widgetId }) =>
      app.assignDashboardWidgetToDashboard({ ...as, id: widgetId, dashboardId: open.dashboardId }),
    moveWidget: ({ widgetId }) =>
      app.updateDashboardWidgetLayout({ ...as, graphId: widgetId, layout: LAYOUT }),
    moveWidgets: ({ widgetId }) =>
      app.batchUpdateDashboardWidgetLayouts({
        ...as,
        layouts: [{ graphId: widgetId, layout: LAYOUT }],
      }),
    deleteWidget: ({ widgetId }) => app.deleteDashboardWidget({ ...as, id: widgetId }),
    listBoardGraphs: ({ dashboardId }) => app.listGraphs({ ...as, dashboardId }),
    addGraph: ({ dashboardId }) =>
      app.createGraph({ ...as, dashboardId, name: "Errors", graph: { graphType: "line" } }),
    readGraph: ({ graphId }) => app.getGraph({ ...as, graphId }),
    editGraph: ({ graphId }) => app.updateGraph({ ...as, graphId, name: "X" }),
    moveGraph: ({ graphId }) => app.updateGraphLayout({ ...as, graphId, layout: LAYOUT }),
    moveGraphs: ({ graphId }) =>
      app.batchUpdateGraphLayouts({ ...as, layouts: [{ graphId, layout: LAYOUT }] }),
    deleteGraph: ({ graphId }) => app.deleteGraph({ ...as, graphId }),
    readChart: ({ chartId }) => app.getSavedWorkbenchChart({ ...as, chartId }),
    editChart: ({ chartId }) => app.updateSavedWorkbenchChart({ ...as, chartId, name: "X" }),
    memberEditChart: ({ chartId }) =>
      app.updateMemberSavedWorkbenchChart({
        ...as,
        chartId,
        actorId: member.userId,
        name: "X",
      }),
    runChart: ({ chartId }) =>
      app.runSavedWorkbenchChart({ ...as, chartId, actorId: member.userId }),
    placeChart: ({ dashboardId }) =>
      app.placeSavedWorkbenchChart({ ...as, chartId: CHART_ID, dashboardId }),
    unplaceChart: ({ chartId }) => app.unplaceSavedWorkbenchChart({ ...as, chartId }),
    deleteChart: ({ chartId }) => app.deleteSavedWorkbenchChart({ ...as, chartId }),
  };
}

/** What each operation answers, one after the other, by name. */
async function answers(input: Asking, target: Target): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(operations(input))) {
    result[name] = await codeOf(run(target));
  }
  return result;
}

/**
 * The whole of what each operation answers, its code, status, message and payload, with the ids
 * the caller named taken out: a hidden board must say no more than a missing one in any of them.
 */
async function outcomes(input: Asking, target: Target): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(operations(input))) {
    const told = JSON.stringify(await outcomeOf(run(target)));
    const named = Object.values(target).reduce((text, id) => text.replaceAll(id, "<id>"), told);
    result[name] = JSON.parse(named);
  }
  return result;
}

/** The operations that accept an id naming nothing: each changes nothing, or lists nothing. */
const ACCEPTED_FOR_A_MISSING_ID = [
  "unstar",
  "reorderStars",
  "moveWidget",
  "moveWidgets",
  "listBoardGraphs",
];

const acceptedIn = (told: Record<string, unknown>) =>
  Object.entries(told).flatMap(([name, outcome]) => ("resolved" in Object(outcome) ? [name] : []));

const listedIds = async (app: DashboardApi, projectId: string, viewer: Viewer) =>
  (
    await app.getAll({ projectId, graphCountScope: "builder", viewer, includeOrganization: true })
  ).map(({ id }) => id);

describe("board scope on the server", () => {
  describe("when a board is made", () => {
    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("starts at Project, owned by the project it was made in", async () => {
      const { app } = appWith();

      const board = await app.create({
        projectId: HOME,
        name: "Reports",
        createdById: AUTHOR.userId,
      });

      expect(board).toMatchObject({ scope: "PROJECT", projectId: HOME, organizationId: null });
    });

    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("starts a member's My dashboard at Only me, and a credential's at Project", async () => {
      const { app } = appWith();

      const own = await app.create({
        projectId: HOME,
        name: MY_DASHBOARD_NAME,
        createdById: AUTHOR.userId,
      });
      const credentials = await app.create({ projectId: HOME, name: MY_DASHBOARD_NAME });

      expect([own.scope, credentials.scope]).toEqual(["PRIVATE", "PROJECT"]);
    });
  });

  describe("given a board its author set to Only me", () => {
    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("answers a teammate on every operation as a board that does not exist", async () => {
      const { app, target } = await boardAt("PRIVATE");
      const teammate = { app, projectId: HOME, viewer: TEAMMATE, open: await openThings(app) };
      const missing = await outcomes(teammate, MISSING);

      expect({
        hidden: await outcomes(teammate, target),
        accepted: acceptedIn(missing),
      }).toEqual({ hidden: missing, accepted: ACCEPTED_FOR_A_MISSING_ID });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("answers a project credential on every operation as a board that does not exist", async () => {
      const { app, target } = await boardAt("PRIVATE");
      const credential = { app, projectId: HOME, viewer: void 0, open: await openThings(app) };
      const missing = await outcomes(credential, MISSING);

      expect({
        hidden: await outcomes(credential, target),
        accepted: acceptedIn(missing),
      }).toEqual({ hidden: missing, accepted: ACCEPTED_FOR_A_MISSING_ID });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("lists a member's stars and finds their first board as it does once the board is deleted", async () => {
      const read = async (world: Awaited<ReturnType<typeof boardAt>>, viewer: Viewer) => {
        const { app, target } = world;
        const starred = await app.listStarred({
          projectId: HOME,
          userId: (viewer ?? TEAMMATE).userId,
        });
        const [first, ...more] = await app.getOrCreateFirst({ projectId: HOME, viewer });
        if (first === undefined) throw new Error("no first board was found or made");
        // `order` counts every board of the project, hidden ones too: a known side channel.
        const { name, scope, createdById, description, organizationId } = first;
        const made = { name, scope, createdById, description, organizationId };
        const isTheBoard = first.id === target.dashboardId;
        return { starred, first: made, isTheBoard, others: more.length };
      };
      const deleted = async () => {
        const world = await boardAt("PROJECT");
        await world.app.delete({
          projectId: HOME,
          dashboardId: world.target.dashboardId,
          viewer: AUTHOR,
        });
        return world;
      };

      expect({
        teammate: await read(await boardAt("PRIVATE"), TEAMMATE),
        credential: await read(await boardAt("PRIVATE"), void 0),
      }).toEqual({
        teammate: await read(await deleted(), TEAMMATE),
        credential: await read(await deleted(), void 0),
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("leaves the board and everything on it untouched by those attempts", async () => {
      const { app, target } = await boardAt("PRIVATE");
      const open = await openThings(app);
      const read = { projectId: HOME, viewer: AUTHOR };
      const stored = async () => ({
        board: await app.getById({ ...read, dashboardId: target.dashboardId }),
        widget: await app.getDashboardWidget({ ...read, id: target.widgetId }),
        graph: await app.getGraph({ ...read, graphId: target.graphId }),
        chart: await app.getSavedWorkbenchChart({ ...read, chartId: target.chartId }),
      });
      const before = await stored();

      await answers({ app, projectId: HOME, viewer: TEAMMATE, open }, target);
      await answers({ app, projectId: HOME, viewer: void 0, open }, target);

      expect(await stored()).toEqual(before);
      expect(before).toMatchObject({
        board: { name: "Reports", description: null, scope: "PRIVATE" },
        widget: { name: "Usage", dashboardId: target.dashboardId },
        graph: { name: "Latency", dashboardId: target.dashboardId },
        chart: { name: "Spend", dashboardId: target.dashboardId },
      });
    });

    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("keeps a teammate's star through their unstar of a board they cannot see", async () => {
      const { app, target } = await boardAt("PRIVATE");
      const on = { projectId: HOME, dashboardId: target.dashboardId, viewer: AUTHOR };
      const teammate = { projectId: HOME, userId: TEAMMATE.userId };

      await app.unstar({ ...teammate, star: starOf(target.dashboardId) });
      await app.setDashboardScope({ ...on, scope: "PROJECT" });

      expect(await app.listStarred(teammate)).toMatchObject([
        { kind: "board", dashboard: { id: target.dashboardId } },
      ]);
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is in no list a teammate or a project credential reads", async () => {
      const { app } = await boardAt("PRIVATE");
      const lists = async (viewer: Viewer) => ({
        boards: await listedIds(app, HOME, viewer),
        widgets: await app.listDashboardWidgets({ projectId: HOME, viewer }),
        graphs: await app.listGraphs({ projectId: HOME, viewer }),
        charts: await app.listSavedWorkbenchCharts({ projectId: HOME, viewer }),
      });
      const empty = { boards: [], widgets: [], graphs: [], charts: [] };

      expect({
        teammate: await lists(TEAMMATE),
        credential: await lists(void 0),
        starred: await app.listStarred({ projectId: HOME, userId: TEAMMATE.userId }),
      }).toEqual({ teammate: empty, credential: empty, starred: [] });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is listed, opened and edited by its author as before", async () => {
      const { app, target } = await boardAt("PRIVATE");
      const author = { projectId: HOME, viewer: AUTHOR };

      expect({
        listed: await listedIds(app, HOME, AUTHOR),
        widgets: (await app.listDashboardWidgets(author)).map(({ id }) => id),
        renamed: (await app.rename({ ...author, dashboardId: target.dashboardId, name: "Mine" }))
          .name,
        added: await codeOf(
          app.createDashboardWidget({ ...WIDGET, ...author, dashboardId: target.dashboardId }),
        ),
      }).toEqual({
        listed: [target.dashboardId],
        widgets: [target.widgetId],
        renamed: "Mine",
        added: "<resolved>",
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is not shown in another project, to its author either", async () => {
      const { app, target } = await boardAt("PRIVATE");

      expect({
        listed: await listedIds(app, SIBLING, AUTHOR),
        opened: await codeOf(
          app.getById({ projectId: SIBLING, dashboardId: target.dashboardId, viewer: AUTHOR }),
        ),
      }).toEqual({ listed: [], opened: "dashboard_not_found" });
    });
  });

  describe("given a board its author set to Organization", () => {
    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is listed in another project of the organization, marked as owned by its project", async () => {
      const { app, target } = await boardAt("ORGANIZATION");

      const listed = await app.getAll({
        projectId: SIBLING,
        graphCountScope: "builder",
        viewer: TEAMMATE,
        includeOrganization: true,
      });

      expect(listed).toMatchObject([
        {
          id: target.dashboardId,
          scope: "ORGANIZATION",
          organizationId: "organization-1",
          ownerProject: { id: HOME, name: `Project ${HOME}`, slug: `slug-${HOME}` },
        },
      ]);
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("names no owner project where it is at home", async () => {
      const { app } = await boardAt("ORGANIZATION");

      const [listed] = await app.getAll({
        projectId: HOME,
        graphCountScope: "builder",
        viewer: TEAMMATE,
        includeOrganization: true,
      });

      expect(listed?.ownerProject).toBeNull();
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("opens there by its id, with its widgets, for a member and a project credential", async () => {
      const { app, target } = await boardAt("ORGANIZATION");
      const opened = async (viewer: Viewer) => {
        const from = { projectId: SIBLING, dashboardId: target.dashboardId, viewer };
        return {
          board: (await app.getById(from)).id,
          widgets: (await app.listDashboardWidgets(from)).map(({ id }) => id),
        };
      };
      const whole = { board: target.dashboardId, widgets: [target.widgetId] };

      expect([await opened(TEAMMATE), await opened(void 0)]).toEqual([whole, whole]);
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is neither listed nor opened in a project of another organization", async () => {
      const { app, target } = await boardAt("ORGANIZATION");
      const from = { projectId: FAR, dashboardId: target.dashboardId, viewer: TEAMMATE };

      expect({
        listed: await listedIds(app, FAR, TEAMMATE),
        opened: await codeOf(app.getById(from)),
        widgets: await codeOf(app.listDashboardWidgets(from)),
      }).toEqual({ listed: [], opened: "dashboard_not_found", widgets: "dashboard_not_found" });
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("stays out of the list a caller reads without asking for the organization's boards", async () => {
      const { app } = await boardAt("ORGANIZATION");

      const listed = await app.getAll({
        projectId: SIBLING,
        graphCountScope: "builder",
        viewer: TEAMMATE,
      });

      expect(listed).toEqual([]);
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("refuses every write made from a project that does not own it", async () => {
      const { app, target } = await boardAt("ORGANIZATION");

      const refused = await answers({ app, projectId: SIBLING, viewer: AUTHOR }, target);

      expect(refused).toMatchObject({
        rename: "dashboard_read_only_here",
        describe: "dashboard_read_only_here",
        delete: "dashboard_read_only_here",
        setScope: "dashboard_read_only_here",
        reorder: "dashboard_reorder_unknown_ids",
        addWidget: "dashboard_read_only_here",
        editWidget: "dashboard_widget_not_found",
        deleteWidget: "dashboard_widget_not_found",
        addGraph: "dashboard_read_only_here",
        editGraph: "graph_not_found",
        moveGraph: "graph_not_found",
        deleteGraph: "graph_not_found",
        placeChart: "saved_workbench_chart_dashboard_not_found",
      });
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("is unchanged by those attempts", async () => {
      const { app, target } = await boardAt("ORGANIZATION");
      await answers({ app, projectId: SIBLING, viewer: AUTHOR }, target);

      const read = { projectId: HOME, viewer: AUTHOR };
      expect({
        board: await app.getById({ ...read, dashboardId: target.dashboardId }),
        widgets: (await app.listDashboardWidgets({ ...read, dashboardId: target.dashboardId })).map(
          ({ id, name }) => ({ id, name }),
        ),
      }).toMatchObject({
        board: { name: "Reports", description: null, scope: "ORGANIZATION" },
        widgets: [{ id: target.widgetId, name: "Usage" }],
      });
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("accepts the same writes in the project that owns it, from any member who may edit", async () => {
      const { app, target } = await boardAt("ORGANIZATION");
      const home = { projectId: HOME, viewer: TEAMMATE };

      expect({
        renamed: await codeOf(
          app.rename({ ...home, dashboardId: target.dashboardId, name: "Ours" }),
        ),
        added: await codeOf(
          app.createDashboardWidget({ ...WIDGET, ...home, dashboardId: target.dashboardId }),
        ),
        edited: await codeOf(
          app.updateDashboardWidget({ ...home, id: target.widgetId, name: "X" }),
        ),
      }).toEqual({ renamed: "<resolved>", added: "<resolved>", edited: "<resolved>" });
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("lets a member of another project star it", async () => {
      const { app, target } = await boardAt("ORGANIZATION");
      const visitor = { projectId: SIBLING, userId: "visitor" };

      await app.star({ ...visitor, star: starOf(target.dashboardId) });

      expect(await app.listStarred(visitor)).toMatchObject([
        { kind: "board", dashboard: { id: target.dashboardId } },
      ]);
    });
  });

  describe("when someone changes a board's scope", () => {
    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("refuses a member who did not make the board, and leaves the scope as it was", async () => {
      const { app, target } = await boardAt("PROJECT");
      const on = { projectId: HOME, dashboardId: target.dashboardId };

      const refusal = await codeOf(
        app.setDashboardScope({ ...on, viewer: TEAMMATE, scope: "PRIVATE" }),
      );

      expect({ refusal, scope: (await app.getById({ ...on, viewer: AUTHOR })).scope }).toEqual({
        refusal: "dashboard_scope_author_only",
        scope: "PROJECT",
      });
    });

    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("refuses everyone on a board with no recorded author, which stays at Project", async () => {
      const { app } = appWith();
      const board = await app.create({ projectId: HOME, name: "From the API" });
      const on = { projectId: HOME, dashboardId: board.id };

      const refusal = await codeOf(
        app.setDashboardScope({ ...on, viewer: AUTHOR, scope: "PRIVATE" }),
      );

      expect({ refusal, scope: (await app.getById(on)).scope }).toEqual({
        refusal: "dashboard_scope_author_only",
        scope: "PROJECT",
      });
    });

    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("keeps what a narrower scope would cost for the author's eyes only", async () => {
      const { app, target } = await boardAt("PROJECT");
      const on = { projectId: HOME, dashboardId: target.dashboardId };

      expect({
        teammate: await codeOf(app.getDashboardScopeImpact({ ...on, viewer: TEAMMATE })),
        author: await app.getDashboardScopeImpact({ ...on, viewer: AUTHOR }),
      }).toEqual({ teammate: "dashboard_scope_author_only", author: { otherStars: 1 } });
    });

    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("leaves editing and deleting a Project board to any member, as before", async () => {
      const { app, target } = await boardAt("PROJECT");
      const on = { projectId: HOME, dashboardId: target.dashboardId, viewer: TEAMMATE };

      expect({
        renamed: await codeOf(app.rename({ ...on, name: "Ours" })),
        deleted: await codeOf(app.delete(on)),
      }).toEqual({ renamed: "<resolved>", deleted: "<resolved>" });
    });

    /** @scenario "AC175 Scope: any board can be set to Only me, My dashboard like any other" */
    it("sets every board of a member to Only me, with no limit", async () => {
      const { app } = appWith();
      const names = ["One", "Two", "Three", "Four", "Five"];
      const scopes: DashboardScope[] = [];

      for (const name of names) {
        const board = await app.create({ projectId: HOME, name, createdById: AUTHOR.userId });
        const changed = await app.setDashboardScope({
          projectId: HOME,
          dashboardId: board.id,
          viewer: AUTHOR,
          scope: "PRIVATE",
        });
        scopes.push(changed.scope);
      }

      expect({ scopes, listedForTeammate: await listedIds(app, HOME, TEAMMATE) }).toEqual({
        scopes: names.map(() => "PRIVATE"),
        listedForTeammate: [],
      });
    });

    /** @scenario "AC175 Scope: any board can be set to Only me, My dashboard like any other" */
    it("takes a member's My dashboard to Project, to Organization and back to Only me", async () => {
      const { app } = appWith();
      const own = await app.create({
        projectId: HOME,
        name: MY_DASHBOARD_NAME,
        createdById: AUTHOR.userId,
      });
      const set = async (scope: DashboardScope) =>
        app.setDashboardScope({ projectId: HOME, dashboardId: own.id, viewer: AUTHOR, scope });

      const widened = await set("PROJECT");
      const listedWhenWidened = await listedIds(app, HOME, TEAMMATE);
      const shared = await set("ORGANIZATION");
      const back = await set("PRIVATE");

      expect({
        scopes: [widened.scope, shared.scope, back.scope],
        organization: shared.organizationId,
        listedWhenWidened,
        listedAfter: await listedIds(app, HOME, TEAMMATE),
      }).toEqual({
        scopes: ["PROJECT", "ORGANIZATION", "PRIVATE"],
        organization: "organization-1",
        listedWhenWidened: [own.id],
        listedAfter: [],
      });
    });
  });

  describe("given a board other members starred", () => {
    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("leaves their starred lists at Only me and comes back when the scope widens", async () => {
      const { app, target } = await boardAt("PROJECT");
      const on = { projectId: HOME, dashboardId: target.dashboardId, viewer: AUTHOR };
      const starred = async () =>
        (await app.listStarred({ projectId: HOME, userId: TEAMMATE.userId })).length;

      const before = await starred();
      await app.setDashboardScope({ ...on, scope: "PRIVATE" });
      const hidden = await starred();
      await app.setDashboardScope({ ...on, scope: "PROJECT" });

      expect({ before, hidden, after: await starred() }).toEqual({
        before: 1,
        hidden: 0,
        after: 1,
      });
    });

    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("shows one star on an Organization board in every project that lists the board", async () => {
      const { app, target } = await boardAt("ORGANIZATION");
      const starredIn = async (projectId: string) =>
        (await app.listStarred({ projectId, userId: TEAMMATE.userId })).length;

      expect({ home: await starredIn(HOME), sibling: await starredIn(SIBLING) }).toEqual({
        home: 1,
        sibling: 1,
      });

      await app.unstar({
        projectId: SIBLING,
        userId: TEAMMATE.userId,
        star: starOf(target.dashboardId),
      });

      expect({ home: await starredIn(HOME), sibling: await starredIn(SIBLING) }).toEqual({
        home: 0,
        sibling: 0,
      });
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("counts the other members who starred it, not the author", async () => {
      const { app, target } = await boardAt("PROJECT");
      const on = { projectId: HOME, dashboardId: target.dashboardId };
      await app.star({ projectId: HOME, userId: AUTHOR.userId, star: starOf(on.dashboardId) });
      await app.star({ projectId: HOME, userId: "third", star: starOf(on.dashboardId) });

      expect(await app.getDashboardScopeImpact({ ...on, viewer: AUTHOR })).toEqual({
        otherStars: 2,
      });
    });
  });

  describe("given a project where Dashboards is switched off", () => {
    /** @scenario "AC189 Scope: board scope reaches only a project where Dashboards is switched on" */
    it("starts a member's My dashboard at Project there, so a teammate lists it", async () => {
      const { app } = appWith({ dashboardsOffIn: [HOME] });

      const own = await app.create({
        projectId: HOME,
        name: MY_DASHBOARD_NAME,
        createdById: AUTHOR.userId,
      });

      expect({ scope: own.scope, teammateLists: await listedIds(app, HOME, TEAMMATE) }).toEqual({
        scope: "PROJECT",
        teammateLists: [own.id],
      });
    });

    /** @scenario "AC189 Scope: board scope reaches only a project where Dashboards is switched on" */
    it.each([
      ["a member", TEAMMATE],
      ["a project credential", void 0],
    ])(
      "answers %s for another project's Organization board as for a board that does not exist",
      async (_who, viewer) => {
        const { app, target } = await boardAt("ORGANIZATION", { dashboardsOffIn: [SIBLING] });
        const guest = { app, projectId: SIBLING, viewer };

        expect({
          listed: await listedIds(app, SIBLING, viewer),
          board: await outcomes(guest, target),
        }).toEqual({ listed: [], board: await outcomes(guest, MISSING) });
      },
    );

    /** @scenario "AC189 Scope: board scope reaches only a project where Dashboards is switched on" */
    it("still lists and opens a board in the project that owns it, and where Dashboards is on", async () => {
      const { app, target, dashboardsOff } = await boardAt("ORGANIZATION");
      dashboardsOff.add(HOME);
      const opened = async (projectId: string) =>
        (await app.getById({ projectId, dashboardId: target.dashboardId, viewer: TEAMMATE })).id;

      expect({
        home: [await listedIds(app, HOME, TEAMMATE), await opened(HOME)],
        sibling: [await listedIds(app, SIBLING, TEAMMATE), await opened(SIBLING)],
      }).toEqual({
        home: [[target.dashboardId], target.dashboardId],
        sibling: [[target.dashboardId], target.dashboardId],
      });
    });
  });

  describe("given an Organization board and the projects of its organization", () => {
    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("lists the organization's projects the reader can open, by name, and names the owner", async () => {
      const { app, target } = await boardAt("ORGANIZATION");

      const projects = await app.listDashboardScopeProjects({
        projectId: SIBLING,
        dashboardId: target.dashboardId,
        viewer: TEAMMATE,
      });

      expect(projects).toEqual({
        ownerProject: { id: HOME, name: `Project ${HOME}`, slug: `slug-${HOME}` },
        projects: [
          { id: HOME, name: `Project ${HOME}`, slug: `slug-${HOME}` },
          { id: SIBLING, name: `Project ${SIBLING}`, slug: `slug-${SIBLING}` },
        ],
      });
    });

    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("leaves out a project the reader cannot open, and still names the owner", async () => {
      const { app } = appWith({ openProjectIds: [SIBLING] });
      const shared = await app.create({
        projectId: HOME,
        name: "Reports",
        createdById: AUTHOR.userId,
      });
      await app.setDashboardScope({
        projectId: HOME,
        dashboardId: shared.id,
        viewer: AUTHOR,
        scope: "ORGANIZATION",
      });

      const projects = await app.listDashboardScopeProjects({
        projectId: SIBLING,
        dashboardId: shared.id,
        viewer: TEAMMATE,
      });

      expect({
        owner: projects.ownerProject.id,
        open: projects.projects.map(({ id }) => id),
      }).toEqual({ owner: HOME, open: [SIBLING] });
    });

    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("has no such list for a Project or an Only me board", async () => {
      const project = await boardAt("PROJECT");
      const own = await boardAt("PRIVATE");
      const asked = ({ app, target }: typeof project) =>
        codeOf(
          app.listDashboardScopeProjects({
            projectId: HOME,
            dashboardId: target.dashboardId,
            viewer: AUTHOR,
          }),
        );

      expect([await asked(project), await asked(own)]).toEqual([
        "dashboard_not_found",
        "dashboard_not_found",
      ]);
    });
  });
});
