/**
 * The Dashboards boards REST family over the real dashboard application and memory repositories.
 * @see modules/dashboard/specs/dashboards-v2.feature
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
import { boardRest } from "../board.rest.ts";
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

async function projectWithBothBoards({ actor = API_KEY }: { actor?: Actor } = {}) {
  const caller = { actor, scope: { tier: "project" as const, id: PROJECT } };
  const app = createDashboardTestApp({ publicBaseUrl: BASE });
  const reports = await app.create({ projectId: PROJECT, name: "Reports" });
  const board = await app.createBoard({ projectId: PROJECT, name: "Usage" });
  const widget = await app.createDashboardWidget({
    projectId: PROJECT,
    dashboardId: board.id,
    name: "Traces",
    code: "export default () => null;",
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
      ],
      onError: canonicalErrorResponse,
    });
  const doors = {
    boards: mount(boardRest.router()),
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
    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };

  return { app, reports, board, widget, send };
}
const BOARDS = `/api/v1/projects/${PROJECT}/analytics/boards`;
const WIDGETS = `/api/v1/projects/${PROJECT}/analytics/dashboard-widgets`;

describe("given a Reports board and a Dashboards board holding a widget", () => {
  describe("when an API key lists and reads the Dashboards boards", () => {
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
              widgetCount: 1,
              platformUrl: `${BASE}/project-one/dashboards/${board.id}`,
            },
          ],
        },
      });
      expect(listed.json.data).toHaveLength(1);
      expect(listed.json.data[0].createdById).toBeNull();
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
        refused: { status: refused.status, code: refused.json?.code },
      }).toEqual({
        read: { status: 200, id: board.id },
        refused: { status: 404, code: "dashboard_not_found" },
      });
    });

    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("keeps /api/v1/dashboards on the Reports board alone", async () => {
      const { reports, send } = await projectWithBothBoards();

      const listed = await send("dashboards", "/api/v1/dashboards");

      expect(listed.json?.data?.map(({ id }: { id: string }) => id)).toEqual([reports.id]);
    });
  });

  describe("when the key adds a widget to either board", () => {
    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("places it on the Dashboards board and answers the Reports board as not found", async () => {
      const { reports, board, widget, send } = await projectWithBothBoards();
      const addTo = (dashboardId: string) =>
        send("widgets", `${WIDGETS}/${widget.id}/dashboard`, {
          method: "POST",
          body: { dashboardId },
        });

      const refused = await addTo(reports.id);
      const placed = await addTo(board.id);

      expect({
        refused: { status: refused.status, code: refused.json?.code },
        placed: { status: placed.status, dashboardId: placed.json?.dashboardId },
      }).toEqual({
        refused: { status: 404, code: "dashboard_not_found" },
        placed: { status: 200, dashboardId: board.id },
      });
    });
  });

  describe("when an API key creates a Dashboards board", () => {
    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("answers 201 with the board, lists it and takes a widget on it", async () => {
      const { widget, send } = await projectWithBothBoards();

      const created = await send("boards", BOARDS, { method: "POST", body: { name: "Fresh" } });
      const boardId = created.json?.id;
      const listed = await send("boards", BOARDS);
      const placed = await send("widgets", `${WIDGETS}/${widget.id}/dashboard`, {
        method: "POST",
        body: { dashboardId: boardId },
      });

      expect({
        created: {
          status: created.status,
          name: created.json?.name,
          createdById: created.json?.createdById,
        },
        listed: listed.json?.data?.find(({ id }: { id: string }) => id === boardId),
        placed: { status: placed.status, dashboardId: placed.json?.dashboardId },
      }).toEqual({
        created: { status: 201, name: "Fresh", createdById: null },
        listed: expect.objectContaining({ id: boardId, name: "Fresh", widgetCount: 0 }),
        placed: { status: 200, dashboardId: boardId },
      });
    });

    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("deletes it, then answers it as not found", async () => {
      const { send } = await projectWithBothBoards();
      const created = await send("boards", BOARDS, { method: "POST", body: { name: "Gone" } });

      const deleted = await send("boards", `${BOARDS}/${created.json?.id}`, { method: "DELETE" });
      const read = await send("boards", `${BOARDS}/${created.json?.id}`);

      expect({ deleted: deleted.status, body: deleted.json, read: read.status }).toEqual({
        deleted: 200,
        body: { id: created.json?.id, name: "Gone" },
        read: 404,
      });
    });
  });

  describe("when a member creates their own My dashboard", () => {
    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
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
