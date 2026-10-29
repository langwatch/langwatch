import { beforeEach, describe, expect, it, vi } from "vitest";
/**
 * Digests of the add_dashboard_widget and update_dashboard_widget tools.
 */
import { z } from "zod";

vi.mock("../langwatch-api-dashboards.js", () => ({
  createWidgetOnDashboard: vi.fn(),
  getWidgetOnDashboard: vi.fn(),
  listDashboards: vi.fn(),
  updateWidgetOnDashboard: vi.fn(),
}));

import {
  createWidgetOnDashboard,
  getWidgetOnDashboard,
  listDashboards,
  updateWidgetOnDashboard,
} from "../langwatch-api-dashboards.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { widgetProjectsInput, runQueryProjectsInput } from "../schemas/widget-sources.ts";
import { handleAddDashboardWidget } from "../tools/add-dashboard-widget.js";
import { handleListDashboards } from "../tools/list-dashboards.js";
import { handleUpdateDashboardWidget } from "../tools/update-dashboard-widget.js";

const mockListDashboards = vi.mocked(listDashboards);
const mockCreateWidgetOnDashboard = vi.mocked(createWidgetOnDashboard);
const mockGetWidgetOnDashboard = vi.mocked(getWidgetOnDashboard);
const mockUpdateWidgetOnDashboard = vi.mocked(updateWidgetOnDashboard);

const notFound = () => new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}");

const sampleWidget = {
  id: "widget_1",
  name: "p95 latency",
  definition: { version: 1, code: "export default () => null;", queries: [] },
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/proj/agent-testing/analytics/reports",
  dashboardId: null,
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 4,
};

const sampleDashboard = {
  id: "dash_1",
  name: "Agent health",
  description: null,
  scope: "PROJECT" as const,
  createdById: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/my-project/dashboards/dash_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateWidgetOnDashboard.mockResolvedValue({ ...sampleWidget, dashboardId: "dash_1" });
});

describe("handleAddDashboardWidget()", () => {
  describe("when the dashboard exists and creation succeeds", () => {
    /** @scenario "AC8 An MCP agent adds a widget to a board" */
    /** @scenario "AC199t The MCP widget tools use only the board routes" */
    it("creates the widget under the dashboard's own path, which places it", async () => {
      const result = await handleAddDashboardWidget({
        dashboardId: "dash_1",
        name: "p95 latency",
        code: "export default () => null;",
        queries: { latency: "SELECT quantile(0.95)(duration) FROM traces" },
      });

      expect(mockCreateWidgetOnDashboard).toHaveBeenCalledTimes(1);
      expect(mockCreateWidgetOnDashboard).toHaveBeenCalledWith({
        dashboardId: "dash_1",
        name: "p95 latency",
        code: "export default () => null;",
        queries: [{ name: "latency", sql: "SELECT quantile(0.95)(duration) FROM traces" }],
      });
      expect(result).toContain("widget_1");
      expect(result).toContain("dash_1");
      expect(result).toContain("latency");
    });

    it("accepts the array form of queries", async () => {
      await handleAddDashboardWidget({
        dashboardId: "dash_1",
        name: "p95 latency",
        code: "export default () => null;",
        queries: [{ name: "latency", sql: "SELECT 1" }],
      });

      expect(mockCreateWidgetOnDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          queries: [{ name: "latency", sql: "SELECT 1" }],
        }),
      );
    });
  });

  describe("when the dashboard does not exist", () => {
    beforeEach(() => {
      mockCreateWidgetOnDashboard.mockRejectedValue(notFound());
    });

    /** @scenario "AC8b add_dashboard_widget rejects an unknown dashboard" */
    it("names the dashboard id in the error, after the one create the server refused", async () => {
      await expect(
        handleAddDashboardWidget({
          dashboardId: "dash_missing",
          name: "p95 latency",
          code: "export default () => null;",
          queries: { latency: "SELECT 1" },
        }),
      ).rejects.toThrow(/dash_missing/);

      expect(mockCreateWidgetOnDashboard).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the create call fails", () => {
    it("propagates the server's error message", async () => {
      mockCreateWidgetOnDashboard.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 400: code is too long", 400, "{}"),
      );

      await expect(
        handleAddDashboardWidget({
          dashboardId: "dash_1",
          name: "p95 latency",
          code: "export default () => null;",
          queries: { latency: "SELECT 1" },
        }),
      ).rejects.toThrow(/code is too long/);
    });
  });

  describe("when the queries are empty or too many", () => {
    it("rejects an empty query map without calling the API", async () => {
      await expect(
        handleAddDashboardWidget({
          dashboardId: "dash_1",
          name: "p95 latency",
          code: "export default () => null;",
          queries: {},
        }),
      ).rejects.toThrow(/at least one/i);

      expect(mockCreateWidgetOnDashboard).not.toHaveBeenCalled();
    });

    it("rejects more than 8 queries without calling the API", async () => {
      const queries = Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`q${i}`, "SELECT 1"]),
      );

      await expect(
        handleAddDashboardWidget({
          dashboardId: "dash_1",
          name: "p95 latency",
          code: "export default () => null;",
          queries,
        }),
      ).rejects.toThrow(/at most 8/);

      expect(mockCreateWidgetOnDashboard).not.toHaveBeenCalled();
    });
  });
});

