import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuitesApiError } from "@/client-sdk/services/suites/suites-api.service";

vi.mock("@/client-sdk/services/suites/suites-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    SuitesApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env", endpoint: "https://app.langwatch.ai" })),
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
    vi.mocked(SuitesApiService).mockImplementation(function () { return ({
      getAll: mockGetAll,
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService; });
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

  describe("when a machine format is requested", () => {
    it("returns the raw suite list as the payload instead of printing", async () => {
      const suites = [makeSuite()];
      mockGetAll.mockResolvedValue(suites);

      const result = await listSuitesCommand();

      // The command no longer decides the format — it hands the payload to
      // the output port, which renders json/yaml/agents/--jq from this value.
      expect(result?.data).toEqual(suites);
      expect(console.log).not.toHaveBeenCalled();
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
    vi.mocked(SuitesApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService; });
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

  describe("when a machine format is requested", () => {
    it("returns the raw suite as the payload instead of printing", async () => {
      const suite = makeSuite();
      mockGet.mockResolvedValue(suite);

      const result = await getSuiteCommand("suite_abc123");

      expect(result?.data).toEqual(suite);
      expect(console.log).not.toHaveBeenCalled();
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
    vi.mocked(SuitesApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: mockCreate,
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService; });
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
    vi.mocked(SuitesApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: vi.fn(),
      delete: mockDelete,
    }) as unknown as SuitesApiService; });
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
    vi.mocked(SuitesApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: mockDuplicate,
      run: vi.fn(),
      delete: vi.fn(),
    }) as unknown as SuitesApiService; });
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

  describe("when a machine format is requested", () => {
    it("returns the duplicated suite as the payload instead of printing", async () => {
      const copy = makeSuite({ name: "Test Suite (copy)" });
      mockDuplicate.mockResolvedValue(copy);

      const result = await duplicateSuiteCommand("suite_abc123");

      expect(result?.data).toEqual(copy);
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});

describe("runSuiteCommand()", () => {
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun = vi.fn();
    vi.mocked(SuitesApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      run: mockRun,
      delete: vi.fn(),
    }) as unknown as SuitesApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when suite run is scheduled (no wait)", () => {
    it("schedules the run and returns immediately", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand({ id: "suite_abc123", options: {} });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: undefined,
        note: undefined,
      });
    });
  });

  describe("when --param pairs are given", () => {
    it("hands the run the values those names resolve to", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand({
        id: "suite_abc123",
        options: {
          param: ["account_tier=gold", "seats=12", "beta=false", "order=007"],
        },
      });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: {
          account_tier: "gold",
          seats: 12,
          beta: false,
          order: "007",
        },
        note: undefined,
      });
    });
  });

  describe("when a --param pair has no equals sign", () => {
    it("refuses the command instead of scheduling a run", async () => {
      await expect(
        runSuiteCommand({ id: "suite_abc123", options: { param: ["account_tier"] } }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = makeRunResult();
      mockRun.mockResolvedValue(result);

      await runSuiteCommand({ id: "suite_abc123", options: { format: "json" } });

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

      await runSuiteCommand({ id: "suite_abc123", options: {} });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: undefined,
        note: undefined,
      });
    });
  });

  // A run that scheduled nothing can never see a completion arrive, so the
  // poll loop ran the full 10-minute timeout and then reported a TIMEOUT for a
  // run that was already over. Asserting on `fetch` is what makes this a real
  // regression test: it is the poll itself that must not happen.
  describe("when the run scheduled no jobs and --wait was passed", () => {
    it("returns without polling instead of waiting out the timeout", async () => {
      mockRun.mockResolvedValue(
        makeRunResult({
          jobCount: 0,
          skippedArchived: { scenarios: ["archived_scenario"], targets: [] },
        }),
      );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}", { status: 200 }));

      await runSuiteCommand({ id: "suite_abc123", options: { wait: true } });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when API call fails", () => {
    it("exits with code 1", async () => {
      mockRun.mockRejectedValue(
        new SuitesApiError("Suite not found", "POST /api/suites/nonexistent/run"),
      );

      await expect(runSuiteCommand({ id: "nonexistent", options: {} })).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when --note is given", () => {
    /** @scenario "Run a suite with a note" */
    it("schedules the run with that note", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand({
        id: "suite_abc123",
        options: { note: "nightly regression after the retry fix" },
      });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: undefined,
        note: "nightly regression after the retry fix",
      });
    });

    /** @scenario "Run a suite with a note" */
    it("shows the note beside the batch run ID", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand({
        id: "suite_abc123",
        options: { note: "nightly regression after the retry fix" },
      });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("batch_123");
      expect(printed).toContain("nightly regression after the retry fix");
    });

    /** @scenario "Run a suite with a note and wait for completion" */
    it("schedules the run with the note and then polls for completion", async () => {
      mockRun.mockResolvedValue(makeRunResult({ jobCount: 1 }));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            runs: [
              {
                batchRunId: "batch_123",
                status: "SUCCESS",
                results: { verdict: "success" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      await runSuiteCommand({
        id: "suite_abc123",
        options: { note: "nightly regression", wait: true },
      });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: undefined,
        note: "nightly regression",
      });
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe("when --note is longer than the limit", () => {
    /** @scenario "Run a suite with a note over two hundred characters" */
    it("refuses the command instead of scheduling a run", async () => {
      await expect(
        runSuiteCommand({
          id: "suite_abc123",
          options: { note: "x".repeat(201) },
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  describe("when --note holds only spaces", () => {
    /** @scenario "Run a suite with a note of only spaces" */
    it("schedules the run with no note", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand({ id: "suite_abc123", options: { note: "   " } });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: undefined,
        note: undefined,
      });
    });
  });

  // A folder IS a suite, so `suite run` takes a folder id with no branch of
  // its own: the same request, the same result, the same reporting.
  describe("when the id names a test suite folder", () => {
    /** @scenario "Run a test suite folder" */
    it("runs it through the same path a run plan uses", async () => {
      mockRun.mockResolvedValue(makeRunResult({ batchRunId: "batch_folder" }));

      await runSuiteCommand({ id: "folder_abc", options: {} });

      expect(mockRun).toHaveBeenCalledWith("folder_abc", {
        parameters: undefined,
        note: undefined,
      });
    });

    /** @scenario "Run a test suite folder" */
    it("reports the job count and the batch run ID", async () => {
      mockRun.mockResolvedValue(
        makeRunResult({ batchRunId: "batch_folder", jobCount: 4 }),
      );

      await runSuiteCommand({ id: "folder_abc", options: {} });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("batch_folder");
      expect(printed).toContain("4");
    });

    /** @scenario "Run a test suite folder that has no targets" */
    it("reports the platform's refusal when the folder has no target", async () => {
      mockRun.mockRejectedValue(
        new SuitesApiError(
          "A suite needs at least one target to run against",
          "POST /api/suites/folder_abc/run",
        ),
      );

      await expect(
        runSuiteCommand({ id: "folder_abc", options: {} }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});
