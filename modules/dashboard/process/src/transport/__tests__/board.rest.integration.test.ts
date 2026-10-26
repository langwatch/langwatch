/**
 * `/api/v1/boards` and the routes it supersedes, over the real dashboard application and memory
 * repositories. The project comes from the key; `release_dashboards` is read per request.
 * @see modules/dashboard/specs/dashboards-v2.feature
 * @see specs/analytics/dashboard-rest-api.feature
 * @vitest-environment node
 */
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import type { Actor } from "@langwatch/authorization";
import { MY_DASHBOARD_NAME, type DashboardApi } from "@langwatch/dashboard-contract";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { boardProjectRest } from "../board-project.rest.ts";
import { boardRest, boardWidgetCaller, dashboardsReleased } from "../board.rest.ts";
import {
  dashboardWidgetCallerSource,
  dashboardWidgetRest,
  dashboardWidgetUrl,
} from "../dashboard-widget.rest.ts";
import { dashboardRest } from "../dashboard.rest.ts";

const PROJECT = "project-1";
const BASE = "https://app.langwatch.test";
const API_KEY: Actor = { type: "api_key", id: "key-of-project-1" };
const MEMBER = { type: "user", id: "user-1" } as const satisfies Actor;
const CODE = "export default () => null;";

async function projectWithBothBoards({
  actor = API_KEY,
  released = true,
}: { actor?: Actor; released?: boolean } = {}) {
  const caller = { actor, scope: { tier: "project" as const, id: PROJECT } };
  const app = createDashboardTestApp({ publicBaseUrl: BASE });
  const reports = await app.create({ projectId: PROJECT, name: "Reports" });
  const board = await app.createBoard({ projectId: PROJECT, name: "Usage" });
  const widget = await app.createDashboardWidget({
    projectId: PROJECT,
    dashboardId: board.id,
    name: "Traces",
    code: CODE,
    queries: [],
  });
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => caller,
      identify: () => caller,
    },
  });
  const mount = (router: RestTransportDeclaration<DashboardApi>) =>
    runtime.mount(router, {
      app: () => app,
      middlewareContext: [
        bindMiddlewareContext(dashboardWidgetUrl, () => `${BASE}/dashboards`),
        bindMiddlewareContext(dashboardWidgetCallerSource, () => ({ kind: "api" as const })),
        bindMiddlewareContext(dashboardsReleased, () => released),
        bindMiddlewareContext(boardWidgetCaller, () => ({
          platformUrl: `${BASE}/dashboards`,
          source: { kind: "api" as const },
        })),
      ],
      onError: canonicalErrorResponse,
    });
  const doors = {
    boards: mount(boardRest.router()),
    projectBoards: mount(boardProjectRest.router()),
    widgets: mount(dashboardWidgetRest.router()),
    dashboards: mount(dashboardRest.router()),
  };

  const send = async (
    door: keyof typeof doors,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) => {
    const response = await doors[door].fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { "content-type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      json: text === "" ? undefined : JSON.parse(text),
    };
  };

  return { app, reports, board, widget, send };
}

const BOARDS = "/api/v1/boards";
const PROJECT_BOARDS = `/api/v1/projects/${PROJECT}/analytics/boards`;
const ids = (json: { data?: { id: string }[] } | undefined) => json?.data?.map(({ id }) => id);
const refusal = (answer: { status: number; json?: { code?: string } }) => ({
  status: answer.status,
  code: answer.json?.code,
});

