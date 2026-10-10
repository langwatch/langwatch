/**
 * Digests of the add_dashboard_widget and update_dashboard_widget tools.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-dashboards.js", () => ({
  getDashboard: vi.fn(),
}));

vi.mock("../langwatch-api-dashboard-widgets.js", () => ({
  createDashboardWidget: vi.fn(),
  assignDashboardWidgetToDashboard: vi.fn(),
  deleteDashboardWidget: vi.fn(),
  getDashboardWidget: vi.fn(),
  updateDashboardWidget: vi.fn(),
}));

vi.mock("../langwatch-api-projects.js", () => ({
  getCurrentProject: vi.fn(),
}));

import {
  assignDashboardWidgetToDashboard,
  createDashboardWidget,
  deleteDashboardWidget,
  getDashboardWidget,
  updateDashboardWidget,
} from "../langwatch-api-dashboard-widgets.js";
import { getDashboard } from "../langwatch-api-dashboards.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { handleAddDashboardWidget } from "../tools/add-dashboard-widget.js";
import { handleUpdateDashboardWidget } from "../tools/update-dashboard-widget.js";

const mockGetDashboard = vi.mocked(getDashboard);
const mockCreateDashboardWidget = vi.mocked(createDashboardWidget);
const mockAssignDashboardWidgetToDashboard = vi.mocked(assignDashboardWidgetToDashboard);
const mockDeleteDashboardWidget = vi.mocked(deleteDashboardWidget);
const mockGetCurrentProject = vi.mocked(getCurrentProject);
const mockGetDashboardWidget = vi.mocked(getDashboardWidget);
const mockUpdateDashboardWidget = vi.mocked(updateDashboardWidget);

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
  order: 0,
  graphCount: 2,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentProject.mockResolvedValue({
    id: "proj_abc123",
    name: "My Project",
    slug: "my-project",
    isPersonal: false,
  });
  mockGetDashboard.mockResolvedValue(sampleDashboard);
  mockCreateDashboardWidget.mockResolvedValue(sampleWidget);
  mockAssignDashboardWidgetToDashboard.mockResolvedValue({
    ...sampleWidget,
    dashboardId: "dash_1",
  });
});

describe("handleAddDashboardWidget()", () => {
  describe("when the dashboard exists and creation succeeds", () => {
    /** @scenario "AC8 An MCP agent adds a widget to a board" */
    it("creates the widget scoped to the current project, then places it", async () => {
      const result = await handleAddDashboardWidget({
        dashboardId: "dash_1",
        name: "p95 latency",
        code: "export default () => null;",
        queries: { latency: "SELECT quantile(0.95)(duration) FROM traces" },
      });

      expect(mockGetDashboard).toHaveBeenCalledWith("dash_1");
      expect(mockCreateDashboardWidget).toHaveBeenCalledWith({
        projectId: "proj_abc123",
        name: "p95 latency",
        code: "export default () => null;",
        queries: [{ name: "latency", sql: "SELECT quantile(0.95)(duration) FROM traces" }],
      });
      expect(mockAssignDashboardWidgetToDashboard).toHaveBeenCalledWith({
        projectId: "proj_abc123",
        widgetId: "widget_1",
        dashboardId: "dash_1",
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

      expect(mockCreateDashboardWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          queries: [{ name: "latency", sql: "SELECT 1" }],
        }),
      );
    });
  });

  describe("when the dashboard does not exist", () => {
    beforeEach(() => {
      mockGetDashboard.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}"),
      );
    });

    /** @scenario "AC8b add_dashboard_widget rejects an unknown dashboard" */
    it("names the dashboard id in the error and creates no widget", async () => {
      await expect(
        handleAddDashboardWidget({
          dashboardId: "dash_missing",
          name: "p95 latency",
          code: "export default () => null;",
          queries: { latency: "SELECT 1" },
        }),
      ).rejects.toThrow(/dash_missing/);

      expect(mockCreateDashboardWidget).not.toHaveBeenCalled();
      expect(mockAssignDashboardWidgetToDashboard).not.toHaveBeenCalled();
    });
  });

  describe("when the create call fails", () => {
    it("propagates the server's error message", async () => {
      mockCreateDashboardWidget.mockRejectedValue(
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

      expect(mockAssignDashboardWidgetToDashboard).not.toHaveBeenCalled();
      expect(mockDeleteDashboardWidget).not.toHaveBeenCalled();
    });
  });

  describe("when the assign call fails after the widget was created", () => {
    it("deletes the orphaned widget and propagates the assign error", async () => {
      mockAssignDashboardWidgetToDashboard.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}"),
      );

      await expect(
        handleAddDashboardWidget({
          dashboardId: "dash_1",
          name: "p95 latency",
          code: "export default () => null;",
          queries: { latency: "SELECT 1" },
        }),
      ).rejects.toThrow(/404/);

      expect(mockDeleteDashboardWidget).toHaveBeenCalledWith({
        projectId: "proj_abc123",
        widgetId: "widget_1",
      });
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

      expect(mockGetDashboard).not.toHaveBeenCalled();
      expect(mockCreateDashboardWidget).not.toHaveBeenCalled();
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

      expect(mockCreateDashboardWidget).not.toHaveBeenCalled();
    });
  });
});

