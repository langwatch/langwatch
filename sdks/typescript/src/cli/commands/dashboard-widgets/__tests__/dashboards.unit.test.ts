import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import {
  DashboardsApiError,
  type DashboardListItem,
  DashboardsApiService,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { LangWatchHandledError } from "@/internal/api/errors";

import { formatTable } from "../../../utils/formatting";
import { listDashboardWidgetDashboardsCommand } from "../dashboards";

vi.mock("@/client-sdk/services/dashboards/dashboards-api.service", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, DashboardsApiService: vi.fn() };
});

vi.mock(
  "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, DashboardWidgetsApiService: vi.fn() };
  },
);

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("../../../utils/formatting", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, formatTable: vi.fn() };
});

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

const noop = () => {
  // suppresses output during tests
};

/** What /api/v1/dashboards answers while Dashboards is off for the key's project. */
const notReleased = () =>
  new LangWatchHandledError({
    handled: {
      code: "dashboards_not_released",
      kind: "dashboards_not_released",
      message: "Not found",
      httpStatus: 404,
      meta: {},
      isHandled: true,
      retryable: false,
    },
    body: { error: "dashboards_not_released", message: "Not found" },
    operation: "list dashboards",
    message: "Not found",
  });

describe("listDashboardWidgetDashboardsCommand()", () => {
  let mockListDashboards: ReturnType<typeof vi.fn>;
  let mockListProjectDashboards: ReturnType<typeof vi.fn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListDashboards = vi.fn();
    mockListProjectDashboards = vi.fn();
    vi.mocked(DashboardsApiService).mockImplementation(function () {
      return { list: mockListDashboards } as unknown as DashboardsApiService;
    });
    vi.mocked(DashboardWidgetsApiService).mockImplementation(function () {
      return { listDashboards: mockListProjectDashboards } as unknown as DashboardWidgetsApiService;
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(noop);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  describe("when the project has dashboards", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
    it("reads /api/v1/dashboards, tables each one's name, id and widget count, and writes nothing to stderr", async () => {
      const dashboards = [
        { id: "board_1", name: "Latency", widgetCount: 3 },
        { id: "board_2", name: "Cost", widgetCount: 0 },
      ] as unknown as DashboardListItem[];
      mockListDashboards.mockResolvedValue({ data: dashboards });

      const result = await listDashboardWidgetDashboardsCommand();
      result?.table();

      expect(result?.data).toEqual({ data: dashboards });
      expect(mockListProjectDashboards).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(formatTable).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: ["Name", "ID", "Widgets"],
          data: [
            { Name: "Latency", ID: "board_1", Widgets: "3" },
            { Name: "Cost", ID: "board_2", Widgets: "0" },
          ],
        }),
      );
    });
  });

  describe("when the project has no dashboards", () => {
    it("prints the empty state and no table", async () => {
      mockListDashboards.mockResolvedValue({ data: [] });

      const result = await listDashboardWidgetDashboardsCommand();
      result?.table();

      expect(result?.data).toEqual({ data: [] });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No dashboards found"));
      expect(formatTable).not.toHaveBeenCalled();
    });
  });

  describe("when /api/v1/dashboards answers 404, as while Dashboards is off", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
    it("lists the dashboards from the project-path list instead", async () => {
      const dashboards = [{ id: "board_1", name: "Latency", widgetCount: 3 }];
      mockListDashboards.mockRejectedValue(notReleased());
      mockListProjectDashboards.mockResolvedValue({ data: dashboards });

      const result = await listDashboardWidgetDashboardsCommand();

      expect(result?.data).toEqual({ data: dashboards });
      expect(mockListProjectDashboards).toHaveBeenCalledTimes(1);
    });
  });

  describe("when /api/v1/dashboards fails any other way", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
    it("reports that failure and asks nothing else", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      mockListDashboards.mockRejectedValue(
        new DashboardsApiError("server error", "list dashboards", undefined, 500),
      );

      await listDashboardWidgetDashboardsCommand();

      expect(exit).toHaveBeenCalledWith(1);
      expect(mockListProjectDashboards).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });
});
