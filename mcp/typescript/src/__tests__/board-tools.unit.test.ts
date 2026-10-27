/**
 * The board client over /api/v1/dashboards and the board tools.
 * Spec: modules/dashboard/specs/dashboards-v2.feature AC199s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initConfig } from "../config.ts";
import {
  createDashboard,
  createWidgetOnDashboard,
  deleteDashboard,
  deleteWidgetOnDashboard,
  getDashboard,
  getWidgetOnDashboard,
  listDashboards,
  listWidgetsOnDashboard,
  updateDashboard,
  updateWidgetOnDashboard,
} from "../langwatch-api-boards.js";
import {
  handleCreateDashboardBoard,
  handleDeleteDashboardBoard,
  handleDeleteDashboardWidget,
  handleListBoardWidgets,
  handleRenameDashboardBoard,
} from "../tools/dashboard-boards.js";

const ENDPOINT = "https://app.example.com";
const board = {
  id: "b_1",
  name: "Usage",
  description: null,
  scope: "PROJECT",
  createdById: null,
  createdAt: "2026-10-26T00:00:00Z",
  updatedAt: "2026-10-26T00:00:00Z",
  platformUrl: `${ENDPOINT}/p/dashboards/b_1`,
};
const widget = {
  id: "w_1",
  name: "Traces",
  definition: { version: 1, code: "x", queries: [{ name: "q", sql: "SELECT 1" }] },
  dashboardId: "b_1",
};

type Call = { method: string; url: string; body: unknown };

function stubFetch({ answer = () => board }: { answer?: (call: Call) => unknown } = {}) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    const call = {
      method: init.method ?? "GET",
      url: url.slice(ENDPOINT.length),
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    };
    calls.push(call);
    const payload = answer(call);
    return payload === null
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  initConfig({ apiKey: "test-key", endpoint: ENDPOINT });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("given the board client", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("calls /api/v1/dashboards with no project id in the path, with each verb and body", async () => {
    const calls = stubFetch({ answer: ({ method }) => (method === "DELETE" ? null : board) });

    await listDashboards();
    await getDashboard({ dashboardId: "b_1" });
    await createDashboard({ name: "Usage" });
    await updateDashboard({ dashboardId: "b_1", description: null });
    await deleteDashboard({ dashboardId: "b_1" });
    await listWidgetsOnDashboard({ dashboardId: "b_1" });
    await createWidgetOnDashboard({ dashboardId: "b_1", name: "Traces", code: "x", queries: [] });
    await getWidgetOnDashboard({ dashboardId: "b_1", widgetId: "w_1" });
    await updateWidgetOnDashboard({ dashboardId: "b_1", widgetId: "w_1", name: "P95" });
    await deleteWidgetOnDashboard({ dashboardId: "b_1", widgetId: "w_1" });

    expect(calls).toEqual([
      { method: "GET", url: "/api/v1/dashboards", body: undefined },
      { method: "GET", url: "/api/v1/dashboards/b_1", body: undefined },
      { method: "POST", url: "/api/v1/dashboards", body: { name: "Usage" } },
      { method: "PATCH", url: "/api/v1/dashboards/b_1", body: { description: null } },
      { method: "DELETE", url: "/api/v1/dashboards/b_1", body: undefined },
      { method: "GET", url: "/api/v1/dashboards/b_1/widgets", body: undefined },
      {
        method: "POST",
        url: "/api/v1/dashboards/b_1/widgets",
        body: { name: "Traces", code: "x", queries: [] },
      },
      { method: "GET", url: "/api/v1/dashboards/b_1/widgets/w_1", body: undefined },
      { method: "PATCH", url: "/api/v1/dashboards/b_1/widgets/w_1", body: { name: "P95" } },
      { method: "DELETE", url: "/api/v1/dashboards/b_1/widgets/w_1", body: undefined },
    ]);
  });
});

describe("given the board tools", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("creates, renames and deletes a board, naming it in the answer", async () => {
    stubFetch({
      answer: ({ method }) =>
        method === "DELETE" ? { id: "b_1", name: "Usage" } : { ...board, name: "Usage" },
    });

    const created = await handleCreateDashboardBoard({ name: "Usage" });
    const renamed = await handleRenameDashboardBoard({ boardId: "b_1", name: "Usage" });
    const deleted = await handleDeleteDashboardBoard({ boardId: "b_1" });

    expect(created).toContain("**ID**: b_1");
    expect(renamed).toContain("Board updated.");
    expect(deleted).toContain('Board "Usage" deleted');
  });

  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("refuses a rename naming nothing without calling the API", async () => {
    const calls = stubFetch();

    await expect(handleRenameDashboardBoard({ boardId: "b_1" })).rejects.toThrow(/at least one/);
    expect(calls).toEqual([]);
  });

  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("lists a board's widgets and deletes one under that board", async () => {
    const calls = stubFetch({
      answer: ({ method }) => (method === "DELETE" ? null : { data: [widget] }),
    });

    const listed = await handleListBoardWidgets({ boardId: "b_1" });
    const deleted = await handleDeleteDashboardWidget({ boardId: "b_1", widgetId: "w_1" });

    expect(listed).toContain("**ID**: w_1");
    expect(deleted).toContain('Widget "w_1" deleted from board "b_1"');
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /api/v1/dashboards/b_1/widgets",
      "DELETE /api/v1/dashboards/b_1/widgets/w_1",
    ]);
  });
});
