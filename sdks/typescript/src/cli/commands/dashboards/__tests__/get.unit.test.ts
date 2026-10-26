import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import {
  DashboardsApiError,
  DashboardsApiService,
} from "@/client-sdk/services/dashboards/dashboards-api.service";

vi.mock("@/client-sdk/services/dashboards/dashboards-api.service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DashboardsApiService: vi.fn(),
}));
vi.mock(
  "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    DashboardWidgetsApiService: vi.fn(),
  }),
);
vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));
const { spinnerFail } = vi.hoisted(() => ({ spinnerFail: vi.fn() }));
vi.mock("ora", () => ({
  default: () => ({ start: vi.fn().mockReturnThis(), succeed: vi.fn(), fail: spinnerFail }),
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

const notFound = () => new DashboardsApiError("Dashboard not found", "get", undefined, 404);

describe("getDashboardCommand()", () => {
  const reportsGet = vi.fn();
  const getBoard = vi.fn();
  let hasProject = true;

  beforeEach(() => {
    vi.clearAllMocks();
    hasProject = true;
    vi.mocked(DashboardsApiService).mockImplementation(function () {
      return { get: reportsGet } as unknown as DashboardsApiService;
    });
    vi.mocked(DashboardWidgetsApiService).mockImplementation(function () {
      return { getBoard, hasProject: () => hasProject } as unknown as DashboardWidgetsApiService;
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("when the id is a Dashboards board the Reports API does not hold", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("answers with the Dashboards board", async () => {
      reportsGet.mockRejectedValue(notFound());
      getBoard.mockResolvedValue(board);

      const result = await getDashboardCommand("dashboard_v2");

      expect(getBoard).toHaveBeenCalledWith("dashboard_v2");
      expect(result).toMatchObject({ data: { id: "dashboard_v2", name: "Ops board" } });
    });
  });

  describe("when neither area holds the id", () => {
    it("fails with the Reports error", async () => {
      reportsGet.mockRejectedValue(notFound());
      getBoard.mockRejectedValue(notFound());

      await expect(getDashboardCommand("missing")).rejects.toThrow("process.exit(1)");
    });
  });

  describe("when no project is in scope", () => {
    it("reports the Reports not found without asking the board route", async () => {
      hasProject = false;
      reportsGet.mockRejectedValue(notFound());

      await expect(getDashboardCommand("x")).rejects.toThrow("process.exit(1)");
      expect(getBoard).not.toHaveBeenCalled();
      expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("Dashboard not found"));
    });
  });

  describe("when the board route fails for another reason", () => {
    it("surfaces that error, not the Reports not found", async () => {
      reportsGet.mockRejectedValue(notFound());
      getBoard.mockRejectedValue(
        new DashboardsApiError("board route exploded", "get", undefined, 500),
      );

      await expect(getDashboardCommand("x")).rejects.toThrow("process.exit(1)");
      expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("board route exploded"));
    });
  });

  describe("when the Reports API fails for another reason", () => {
    it("does not ask the Dashboards area", async () => {
      reportsGet.mockRejectedValue(new DashboardsApiError("boom", "get", undefined, 500));

      await expect(getDashboardCommand("x")).rejects.toThrow("process.exit(1)");
      expect(getBoard).not.toHaveBeenCalled();
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
