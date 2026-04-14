import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { listSimulationRunsCommand } from "../list";
import { getSimulationRunCommand } from "../get";

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

const makeRun = (overrides = {}) => ({
  scenarioRunId: "run_abc123",
  scenarioId: "scenario_1",
  batchRunId: "batch_xyz",
  name: "Login Flow Test",
  status: "SUCCESS",
  durationInMs: 5200,
  totalCost: 0.0042,
  results: {
    verdict: "passed",
    reasoning: "All criteria met",
    metCriteria: ["Greets user", "Asks for credentials"],
    unmetCriteria: [],
    error: null,
  },
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
  ],
  timestamp: Date.now() - 60000,
  updatedAt: Date.now(),
  ...overrides,
});

describe("listSimulationRunsCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  describe("when runs exist", () => {
    it("fetches and displays runs", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [makeRun()], hasMore: false }),
      });

      await listSimulationRunsCommand({ format: "table" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/simulation-runs"),
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("when no runs exist", () => {
    it("shows empty message", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [], hasMore: false }),
      });

      await listSimulationRunsCommand({});

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = { runs: [makeRun()], hasMore: false };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => result,
      });

      await listSimulationRunsCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
    });
  });

  describe("when filtering by scenarioSetId", () => {
    it("includes scenarioSetId in query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [], hasMore: false }),
      });

      await listSimulationRunsCommand({ scenarioSetId: "set_123" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("scenarioSetId=set_123"),
        expect.anything(),
      );
    });
  });

  describe("when API returns error", () => {
    it("exits with code 1", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(listSimulationRunsCommand({})).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getSimulationRunCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  describe("when run is found", () => {
    it("fetches and displays run details", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRun(),
      });

      await getSimulationRunCommand("run_abc123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/simulation-runs/run_abc123",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const run = makeRun();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => run,
      });

      await getSimulationRunCommand("run_abc123", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(run, null, 2),
      );
    });
  });

  describe("when run is not found", () => {
    it("exits with code 1", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => '{"error":"Not found"}',
      });

      await expect(getSimulationRunCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when run has failed verdict", () => {
    it("displays results with unmet criteria", async () => {
      const run = makeRun({
        status: "FAILED",
        results: {
          verdict: "failed",
          reasoning: "Did not greet user",
          metCriteria: [],
          unmetCriteria: ["Greets user"],
          error: null,
        },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => run,
      });

      await getSimulationRunCommand("run_abc123");

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});
