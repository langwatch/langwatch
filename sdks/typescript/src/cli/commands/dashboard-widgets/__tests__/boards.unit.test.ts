import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DashboardBoard,
  DashboardWidgetsApiService,
} from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";

import { formatTable } from "../../../utils/formatting";
import { listDashboardWidgetBoardsCommand } from "../boards";

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

describe("listDashboardWidgetBoardsCommand()", () => {
  let mockListBoards: ReturnType<typeof vi.fn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListBoards = vi.fn();
    vi.mocked(DashboardWidgetsApiService).mockImplementation(function () {
      return { listBoards: mockListBoards } as unknown as DashboardWidgetsApiService;
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(noop);
  });

  describe("when the project has Dashboards boards", () => {
    it("returns the boards and tables each one's name, id and widget count", async () => {
      const boards = [
        { id: "board_1", name: "Latency", widgetCount: 3 },
        { id: "board_2", name: "Cost", widgetCount: 0 },
      ] as unknown as DashboardBoard[];
      mockListBoards.mockResolvedValue({ data: boards });

      const result = await listDashboardWidgetBoardsCommand();
      result?.table();

      expect(result?.data).toEqual({ data: boards });
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

  describe("when the project has no Dashboards boards", () => {
    it("prints the empty state and no table", async () => {
      mockListBoards.mockResolvedValue({ data: [] });

      const result = await listDashboardWidgetBoardsCommand();
      result?.table();

      expect(result?.data).toEqual({ data: [] });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No dashboards found"));
      expect(formatTable).not.toHaveBeenCalled();
    });
  });
});
