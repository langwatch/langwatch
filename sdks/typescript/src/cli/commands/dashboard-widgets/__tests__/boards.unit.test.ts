import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoardsApiError,
  type BoardListItem,
  BoardsApiService,
} from "@/client-sdk/services/boards/boards-api.service";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { LangWatchHandledError } from "@/internal/api/errors";

import { formatTable } from "../../../utils/formatting";
import { listDashboardWidgetBoardsCommand } from "../boards";

vi.mock("@/client-sdk/services/boards/boards-api.service", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, BoardsApiService: vi.fn() };
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

/** What /api/v1/boards answers while Dashboards is off for the key's project. */
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
    operation: "list boards",
    message: "Not found",
  });

describe("listDashboardWidgetBoardsCommand()", () => {
  let mockListBoards: ReturnType<typeof vi.fn>;
  let mockListProjectBoards: ReturnType<typeof vi.fn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListBoards = vi.fn();
    mockListProjectBoards = vi.fn();
    vi.mocked(BoardsApiService).mockImplementation(function () {
      return { list: mockListBoards } as unknown as BoardsApiService;
    });
    vi.mocked(DashboardWidgetsApiService).mockImplementation(function () {
      return { listBoards: mockListProjectBoards } as unknown as DashboardWidgetsApiService;
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(noop);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  describe("when the project has Dashboards boards", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
    it("reads /api/v1/boards, tables each one's name, id and widget count, and warns of nothing", async () => {
      const boards = [
        { id: "board_1", name: "Latency", widgetCount: 3 },
        { id: "board_2", name: "Cost", widgetCount: 0 },
      ] as unknown as BoardListItem[];
      mockListBoards.mockResolvedValue({ data: boards });

      const result = await listDashboardWidgetBoardsCommand();
      result?.table();

      expect(result?.data).toEqual({ data: boards });
      expect(mockListProjectBoards).not.toHaveBeenCalled();
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

  describe("when /api/v1/boards answers 404, as while Dashboards is off", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
    it("lists the boards from the project-path list instead", async () => {
      const boards = [{ id: "board_1", name: "Latency", widgetCount: 3 }];
      mockListBoards.mockRejectedValue(notReleased());
      mockListProjectBoards.mockResolvedValue({ data: boards });

      const result = await listDashboardWidgetBoardsCommand();

      expect(result?.data).toEqual({ data: boards });
      expect(mockListProjectBoards).toHaveBeenCalledTimes(1);
    });
  });

  describe("when /api/v1/boards fails any other way", () => {
    /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
    it("reports that failure and asks nothing else", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      mockListBoards.mockRejectedValue(
        new BoardsApiError("server error", "list boards", undefined, 500),
      );

      await listDashboardWidgetBoardsCommand();

      expect(exit).toHaveBeenCalledWith(1);
      expect(mockListProjectBoards).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });
});
