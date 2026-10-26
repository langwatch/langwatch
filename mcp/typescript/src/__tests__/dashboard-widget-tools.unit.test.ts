/**
 * Digests of the add_dashboard_widget and update_dashboard_widget tools.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-boards.js", () => ({
  createBoardWidget: vi.fn(),
  getBoard: vi.fn(),
  getBoardWidget: vi.fn(),
  listBoards: vi.fn(),
  updateBoardWidget: vi.fn(),
}));

import {
  createBoardWidget,
  getBoard,
  getBoardWidget,
  listBoards,
  updateBoardWidget,
} from "../langwatch-api-boards.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { handleAddDashboardWidget } from "../tools/add-dashboard-widget.js";
import { handleListDashboardBoards } from "../tools/list-dashboard-boards.js";
import { handleUpdateDashboardWidget } from "../tools/update-dashboard-widget.js";

const mockGetBoard = vi.mocked(getBoard);
const mockListBoards = vi.mocked(listBoards);
const mockCreateDashboardWidget = vi.mocked(createBoardWidget);
const mockGetDashboardWidget = vi.mocked(getBoardWidget);
const mockUpdateDashboardWidget = vi.mocked(updateBoardWidget);

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

const sampleBoard = {
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
  mockGetBoard.mockResolvedValue(sampleBoard);
  mockCreateDashboardWidget.mockResolvedValue({ ...sampleWidget, dashboardId: "dash_1" });
});

describe("handleAddDashboardWidget()", () => {
  describe("when the dashboard exists and creation succeeds", () => {
    /** @scenario "AC8 An MCP agent adds a widget to a board" */
    it("creates the widget under the board's own path, which places it", async () => {
      const result = await handleAddDashboardWidget({
        dashboardId: "dash_1",
        name: "p95 latency",
        code: "export default () => null;",
        queries: { latency: "SELECT quantile(0.95)(duration) FROM traces" },
      });

      expect(mockGetBoard).toHaveBeenCalledWith({ boardId: "dash_1" });
      expect(mockCreateDashboardWidget).toHaveBeenCalledWith({
        boardId: "dash_1",
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

      expect(mockCreateDashboardWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          queries: [{ name: "latency", sql: "SELECT 1" }],
        }),
      );
    });
  });

  describe("when the dashboard does not exist", () => {
    beforeEach(() => {
      mockGetBoard.mockRejectedValue(
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

      expect(mockGetBoard).not.toHaveBeenCalled();
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
        boardId: "dash_1",
        widgetId: "widget_1",
      });
      expect(mockUpdateDashboardWidget).toHaveBeenCalledWith({
        boardId: "dash_1",
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
        boardId: "dash_1",
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
    it("names both ids and changes nothing, as the board route answers 404", async () => {
      mockGetDashboardWidget.mockRejectedValue(
        new LangWatchApiError("LangWatch API error 404: Not found", 404, "{}"),
      );

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
      mockGetBoard.mockRejectedValue(
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

      expect(mockGetBoard).not.toHaveBeenCalled();
      expect(mockUpdateDashboardWidget).not.toHaveBeenCalled();
    });
  });
});

describe("handleListDashboardBoards()", () => {
  describe("when the project has Dashboards boards", () => {
    it("lists them from the project's boards route, each with the id the widget tools take", async () => {
      mockListBoards.mockResolvedValue({ data: [{ ...sampleBoard, widgetCount: 3 }] });

      const result = await handleListDashboardBoards();

      expect(mockListBoards).toHaveBeenCalledWith();
      expect(result).toContain("Agent health");
      expect(result).toContain("**ID**: dash_1");
      expect(result).toContain("**Widgets**: 3");
    });
  });

  describe("when the project has none", () => {
    it("says so", async () => {
      mockListBoards.mockResolvedValue({ data: [] });

      expect(await handleListDashboardBoards()).toMatch(/No dashboards found/);
    });
  });
});
