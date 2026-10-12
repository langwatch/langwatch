import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service",
  async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      DashboardWidgetsApiService: vi.fn(),
    };
  },
);

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
    projectId: "project-1",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { placeDashboardWidgetCommand } from "../place";
import { unplaceDashboardWidgetCommand } from "../unplace";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const WIDGET = {
  id: "widget-1",
  name: "Traces per day",
  definition: { version: 1, code: "export default () => null;", queries: [] },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
  platformUrl: "https://app.langwatch.ai/project/analytics/reports",
  dashboardId: null,
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
};

interface ServiceMocks {
  place: ReturnType<typeof vi.fn>;
  unplace: ReturnType<typeof vi.fn>;
}

let mocks: ServiceMocks;

beforeEach(() => {
  vi.clearAllMocks();
  mocks = { place: vi.fn(), unplace: vi.fn() };
  vi.mocked(DashboardWidgetsApiService).mockImplementation(
    function () {
      return mocks as unknown as DashboardWidgetsApiService;
    } as unknown as new () => DashboardWidgetsApiService,
  );
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

describe("placeDashboardWidgetCommand()", () => {
  describe("when given a dashboard and no grid position", () => {
    it("sends only the dashboard id, leaving allocation to the platform", async () => {
      mocks.place.mockResolvedValue({
        ...WIDGET,
        dashboardId: "dashboard-1",
        gridRow: 2,
      });

      await placeDashboardWidgetCommand("widget-1", {
        dashboardId: "dashboard-1",
      });

      expect(mocks.place).toHaveBeenCalledWith("widget-1", {
        dashboardId: "dashboard-1",
      });
    });
  });

  describe("when given an explicit grid position on the 8-column grid", () => {
    it("passes every flag through as a number", async () => {
      mocks.place.mockResolvedValue({
        ...WIDGET,
        dashboardId: "dashboard-1",
        gridColumn: 4,
        gridRow: 3,
        colSpan: 4,
        rowSpan: 2,
      });

      await placeDashboardWidgetCommand("widget-1", {
        dashboardId: "dashboard-1",
        gridColumn: "4",
        gridRow: "3",
        colSpan: "4",
        rowSpan: "2",
      });

      expect(mocks.place).toHaveBeenCalledWith("widget-1", {
        dashboardId: "dashboard-1",
        gridColumn: 4,
        gridRow: 3,
        colSpan: 4,
        rowSpan: 2,
      });
    });
  });

  describe("when no dashboard id is given", () => {
    it("refuses locally without calling the API", async () => {
      await expect(
        placeDashboardWidgetCommand("widget-1", {}),
      ).rejects.toThrow(ProcessExitError);
      expect(mocks.place).not.toHaveBeenCalled();
    });
  });
});

describe("unplaceDashboardWidgetCommand()", () => {
  describe("when the platform answers 204 with no body", () => {
    it("confirms via the id the caller passed instead of reading a body", async () => {
      mocks.unplace.mockResolvedValue(undefined);

      const result = await unplaceDashboardWidgetCommand("widget-1");

      expect(mocks.unplace).toHaveBeenCalledWith("widget-1");
      expect(result?.data).toEqual({ id: "widget-1", unplaced: true });
    });
  });
});
