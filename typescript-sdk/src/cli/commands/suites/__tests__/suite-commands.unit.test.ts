import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuitesApiError } from "@/client-sdk/services/suites/suites-api.service";

vi.mock("@/client-sdk/services/suites/suites-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client-sdk/services/suites/suites-api.service")>();
  return {
    ...actual,
    SuitesApiService: vi.fn(),
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
    warn: vi.fn(),
    text: "",
  }),
}));

import { SuitesApiService } from "@/client-sdk/services/suites/suites-api.service";
import { listSuitesCommand } from "../list";
import { getSuiteCommand } from "../get";
import { createSuiteCommand } from "../create";
import { deleteSuiteCommand } from "../delete";
import { duplicateSuiteCommand } from "../duplicate";
import { runSuiteCommand } from "../run";

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

const makeSuite = (overrides = {}) => ({
  id: "suite_abc123",
  name: "Test Suite",
  slug: "test-suite",
  description: "A test suite",
  scenarioIds: ["scenario_1", "scenario_2"],
  targets: [{ type: "http" as const, referenceId: "agent_xyz" }],
  repeatCount: 1,
  labels: ["regression"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  ...overrides,
});

const makeRunResult = (overrides = {}) => ({
  scheduled: true,
  batchRunId: "batch_123",
  setId: "set_456",
  jobCount: 2,
  skippedArchived: { scenarios: [], targets: [] },
  items: [
    { scenarioRunId: "run_1", scenarioId: "scenario_1", target: { type: "http" as const, referenceId: "agent_xyz" }, name: "Test Scenario" },
    { scenarioRunId: "run_2", scenarioId: "scenario_2", target: { type: "http" as const, referenceId: "agent_xyz" }, name: "Another Scenario" },
  ],
  ...overrides,
});

describe("listSuitesCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(() => ({
      getAll: mockGetAll,
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when suites exist", () => {
    it("calls getAll and prints output", async () => {
      mockGetAll.mockResolvedValue([makeSuite()]);

      await listSuitesCommand();

      expect(mockGetAll).toHaveBeenCalledOnce();
    });
  });

  describe("when no suites exist", () => {
    it("prints empty-state message", async () => {
      mockGetAll.mockResolvedValue([]);

      await listSuitesCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const suites = [makeSuite()];
      mockGetAll.mockResolvedValue(suites);

      await listSuitesCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(suites, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockRejectedValue(
        new SuitesApiError("Network error", "GET /api/suites"),
      );

      await expect(listSuitesCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getSuiteCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when suite is found", () => {
    it("calls get with the provided ID", async () => {
      mockGet.mockResolvedValue(makeSuite());

      await getSuiteCommand("suite_abc123");

      expect(mockGet).toHaveBeenCalledWith("suite_abc123");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const suite = makeSuite();
      mockGet.mockResolvedValue(suite);

      await getSuiteCommand("suite_abc123", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(suite, null, 2),
      );
    });
  });

  describe("when suite is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new SuitesApiError("Not found", "GET /api/suites/nonexistent"),
      );

      await expect(getSuiteCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createSuiteCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: mockCreate,
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when valid inputs are provided", () => {
    it("creates the suite with parsed scenarios and targets", async () => {
      mockCreate.mockResolvedValue(makeSuite());

      await createSuiteCommand("Test Suite", {
        scenarios: "scenario_1,scenario_2",
        targets: ["http:agent_xyz"],
      });

      expect(mockCreate).toHaveBeenCalledWith({
        name: "Test Suite",
        description: undefined,
        scenarioIds: ["scenario_1", "scenario_2"],
        targets: [{ type: "http", referenceId: "agent_xyz" }],
        repeatCount: 1,
        labels: [],
      });
    });
  });

  describe("when scenarios are missing", () => {
    it("exits with code 1", async () => {
      await expect(
        createSuiteCommand("Test Suite", { targets: ["http:agent_xyz"] }),
      ).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when targets are missing", () => {
    it("exits with code 1", async () => {
      await expect(
        createSuiteCommand("Test Suite", { scenarios: "scenario_1" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("deleteSuiteCommand()", () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: mockDelete,
    }) as unknown as SuitesApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when suite exists", () => {
    it("archives the suite", async () => {
      mockDelete.mockResolvedValue({ id: "suite_abc123", archived: true });

      await deleteSuiteCommand("suite_abc123");

      expect(mockDelete).toHaveBeenCalledWith("suite_abc123");
    });
  });

  describe("when suite is not found", () => {
    it("exits with code 1", async () => {
      mockDelete.mockRejectedValue(
        new SuitesApiError("Not found", "DELETE /api/suites/nonexistent"),
      );

      await expect(deleteSuiteCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("duplicateSuiteCommand()", () => {
  let mockDuplicate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDuplicate = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: mockDuplicate,
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when suite is duplicated successfully", () => {
    it("creates a copy", async () => {
      mockDuplicate.mockResolvedValue(makeSuite({ name: "Test Suite (copy)", id: "suite_new123" }));

      await duplicateSuiteCommand("suite_abc123");

      expect(mockDuplicate).toHaveBeenCalledWith("suite_abc123");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const copy = makeSuite({ name: "Test Suite (copy)" });
      mockDuplicate.mockResolvedValue(copy);

      await duplicateSuiteCommand("suite_abc123", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(copy, null, 2),
      );
    });
  });
});

describe("runSuiteCommand()", () => {
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: mockRun,
      delete: vi.fn(),
    }) as unknown as SuitesApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when suite run is scheduled (no wait)", () => {
    it("schedules the run and returns immediately", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand("suite_abc123", {});

      expect(mockRun).toHaveBeenCalledWith("suite_abc123");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = makeRunResult();
      mockRun.mockResolvedValue(result);

      await runSuiteCommand("suite_abc123", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
    });
  });

  describe("when run has skipped archived references", () => {
    it("shows warning about skipped items", async () => {
      mockRun.mockResolvedValue(
        makeRunResult({ skippedArchived: { scenarios: ["old_scenario"], targets: ["old_agent"] } }),
      );

      await runSuiteCommand("suite_abc123", {});

      expect(mockRun).toHaveBeenCalledWith("suite_abc123");
    });
  });

  describe("when API call fails", () => {
    it("exits with code 1", async () => {
      mockRun.mockRejectedValue(
        new SuitesApiError("Suite not found", "POST /api/suites/nonexistent/run"),
      );

      await expect(runSuiteCommand("nonexistent", {})).rejects.toThrow(ProcessExitError);
    });
  });
});
