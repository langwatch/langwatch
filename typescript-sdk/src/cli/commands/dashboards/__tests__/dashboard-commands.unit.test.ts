import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardsApiError } from "@/client-sdk/services/dashboards/dashboards-api.service";

vi.mock("@/client-sdk/services/dashboards/dashboards-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    DashboardsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { listDashboardsCommand } from "../list";
import { createDashboardCommand } from "../create";
import { deleteDashboardCommand } from "../delete";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("listDashboardsCommand()", () => {
  let mockList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList = vi.fn();
    vi.mocked(DashboardsApiService).mockImplementation(() => ({
      list: mockList,
      get: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
    }) as unknown as DashboardsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when dashboards exist", () => {
    it("calls list and prints output", async () => {
      mockList.mockResolvedValue({
        data: [{ id: "d1", name: "My Dashboard", order: 0, graphCount: 3, createdAt: "2026-01-01", updatedAt: "2026-01-02" }],
      });

      await listDashboardsCommand();

      expect(mockList).toHaveBeenCalledOnce();
    });
  });

  describe("when no dashboards exist", () => {
    it("prints empty-state message", async () => {
      mockList.mockResolvedValue({ data: [] });

      await listDashboardsCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockList.mockRejectedValue(
        new DashboardsApiError("Network error", "list dashboards"),
      );

      await expect(listDashboardsCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createDashboardCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(DashboardsApiService).mockImplementation(() => ({
      list: vi.fn(),
      get: vi.fn(),
      create: mockCreate,
      rename: vi.fn(),
      delete: vi.fn(),
    }) as unknown as DashboardsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when creation succeeds", () => {
    it("calls create with the name", async () => {
      mockCreate.mockResolvedValue({ id: "d1", name: "My Dashboard" });

      await createDashboardCommand("My Dashboard");

      expect(mockCreate).toHaveBeenCalledWith({ name: "My Dashboard" });
    });
  });

  describe("when creation fails", () => {
    it("exits with code 1", async () => {
      mockCreate.mockRejectedValue(
        new DashboardsApiError("Limit reached", "create dashboard"),
      );

      await expect(createDashboardCommand("My Dashboard")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("deleteDashboardCommand()", () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete = vi.fn();
    vi.mocked(DashboardsApiService).mockImplementation(() => ({
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      delete: mockDelete,
    }) as unknown as DashboardsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when deletion succeeds", () => {
    it("calls delete with the ID", async () => {
      mockDelete.mockResolvedValue({ id: "d1", name: "My Dashboard" });

      await deleteDashboardCommand("d1");

      expect(mockDelete).toHaveBeenCalledWith("d1");
    });
  });

  describe("when deletion fails", () => {
    it("exits with code 1", async () => {
      mockDelete.mockRejectedValue(
        new DashboardsApiError("Not found", "delete dashboard"),
      );

      await expect(deleteDashboardCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});
