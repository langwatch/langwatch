import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";

vi.mock("@/client-sdk/services/dashboards/dashboards-api.service", () => ({
  DashboardsApiService: vi.fn(),
}));
vi.mock("@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service", () => ({
  DashboardWidgetsApiService: vi.fn(),
}));
vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));
vi.mock("ora", () => ({
  default: () => ({ start: vi.fn().mockReturnThis(), succeed: vi.fn(), fail: vi.fn() }),
}));

import { getDashboardCommand } from "../get";

const board = {
  id: "dashboard_v2",
  name: "Ops board",
  description: null,
  scope: "PROJECT",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/p/analytics/boards/dashboard_v2",
};

describe("getDashboardCommand()", () => {
  const reportsGet = vi.fn();
  const getBoard = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(DashboardsApiService).mockImplementation(function () {
      return { get: reportsGet } as unknown as DashboardsApiService;
    });
    vi.mocked(DashboardWidgetsApiService).mockImplementation(function () {
      return { getBoard } as unknown as DashboardWidgetsApiService;
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("when the id is a Dashboards board the Reports API does not hold", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("answers with the Dashboards board", async () => {
      reportsGet.mockRejectedValue(new Error("Dashboard not found"));
      getBoard.mockResolvedValue(board);

      const result = await getDashboardCommand("dashboard_v2");

      expect(getBoard).toHaveBeenCalledWith("dashboard_v2");
      expect(result).toMatchObject({ data: { id: "dashboard_v2", name: "Ops board" } });
    });
  });

  describe("when neither area holds the id", () => {
    it("fails with the Reports error", async () => {
      reportsGet.mockRejectedValue(new Error("Dashboard not found"));
      getBoard.mockRejectedValue(new Error("not found"));

      await expect(getDashboardCommand("missing")).rejects.toThrow("process.exit(1)");
    });
  });

  describe("when the Reports API holds the id", () => {
    it("does not ask the Dashboards area", async () => {
      reportsGet.mockResolvedValue({ ...board, graphs: [], order: 0 });

      await getDashboardCommand("dashboard_v2");

      expect(getBoard).not.toHaveBeenCalled();
    });
  });
});