describe("handleUpdateDashboardWidget()", () => {
  const placedWidget = { ...sampleWidget, dashboardId: "dash_1" };

  beforeEach(() => {
    mockGetDashboardWidget.mockResolvedValue(placedWidget);
    mockUpdateDashboardWidget.mockResolvedValue({
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
    it("sends only the given fields and returns the updated widget", async () => {
      const result = await handleUpdateDashboardWidget({
        dashboardId: "dash_1",
        widgetId: "widget_1",
        name: "Errors per day",
        code: "export default () => <div />;",
      });

      expect(mockGetDashboardWidget).toHaveBeenCalledWith({
        projectId: "proj_abc123",
        widgetId: "widget_1",
      });
      expect(mockUpdateDashboardWidget).toHaveBeenCalledWith({
        projectId: "proj_abc123",
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

      expect(mockUpdateDashboardWidget).toHaveBeenCalledWith({
        projectId: "proj_abc123",
        widgetId: "widget_1",
        queries: [{ name: "errors", sql: "SELECT 1" }],
        description: "Errors per day",
      });
    });
  });

  describe("when the widget does not exist", () => {
    beforeEach(() => {
      mockGetDashboardWidget.mockRejectedValue(
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

      expect(mockUpdateDashboardWidget).not.toHaveBeenCalled();
    });
  });

  describe("when the widget is on another dashboard", () => {
    it("names both ids and changes nothing", async () => {
      mockGetDashboardWidget.mockResolvedValue({ ...placedWidget, dashboardId: "dash_other" });

      await expect(
        handleUpdateDashboardWidget({
          dashboardId: "dash_1",
          widgetId: "widget_1",
          name: "Errors per day",
        }),
      ).rejects.toThrow(/widget_1.*dash_1/);

      expect(mockUpdateDashboardWidget).not.toHaveBeenCalled();
    });
  });

  describe("when the dashboard does not exist", () => {
    beforeEach(() => {
      mockGetDashboard.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}"),
      );
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

      expect(mockGetDashboardWidget).not.toHaveBeenCalled();
      expect(mockUpdateDashboardWidget).not.toHaveBeenCalled();
    });
  });

  describe("when no field to change is given", () => {
    it("refuses without calling the API", async () => {
      await expect(
        handleUpdateDashboardWidget({ dashboardId: "dash_1", widgetId: "widget_1" }),
      ).rejects.toThrow(/at least one/i);

      expect(mockGetCurrentProject).not.toHaveBeenCalled();
      expect(mockUpdateDashboardWidget).not.toHaveBeenCalled();
    });
  });
});