describe("given a Reports board and a Dashboards board holding a widget", () => {
  describe("when an API key lists and reads /api/v1/boards", () => {
    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("lists only the Dashboards board, with its widget count and address", async () => {
      const { board, send } = await projectWithBothBoards();

      const listed = await send("boards", BOARDS);

      expect(listed).toMatchObject({
        status: 200,
        json: {
          data: [
            {
              id: board.id,
              name: "Usage",
              description: null,
              scope: "PROJECT",
              createdById: null,
              widgetCount: 1,
              platformUrl: `${BASE}/project-one/dashboards/${board.id}`,
            },
          ],
        },
      });
      expect(listed.json.data).toHaveLength(1);
    });

    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("reads the Dashboards board and answers the Reports board's id as not found", async () => {
      const { reports, board, send } = await projectWithBothBoards();

      const [read, refused] = await Promise.all([
        send("boards", `${BOARDS}/${board.id}`),
        send("boards", `${BOARDS}/${reports.id}`),
      ]);

      expect({
        read: { status: read.status, id: read.json?.id },
        refused: refusal(refused),
      }).toEqual({
        read: { status: 200, id: board.id },
        refused: { status: 404, code: "dashboard_not_found" },
      });
    });

    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("keeps /api/v1/dashboards on the Reports board alone", async () => {
      const { reports, send } = await projectWithBothBoards();

      const listed = await send("dashboards", "/api/v1/dashboards");

      expect(ids(listed.json)).toEqual([reports.id]);
    });
  });

  describe("when the key creates a widget under either board", () => {
    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("places it on the Dashboards board and answers the Reports board as not found", async () => {
      const { reports, board, send } = await projectWithBothBoards();
      const createOn = (boardId: string) =>
        send("boards", `${BOARDS}/${boardId}/widgets`, {
          method: "POST",
          body: { name: "Spans", code: CODE, queries: [] },
        });

      const refused = await createOn(reports.id);
      const placed = await createOn(board.id);

      expect({
        refused: refusal(refused),
        placed: { status: placed.status, dashboardId: placed.json?.dashboardId },
      }).toEqual({
        refused: { status: 404, code: "dashboard_not_found" },
        placed: { status: 201, dashboardId: board.id },
      });
    });
  });

  describe("when an API key creates, renames and deletes a board", () => {
    /** @scenario "AC199n Split: the public API creates, renames and deletes Dashboards boards" */
    it("answers 201 with the board, lists it with no widgets and renames it", async () => {
      const { send } = await projectWithBothBoards();

      const created = await send("boards", BOARDS, { method: "POST", body: { name: "Fresh" } });
      const boardId = created.json?.id;
      const listed = await send("boards", BOARDS);
      const renamed = await send("boards", `${BOARDS}/${boardId}`, {
        method: "PATCH",
        body: { name: "Renamed", description: "Weekly" },
      });

      expect({
        created: {
          status: created.status,
          name: created.json?.name,
          createdById: created.json?.createdById,
        },
        listed: listed.json?.data?.find(({ id }: { id: string }) => id === boardId),
        renamed: {
          status: renamed.status,
          name: renamed.json?.name,
          description: renamed.json?.description,
        },
      }).toEqual({
        created: { status: 201, name: "Fresh", createdById: null },
        listed: expect.objectContaining({ id: boardId, name: "Fresh", widgetCount: 0 }),
        renamed: { status: 200, name: "Renamed", description: "Weekly" },
      });
    });

    /** @scenario "AC199n Split: the public API creates, renames and deletes Dashboards boards" */
    it("refuses a rename naming nothing", async () => {
      const { board, send } = await projectWithBothBoards();

      const refused = await send("boards", `${BOARDS}/${board.id}`, { method: "PATCH", body: {} });

      expect(refused.status).toBe(422);
    });

    /** @scenario "AC199n Split: the public API creates, renames and deletes Dashboards boards" */
    it("deletes it with its widgets, then answers it as not found", async () => {
      const { board, send } = await projectWithBothBoards();
      const path = `${BOARDS}/${board.id}`;

      const deleted = await send("boards", path, { method: "DELETE" });
      const read = await send("boards", path);
      const deletedAgain = await send("boards", path, { method: "DELETE" });
      const widgets = await send(
        "widgets",
        `/api/v1/projects/${PROJECT}/analytics/dashboard-widgets`,
      );

      expect({
        deleted: deleted.status,
        body: deleted.json,
        read: read.status,
        deletedAgain: refusal(deletedAgain),
        widgetIds: ids(widgets.json),
      }).toEqual({
        deleted: 200,
        body: { id: board.id, name: "Usage" },
        read: 404,
        deletedAgain: { status: 404, code: "dashboard_not_found" },
        widgetIds: [],
      });
    });

    /** @scenario "AC199n Split: the public API creates, renames and deletes Dashboards boards" */
    it("answers a Reports board, another project's board and a member's Only me board as not found", async () => {
      const { app, reports, send } = await projectWithBothBoards();
      const foreign = await app.createBoard({ projectId: "project-2", name: "Theirs" });
      const viewer = { userId: "user-2" };
      const mine = await app.createBoard({
        projectId: PROJECT,
        name: "Private",
        createdById: viewer.userId,
      });
      await app.setDashboardScope({
        projectId: PROJECT,
        dashboardId: mine.id,
        scope: "PRIVATE",
        viewer,
      });

      const refused = await Promise.all(
        [reports.id, foreign.id, mine.id].map((id) =>
          send("boards", `${BOARDS}/${id}`, { method: "DELETE" }),
        ),
      );
      const reportsBoards = await send("dashboards", "/api/v1/dashboards");

      expect(refused.map(refusal)).toEqual([
        { status: 404, code: "dashboard_not_found" },
        { status: 404, code: "dashboard_not_found" },
        { status: 404, code: "dashboard_not_found" },
      ]);
      expect(ids(reportsBoards.json)).toContain(reports.id);
    });
  });

  describe("when a member creates their own My dashboard", () => {
    /** @scenario "AC199o Split: a member's REST create follows the board scope rules" */
    it("records them as its author, at Only me, starred for them", async () => {
      const { app, send } = await projectWithBothBoards({ actor: MEMBER });

      const created = await send("boards", BOARDS, {
        method: "POST",
        body: { name: MY_DASHBOARD_NAME },
      });
      const starred = await app.listStarred({ projectId: PROJECT, userId: MEMBER.id });

      expect({
        status: created.status,
        createdById: created.json?.createdById,
        scope: created.json?.scope,
        starred: starred.map((star) => (star.kind === "board" ? star.dashboard.id : null)),
      }).toEqual({
        status: 201,
        createdById: MEMBER.id,
        scope: "PRIVATE",
        starred: [created.json?.id],
      });
    });
  });
});

