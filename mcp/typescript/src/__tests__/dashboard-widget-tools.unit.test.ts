/**
 * Digests of the add_dashboard_widget tool.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-dashboards.js", () => ({
  getDashboard: vi.fn(),
}));

vi.mock("../langwatch-api-dashboard-widgets.js", () => ({
  createDashboardWidget: vi.fn(),
  assignDashboardWidgetToDashboard: vi.fn(),
  deleteDashboardWidget: vi.fn(),
}));

vi.mock("../langwatch-api-projects.js", () => ({
  getCurrentProject: vi.fn(),
}));

import { getDashboard } from "../langwatch-api-dashboards.js";
import {
  assignDashboardWidgetToDashboard,
  createDashboardWidget,
  deleteDashboardWidget,
} from "../langwatch-api-dashboard-widgets.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { handleAddDashboardWidget } from "../tools/add-dashboard-widget.js";

const mockGetDashboard = vi.mocked(getDashboard);
const mockCreateDashboardWidget = vi.mocked(createDashboardWidget);
const mockAssignDashboardWidgetToDashboard = vi.mocked(
  assignDashboardWidgetToDashboard,
);
const mockDeleteDashboardWidget = vi.mocked(deleteDashboardWidget);
const mockGetCurrentProject = vi.mocked(getCurrentProject);

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
        queries: [
          { name: "latency", sql: "SELECT quantile(0.95)(duration) FROM traces" },
        ],
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
        new LangWatchApiError(
          "LangWatch API error 400: code is too long",
          400,
          "{}",
        ),
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
      ).rejects.toThrow();

      expect(mockDeleteDashboardWidget).toHaveBeenCalledWith({
        projectId: "proj_abc123",
        widgetId: "widget_1",
      });
    });
  });

  describe("query validation", () => {
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