describe("handleUpdateDashboardWidget()", () => {
  const placedWidget = { ...sampleWidget, dashboardId: "dash_1" };

  beforeEach(() => {
    mockGetWidgetOnDashboard.mockResolvedValue(placedWidget);
    mockUpdateWidgetOnDashboard.mockResolvedValue({
      ...placedWidget,
      name: "Errors per day",
      definition: {
        version: 1,
        code: "export default () => <div />;",
        queries: [{ name: "errors", sql: "SELECT 1" }],
        source: { kind: "api" },
      },
    });
  });

  describe("when the widget is on the named dashboard", () => {
    /** @scenario "An MCP agent updates a widget's name and code" */
    /** @scenario "AC199t The MCP widget tools use only the board routes" */
    it("sends only the given fields and returns the updated widget", async () => {
      const result = await handleUpdateDashboardWidget({
        dashboardId: "dash_1",
        widgetId: "widget_1",
        name: "Errors per day",
        code: "export default () => <div />;",
      });

      expect(mockGetWidgetOnDashboard).toHaveBeenCalledWith({
        dashboardId: "dash_1",
        widgetId: "widget_1",
      });
      expect(mockUpdateWidgetOnDashboard).toHaveBeenCalledWith({
        dashboardId: "dash_1",
        widgetId: "widget_1",
        name: "Errors per day",
        code: "export default () => <div />;",
      });
      expect(result).toContain("Errors per day");
      expect(result).toContain("widget_1");
      expect(result).toContain('"kind": "api"');
    });

    it("sends queries in the array shape and a description", async () => {
      await handleUpdateDashboardWidget({
        dashboardId: "dash_1",
        widgetId: "widget_1",
        queries: { errors: "SELECT 1" },
        description: "Errors per day",
      });

      expect(mockUpdateWidgetOnDashboard).toHaveBeenCalledWith({
        dashboardId: "dash_1",
        widgetId: "widget_1",
        queries: [{ name: "errors", sql: "SELECT 1" }],
        description: "Errors per day",
      });
    });
  });

  describe("when the widget does not exist", () => {
    beforeEach(() => {
      mockGetWidgetOnDashboard.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}"),
      );
    });

    /** @scenario "update_dashboard_widget rejects an unknown widget" */
    it("names the widget id in the error and changes nothing", async () => {
      await expect(
        handleUpdateDashboardWidget({
          dashboardId: "dash_1",
          widgetId: "widget_missing",
          name: "Errors per day",
        }),
      ).rejects.toThrow(/widget_missing/);

      expect(mockUpdateWidgetOnDashboard).not.toHaveBeenCalled();
    });
  });

  describe("when the widget is on another dashboard", () => {
    it("names both ids and changes nothing, as the dashboard route answers 404", async () => {
      mockGetWidgetOnDashboard.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}"),
      );

      await expect(
        handleUpdateDashboardWidget({
          dashboardId: "dash_1",
          widgetId: "widget_1",
          name: "Errors per day",
        }),
      ).rejects.toThrow(/widget_1.*dash_1/);

      expect(mockUpdateWidgetOnDashboard).not.toHaveBeenCalled();
    });
  });

  describe("when the dashboard does not exist", () => {
    beforeEach(() => {
      mockGetWidgetOnDashboard.mockRejectedValue(notFound());
    });

    /** @scenario "update_dashboard_widget rejects an unknown dashboard" */
    it("names the dashboard id in the error and changes nothing", async () => {
      await expect(
        handleUpdateDashboardWidget({
          dashboardId: "dash_missing",
          widgetId: "widget_1",
          name: "Errors per day",
        }),
      ).rejects.toThrow(/dash_missing/);

      expect(mockUpdateWidgetOnDashboard).not.toHaveBeenCalled();
    });
  });

  describe("when no field to change is given", () => {
    it("refuses without calling the API", async () => {
      await expect(
        handleUpdateDashboardWidget({ dashboardId: "dash_1", widgetId: "widget_1" }),
      ).rejects.toThrow(/at least one/i);

      expect(mockGetWidgetOnDashboard).not.toHaveBeenCalled();
      expect(mockUpdateWidgetOnDashboard).not.toHaveBeenCalled();
    });
  });
});