describe("given two Dashboards boards, one holding a widget", () => {
  async function twoBoards() {
    const setup = await projectWithBothBoards();
    const other = await setup.app.createBoard({ projectId: PROJECT, name: "Other" });
    return { ...setup, other };
  }

  /** @scenario "AC199p Split: a board's widgets are a sub-resource of the board" */
  it("lists only the widgets on the board named in the path", async () => {
    const { board, other, widget, send } = await twoBoards();

    const [onBoard, onOther] = await Promise.all([
      send("boards", `${BOARDS}/${board.id}/widgets`),
      send("boards", `${BOARDS}/${other.id}/widgets`),
    ]);

    expect({ onBoard: ids(onBoard.json), onOther: ids(onOther.json) }).toEqual({
      onBoard: [widget.id],
      onOther: [],
    });
  });

  /** @scenario "AC199p Split: a board's widgets are a sub-resource of the board" */
  it("creates, reads, updates and deletes a widget under its own board", async () => {
    const { other, send } = await twoBoards();
    const widgets = `${BOARDS}/${other.id}/widgets`;

    const created = await send("boards", widgets, {
      method: "POST",
      body: { name: "Latency", code: CODE, queries: [] },
    });
    const path = `${widgets}/${created.json?.id}`;
    const read = await send("boards", path);
    const updated = await send("boards", path, { method: "PATCH", body: { name: "P95" } });
    const deleted = await send("boards", path, { method: "DELETE" });
    const after = await send("boards", path);

    expect({
      created: {
        status: created.status,
        dashboardId: created.json?.dashboardId,
        source: created.json?.definition?.source,
      },
      read: read.status,
      updated: { status: updated.status, name: updated.json?.name },
      deleted: deleted.status,
      after: refusal(after),
    }).toEqual({
      created: { status: 201, dashboardId: other.id, source: { kind: "api" } },
      read: 200,
      updated: { status: 200, name: "P95" },
      deleted: 204,
      after: { status: 404, code: "dashboard_widget_not_found" },
    });
  });

  /** @scenario "AC199p Split: a board's widgets are a sub-resource of the board" */
  it("answers a widget reached through another board's path as not found, and leaves it", async () => {
    const { board, other, widget, send } = await twoBoards();
    const wrong = `${BOARDS}/${other.id}/widgets/${widget.id}`;

    const answers = await Promise.all([
      send("boards", wrong),
      send("boards", wrong, { method: "PATCH", body: { name: "Moved" } }),
      send("boards", wrong, { method: "DELETE" }),
    ]);
    const still = await send("boards", `${BOARDS}/${board.id}/widgets/${widget.id}`);

    expect(answers.map(refusal)).toEqual([
      { status: 404, code: "dashboard_widget_not_found" },
      { status: 404, code: "dashboard_widget_not_found" },
      { status: 404, code: "dashboard_widget_not_found" },
    ]);
    expect({ status: still.status, name: still.json?.name }).toEqual({
      status: 200,
      name: "Traces",
    });
  });

  /** @scenario "AC199p Split: a board's widgets are a sub-resource of the board" */
  it("refuses a widget created under another project's board or a missing board", async () => {
    const { app, send } = await twoBoards();
    const foreign = await app.createBoard({ projectId: "project-2", name: "Theirs" });

    const refused = await Promise.all(
      [foreign.id, "missing-board"].map((id) =>
        send("boards", `${BOARDS}/${id}/widgets`, {
          method: "POST",
          body: { name: "Nope", code: CODE, queries: [] },
        }),
      ),
    );

    expect(refused.map(refusal)).toEqual([
      { status: 404, code: "dashboard_not_found" },
      { status: 404, code: "dashboard_not_found" },
    ]);
  });
});

