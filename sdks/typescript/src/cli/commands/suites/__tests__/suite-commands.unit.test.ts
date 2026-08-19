import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SuitesApiError } from "@/client-sdk/services/suites/suites-api.service";
import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

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
  // The command resolves its output format from the flags AND the agent-mode
  // env vars, so a test runner living inside a coding agent (CLAUDECODE set)
  // must not flip the human-path tests into machine mode.
  let savedAgentEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    savedAgentEnv = Object.fromEntries(
      AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
    );
    for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
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

  afterEach(() => {
    for (const name of AGENT_MODE_ENV_VARS) {
      const value = savedAgentEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    // The wait paths set the exit code; a leftover value would fail the whole
    // vitest process at the end of the run.
    process.exitCode = undefined;
  });

  /** All JSON documents the command printed on stdout. */
  const printedDocuments = (): string[] =>
    vi
      .mocked(console.log)
      .mock.calls.map((call) => call[0] as unknown)
      .filter(
        (line): line is string =>
          typeof line === "string" && line.trimStart().startsWith("{"),
      );

  describe("when suite run is scheduled (no wait)", () => {
    it("schedules the run and returns immediately", async () => {
      mockRun.mockResolvedValue(makeRunResult());

      await runSuiteCommand({ id: "suite_abc123", options: {} });

      expect(mockRun).toHaveBeenCalledWith("suite_abc123", {
        parameters: undefined,
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
    /** @scenario "Run a suite with machine-readable output" */
    it("outputs one JSON document carrying the schedule payload and outcome", async () => {
      const result = makeRunResult();
      mockRun.mockResolvedValue(result);

      await runSuiteCommand({ id: "suite_abc123", options: { format: "json" } });

      expect(printedDocuments()).toEqual([
        JSON.stringify({ ...result, outcome: "scheduled" }, null, 2),
      ]);
    });
  });

  describe("when --wait completes under a machine format", () => {
    /** @scenario "Wait for a suite run with machine-readable output" */
    it("emits exactly one final document with tallies, per-run results and outcome", async () => {
      mockRun.mockResolvedValue(makeRunResult());
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(
          JSON.stringify({
            runs: [
              { batchRunId: "batch_123", scenarioRunId: "run_1", scenarioId: "scenario_1", status: "SUCCESS", results: { verdict: "success" } },
              { batchRunId: "batch_123", scenarioRunId: "run_2", scenarioId: "scenario_2", status: "ERROR", results: null },
            ],
            hasMore: false,
          }),
          { status: 200 },
        ),
      );

      vi.useFakeTimers();
      try {
        const promise = runSuiteCommand({
          id: "suite_abc123",
          options: { wait: true, format: "json" },
        });
        await vi.advanceTimersByTimeAsync(3000);
        await promise;
      } finally {
        vi.useRealTimers();
      }

      const documents = printedDocuments();
      expect(documents).toHaveLength(1);
      const document = JSON.parse(documents[0]!) as Record<string, unknown>;
      expect(document.batchRunId).toBe("batch_123");
      expect(document.setId).toBe("set_456");
      expect(document.outcome).toBe("failed");
      expect(document.tallies).toEqual({
        total: 2,
        completed: 2,
        passed: 1,
        failed: 1,
      });
      expect(document.results).toEqual([
        { scenarioRunId: "run_1", scenarioId: "scenario_1", status: "SUCCESS", verdict: "success" },
        { scenarioRunId: "run_2", scenarioId: "scenario_2", status: "ERROR", verdict: null },
      ]);
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the wait times out under a machine format", () => {
    /** @scenario "A timed-out wait still emits the machine-readable document" */
    it("emits the final document with the timeout outcome and exits nonzero", async () => {
      mockRun.mockResolvedValue(makeRunResult());
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(
          JSON.stringify({
            runs: [{ batchRunId: "batch_123", status: "IN_PROGRESS" }],
            hasMore: false,
          }),
          { status: 200 },
        ),
      );

      vi.useFakeTimers();
      try {
        const promise = runSuiteCommand({
          id: "suite_abc123",
          options: { wait: true, format: "json" },
        });
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 3000);
        await promise;
      } finally {
        vi.useRealTimers();
      }

      const documents = printedDocuments();
      expect(documents).toHaveLength(1);
      const document = JSON.parse(documents[0]!) as Record<string, unknown>;
      expect(document.outcome).toBe("timeout");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the status endpoint keeps failing under a machine format", () => {
    /** @scenario "A dead status endpoint still emits the machine-readable document" */
    it("emits the final document with the poll failure outcome and exits nonzero", async () => {
      mockRun.mockResolvedValue(makeRunResult());
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("endpoint down"));

      vi.useFakeTimers();
      try {
        const promise = runSuiteCommand({
          id: "suite_abc123",
          options: { wait: true, format: "json" },
        });
        await vi.advanceTimersByTimeAsync(5 * 3000);
        await promise;
      } finally {
        vi.useRealTimers();
      }

      const documents = printedDocuments();
      expect(documents).toHaveLength(1);
      const document = JSON.parse(documents[0]!) as Record<string, unknown>;
      expect(document.outcome).toBe("poll_failure");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when --wait completes in human mode", () => {
    /** @scenario "Waiting in human mode prints no machine document" */
    it("prints the human tail and no JSON document", async () => {
      mockRun.mockResolvedValue(makeRunResult());
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(
          JSON.stringify({
            runs: [
              { batchRunId: "batch_123", scenarioRunId: "run_1", scenarioId: "scenario_1", status: "SUCCESS", results: { verdict: "success" } },
              { batchRunId: "batch_123", scenarioRunId: "run_2", scenarioId: "scenario_2", status: "SUCCESS", results: { verdict: "success" } },
            ],
            hasMore: false,
          }),
          { status: 200 },
        ),
      );

      vi.useFakeTimers();
      try {
        const promise = runSuiteCommand({
          id: "suite_abc123",
          options: { wait: true },
        });
        await vi.advanceTimersByTimeAsync(3000);
        await promise;
      } finally {
        vi.useRealTimers();
      }

      expect(printedDocuments()).toHaveLength(0);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("batch_123"),
      );
      expect(process.exitCode).not.toBe(1);
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
});
