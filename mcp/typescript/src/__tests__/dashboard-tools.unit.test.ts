/**
 * The dashboard client over /api/v1/dashboards and the dashboard tools.
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
} from "../langwatch-api-dashboards.js";
import {
  handleCreateDashboard,
  handleDeleteDashboard,
  handleDeleteDashboardWidget,
  handleGetDashboard,
  handleListDashboardWidgets,
  handleRenameDashboard,
} from "../tools/dashboards.js";

const ENDPOINT = "https://app.example.com";
const dashboard = {
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

function stubFetch({ answer = () => dashboard }: { answer?: (call: Call) => unknown } = {}) {
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

describe("given the dashboard client", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("calls /api/v1/dashboards with no project id in the path, with each verb and body", async () => {
    const calls = stubFetch({ answer: ({ method }) => (method === "DELETE" ? null : dashboard) });

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

describe("given the dashboard tools", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("creates, renames and deletes a dashboard, naming it in the answer", async () => {
    stubFetch({
      answer: ({ method }) =>
        method === "DELETE" ? { id: "b_1", name: "Usage" } : { ...dashboard, name: "Usage" },
    });

    const created = await handleCreateDashboard({ name: "Usage" });
    const renamed = await handleRenameDashboard({ dashboardId: "b_1", name: "Usage" });
    const deleted = await handleDeleteDashboard({ dashboardId: "b_1" });

    expect(created).toContain("**ID**: b_1");
    expect(renamed).toContain("Dashboard updated.");
    expect(deleted).toContain('Dashboard "Usage" deleted');
  });

  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("reads a dashboard by its dashboardId, naming its id and link", async () => {
    const calls = stubFetch();

    const read = await handleGetDashboard({ dashboardId: "b_1" });

    expect(read).toContain("# Usage");
    expect(read).toContain("**ID**: b_1");
    expect(read).toContain(dashboard.platformUrl);
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /api/v1/dashboards/b_1",
    ]);
  });

  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("refuses a rename naming nothing without calling the API", async () => {
    const calls = stubFetch();

    await expect(handleRenameDashboard({ dashboardId: "b_1" })).rejects.toThrow(/at least one/);
    expect(calls).toEqual([]);
  });

  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("lists a dashboard's widgets and deletes one under that dashboard", async () => {
    const calls = stubFetch({
      answer: ({ method }) => (method === "DELETE" ? null : { data: [widget] }),
    });

    const listed = await handleListDashboardWidgets({ dashboardId: "b_1" });
    const deleted = await handleDeleteDashboardWidget({ dashboardId: "b_1", widgetId: "w_1" });

    expect(listed).toContain("**ID**: w_1");
    expect(deleted).toContain('Widget "w_1" deleted from dashboard "b_1"');
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /api/v1/dashboards/b_1/widgets",
      "DELETE /api/v1/dashboards/b_1/widgets/w_1",
    ]);
  });
});