describe("given Dashboards is switched off for the key's project", () => {
  /** @scenario "AC199q Split: /api/v1/boards is not there while Dashboards is off" */
  it("answers every /api/v1/boards route 404 and writes nothing", async () => {
    const { app, board, widget, send } = await projectWithBothBoards({ released: false });
    const widgetPath = `${BOARDS}/${board.id}/widgets/${widget.id}`;
    const body = { name: "Nope", code: CODE, queries: [] };

    const answers = await Promise.all([
      send("boards", BOARDS),
      send("boards", BOARDS, { method: "POST", body: { name: "Nope" } }),
      send("boards", `${BOARDS}/${board.id}`),
      send("boards", `${BOARDS}/${board.id}`, { method: "PATCH", body: { name: "Nope" } }),
      send("boards", `${BOARDS}/${board.id}`, { method: "DELETE" }),
      send("boards", `${BOARDS}/${board.id}/widgets`),
      send("boards", `${BOARDS}/${board.id}/widgets`, { method: "POST", body }),
      send("boards", widgetPath),
      send("boards", widgetPath, { method: "PATCH", body: { name: "Nope" } }),
      send("boards", widgetPath, { method: "DELETE" }),
    ]);
    const boards = await app.findBoards({ projectId: PROJECT });
    const widgets = await app.listDashboardWidgets({ projectId: PROJECT });

    expect(answers.map(refusal)).toEqual(
      answers.map(() => ({ status: 404, code: "dashboards_not_released" })),
    );
    expect(answers).toHaveLength(10);
    expect({
      boards: boards.map(({ name }) => name),
      widgets: widgets.map(({ name }) => name),
    }).toEqual({ boards: ["Usage"], widgets: ["Traces"] });
  });
});

describe("given the routes /api/v1/boards supersedes", () => {
  const SUPERSEDED = [
    ["dashboards", "/api/v1/dashboards"],
    ["dashboards", "/api/dashboards"],
    ["projectBoards", PROJECT_BOARDS],
  ] as const;

  /**
   * @scenario "AC199r Split: the Reports boards API points to /api/v1/boards once Dashboards is on"
   * @scenario "The dashboards API is deprecated where Dashboards is switched on"
   */
  it("answers as before with Deprecation and Link headers, and no Sunset, while Dashboards is on", async () => {
    const { reports, board, send } = await projectWithBothBoards();

    const answers = await Promise.all(SUPERSEDED.map(([door, path]) => send(door, path)));

    expect(
      answers.map((answer) => ({
        status: answer.status,
        ids: ids(answer.json),
        deprecation: answer.headers.get("Deprecation"),
        link: answer.headers.get("Link"),
        sunset: answer.headers.get("Sunset"),
      })),
    ).toEqual(
      [[reports.id], [reports.id], [board.id]].map((listed) => ({
        status: 200,
        ids: listed,
        deprecation: "true",
        link: '</api/v1/boards>; rel="successor-version"',
        sunset: null,
      })),
    );
  });

  /**
   * @scenario "AC199r Split: the Reports boards API points to /api/v1/boards once Dashboards is on"
   * @scenario "The dashboards API is unchanged where Dashboards is switched off"
   */
  it("answers as before with no Deprecation or Link header while Dashboards is off", async () => {
    const { reports, send } = await projectWithBothBoards({ released: false });

    const answers = await Promise.all(SUPERSEDED.map(([door, path]) => send(door, path)));

    expect(
      answers.map((answer) => ({
        status: answer.status,
        deprecation: answer.headers.get("Deprecation"),
        link: answer.headers.get("Link"),
      })),
    ).toEqual(SUPERSEDED.map(() => ({ status: 200, deprecation: null, link: null })));
    expect(ids(answers[0]?.json)).toEqual([reports.id]);
  });
});
