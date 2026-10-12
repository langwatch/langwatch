import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { updateDashboardWidgetCommand } from "../update";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const CURRENT_WIDGET = {
  id: "widget-1",
  name: "Traces per day",
  definition: {
    version: 1,
    code: "export default () => 'old';",
    queries: [{ name: "traces", sql: "SELECT count() AS value FROM analytics.traces" }],
  },
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
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

let mocks: ServiceMocks;

beforeEach(() => {
  vi.clearAllMocks();
  mocks = { get: vi.fn(), update: vi.fn() };
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

describe("updateDashboardWidgetCommand() partial definition updates", () => {
  describe("when only --queries-file is given", () => {
    it("reads the current widget and sends its code back unchanged", async () => {
      mocks.get.mockResolvedValue(CURRENT_WIDGET);
      mocks.update.mockResolvedValue(CURRENT_WIDGET);
      const dir = mkdtempSync(join(tmpdir(), "widget-update-cmd-"));
      const queriesFile = join(dir, "queries.json");
      const newQueries = [
        { name: "errors", sql: "SELECT count() AS value FROM analytics.errors" },
      ];
      writeFileSync(queriesFile, JSON.stringify(newQueries));

      await updateDashboardWidgetCommand("widget-1", { queriesFile });

      expect(mocks.get).toHaveBeenCalledWith("widget-1");
      expect(mocks.update).toHaveBeenCalledWith({
        id: "widget-1",
        definition: {
          code: CURRENT_WIDGET.definition.code,
          queries: newQueries,
        },
      });
    });
  });

  describe("when only --code is given", () => {
    it("reads the current widget and sends its queries back unchanged", async () => {
      mocks.get.mockResolvedValue(CURRENT_WIDGET);
      mocks.update.mockResolvedValue(CURRENT_WIDGET);

      await updateDashboardWidgetCommand("widget-1", { code: "new code" });

      expect(mocks.get).toHaveBeenCalledWith("widget-1");
      expect(mocks.update).toHaveBeenCalledWith({
        id: "widget-1",
        definition: {
          code: "new code",
          queries: CURRENT_WIDGET.definition.queries,
        },
      });
    });
  });

  describe("when both halves are given", () => {
    it("never reads the current widget", async () => {
      mocks.update.mockResolvedValue(CURRENT_WIDGET);
      const dir = mkdtempSync(join(tmpdir(), "widget-update-cmd-"));
      const queriesFile = join(dir, "queries.json");
      writeFileSync(queriesFile, JSON.stringify(CURRENT_WIDGET.definition.queries));

      await updateDashboardWidgetCommand("widget-1", {
        code: "new code",
        queriesFile,
      });

      expect(mocks.get).not.toHaveBeenCalled();
    });
  });
});