describe("handleListDashboards()", () => {
  describe("when the project has dashboards", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
    it("lists them from /api/v1/dashboards, each with the id the widget tools take", async () => {
      mockListDashboards.mockResolvedValue({ data: [{ ...sampleDashboard, widgetCount: 3 }] });

      const result = await handleListDashboards();

      expect(mockListDashboards).toHaveBeenCalledWith();
      expect(result).toContain("Agent health");
      expect(result).toContain("**ID**: dash_1");
      expect(result).toContain("**Widgets**: 3");
    });
  });

  describe("when /api/v1/dashboards fails", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
    it.each([404, 500])("reports a %i as it is and asks nothing else", async (status) => {
      const failure = new LangWatchApiError("Failed", status, "{}");
      mockListDashboards.mockRejectedValue(failure);

      await expect(handleListDashboards()).rejects.toBe(failure);
      expect(mockListDashboards).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the project has none", () => {
    it("says so", async () => {
      mockListDashboards.mockResolvedValue({ data: [] });

      expect(await handleListDashboards()).toMatch(/No dashboards found/);
    });
  });
});

describe("a widget's sources through the MCP widget tools", () => {
  const QUERY = { name: "turns", sql: "SELECT count() FROM traces" };

  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("creates a widget whose every query counts the sources the agent names", async () => {
    await handleAddDashboardWidget({
      dashboardId: "dash_1",
      name: "Langy requests",
      code: "export default () => null;",
      queries: { turns: QUERY.sql },
      sources: ["langy"],
    });

    expect(mockCreateWidgetOnDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ queries: [{ ...QUERY, sources: ["langy"] }] }),
    );
  });

  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("updates only the sources, sending the stored queries back with the new list", async () => {
    mockGetWidgetOnDashboard.mockResolvedValue({
      ...sampleWidget,
      dashboardId: "dash_1",
      definition: { ...sampleWidget.definition, queries: [QUERY] },
    });
    mockUpdateWidgetOnDashboard.mockResolvedValue({ ...sampleWidget, dashboardId: "dash_1" });

    await handleUpdateDashboardWidget({
      dashboardId: "dash_1",
      widgetId: "widget_1",
      sources: ["application", "langy"],
    });

    expect(mockUpdateWidgetOnDashboard).toHaveBeenCalledWith({
      dashboardId: "dash_1",
      widgetId: "widget_1",
      queries: [{ ...QUERY, sources: ["application", "langy"] }],
    });
  });

  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("clears the list with null, so each query counts the default again", async () => {
    mockGetWidgetOnDashboard.mockResolvedValue({
      ...sampleWidget,
      dashboardId: "dash_1",
      definition: { ...sampleWidget.definition, queries: [{ ...QUERY, sources: ["langy"] }] },
    });
    mockUpdateWidgetOnDashboard.mockResolvedValue({ ...sampleWidget, dashboardId: "dash_1" });

    await handleUpdateDashboardWidget({
      dashboardId: "dash_1",
      widgetId: "widget_1",
      sources: null,
    });

    expect(mockUpdateWidgetOnDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ queries: [{ ...QUERY, sources: null }] }),
    );
  });

  /** @scenario "AC200n Sources: an unknown source is refused at every door" */
  it("refuses an unknown source at both tools' input, and takes every listed one", async () => {
    const { createMcpServer } = await import("../create-mcp-server.ts");
    const tools = (
      createMcpServer() as unknown as {
        _registeredTools: Record<string, { inputSchema: { parse(value: unknown): unknown } }>;
      }
    )._registeredTools;
    const add = { dashboardId: "d", name: "n", code: "c", queries: { q: "SELECT 1" } };
    const update = { dashboardId: "d", widgetId: "w" };
    const parse = (tool: string, input: object) => () => tools[tool]?.inputSchema.parse(input);

    expect(parse("add_dashboard_widget", { ...add, sources: ["Langy"] })).toThrow(/sources/);
    expect(parse("update_dashboard_widget", { ...update, sources: ["langy') OR 1"] })).toThrow(
      /sources/,
    );
    expect(parse("add_dashboard_widget", { ...add, sources: ["langy", "other"] })).not.toThrow();
    expect(parse("update_dashboard_widget", { ...update, sources: null })).not.toThrow();
  });
});

