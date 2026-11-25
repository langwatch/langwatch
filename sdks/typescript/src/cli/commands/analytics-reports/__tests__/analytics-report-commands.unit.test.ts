import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import {
  AnalyticsReportsApiError,
  AnalyticsReportsApiService,
} from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

vi.mock(
  "@/client-sdk/services/analytics-reports/analytics-reports-api.service",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      AnalyticsReportsApiService: vi.fn(),
    };
  },
);

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { createAnalyticsReportCommand } from "../create";
import { deleteAnalyticsReportCommand } from "../delete";
import { listAnalyticsReportsCommand } from "../list";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

let exitSpy: MockInstance<typeof process.exit>;

const mockProcessExit = () => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("listAnalyticsReportsCommand()", () => {
  let mockList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList = vi.fn();
    vi.mocked(AnalyticsReportsApiService).mockImplementation(function () {
      return {
        list: mockList,
        get: vi.fn(),
        create: vi.fn(),
        rename: vi.fn(),
        delete: vi.fn(),
      } as unknown as AnalyticsReportsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when analytics reports exist", () => {
    it("calls list and prints output", async () => {
      mockList.mockResolvedValue({
        data: [
          {
            id: "d1",
            name: "My Dashboard",
            order: 0,
            graphCount: 3,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-02",
          },
        ],
      });

      await listAnalyticsReportsCommand();

      expect(mockList).toHaveBeenCalledOnce();
    });
  });

  describe("when no analytics reports exist", () => {
    it("prints empty-state message", async () => {
      mockList.mockResolvedValue({ data: [] });

      await listAnalyticsReportsCommand();

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockList.mockRejectedValue(new AnalyticsReportsApiError("Network error", "list dashboards"));

      await expect(listAnalyticsReportsCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createAnalyticsReportCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(AnalyticsReportsApiService).mockImplementation(function () {
      return {
        list: vi.fn(),
        get: vi.fn(),
        create: mockCreate,
        rename: vi.fn(),
        delete: vi.fn(),
      } as unknown as AnalyticsReportsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when creation succeeds", () => {
    it("calls create with the name", async () => {
      mockCreate.mockResolvedValue({ id: "d1", name: "My Dashboard" });

      await createAnalyticsReportCommand("My Dashboard");

      expect(mockCreate).toHaveBeenCalledWith({ name: "My Dashboard" });
    });
  });

  describe("when creation fails", () => {
    it("exits with code 1", async () => {
      mockCreate.mockRejectedValue(
        new AnalyticsReportsApiError("Limit reached", "create dashboard"),
      );

      await expect(createAnalyticsReportCommand("My Dashboard")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("deleteAnalyticsReportCommand()", () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete = vi.fn();
    vi.mocked(AnalyticsReportsApiService).mockImplementation(function () {
      return {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        rename: vi.fn(),
        delete: mockDelete,
      } as unknown as AnalyticsReportsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when deletion succeeds", () => {
    it("calls delete with the ID", async () => {
      mockDelete.mockResolvedValue({ id: "d1", name: "My Dashboard" });

      await deleteAnalyticsReportCommand("d1");

      expect(mockDelete).toHaveBeenCalledWith("d1");
    });
  });

  describe("when deletion fails", () => {
    it("exits with code 1", async () => {
      mockDelete.mockRejectedValue(new AnalyticsReportsApiError("Not found", "delete dashboard"));

      await expect(deleteAnalyticsReportCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});