describe("a widget's projects through the MCP widget tools", () => {
  const QUERY = { name: "turns", sql: "SELECT count() FROM traces" };

  /** @scenario "AC210b Compatibility: the dashboard API, the CLI and the MCP tools read and write projects beside sources" */
  it("creates a widget whose every query reads the projects the agent names", async () => {
    await handleAddDashboardWidget({
      dashboardId: "dash_1",
      name: "Two projects",
      code: "export default () => null;",
      queries: { turns: QUERY.sql },
      projects: ["A", "B"],
    });

    expect(mockCreateWidgetOnDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ queries: [{ ...QUERY, projects: ["A", "B"] }] }),
    );
  });

  /** @scenario "AC210b Compatibility: the dashboard API, the CLI and the MCP tools read and write projects beside sources" */
  it("clears the projects with null, sending the stored queries back", async () => {
    mockGetWidgetOnDashboard.mockResolvedValue({
      ...sampleWidget,
      dashboardId: "dash_1",
      definition: { ...sampleWidget.definition, queries: [{ ...QUERY, projects: ["A"] }] },
    });
    mockUpdateWidgetOnDashboard.mockResolvedValue({ ...sampleWidget, dashboardId: "dash_1" });

    await handleUpdateDashboardWidget({
      dashboardId: "dash_1",
      widgetId: "widget_1",
      projects: null,
    });

    expect(mockUpdateWidgetOnDashboard).toHaveBeenCalledWith({
      dashboardId: "dash_1",
      widgetId: "widget_1",
      queries: [{ ...QUERY, projects: null }],
    });
  });
});

describe('given a widget tool is sent projects "all"', () => {
  /** @scenario "QP03i A widget write refuses the word all" */
  it("says a widget stores project ids, in the words REST gives", () => {
    const refused = widgetProjectsInput.safeParse("all");

    expect(refused.error?.issues[0]?.message).toBe(
      'projects holds project ids; "all" is not stored in a widget',
    );
  });

  it.each([["all"], ["ALL"], ["All"], [" all "]])(
    "refuses the string %s with the same message",
    (word) => {
      const refused = widgetProjectsInput.safeParse(word);

      expect(refused.error?.issues[0]?.message).toBe(
        'projects holds project ids; "all" is not stored in a widget',
      );
    },
  );

  it.each([["all"], ["ALL"], [" All "]])(
    "refuses %s inside the list with the same message",
    (word) => {
      const refused = widgetProjectsInput.safeParse(["proj_1", word]);

      expect(refused.error?.issues[0]?.message).toBe(
        'projects holds project ids; "all" is not stored in a widget',
      );
    },
  );

  it("does not advertise all in the tool's JSON Schema", () => {
    expect(JSON.stringify(z.toJSONSchema(widgetProjectsInput))).not.toContain("all");
  });
});

describe("given run_query's projects input", () => {
  it.each([["all"], ["ALL"], [" All "], [["A", "B"]]])("accepts %s", (value) => {
    expect(runQueryProjectsInput.validate(value)).toBe(true);
  });

  it.each([["everything"], [[]], [[""]], [["p", "ALL"]]])("refuses %s", (value) => {
    expect(runQueryProjectsInput.validate(value)).toBe(false);
  });
});
