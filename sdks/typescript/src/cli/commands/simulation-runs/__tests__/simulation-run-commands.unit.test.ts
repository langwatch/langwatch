import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env", endpoint: "https://app.langwatch.ai" })),
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
import { setOutputFormat } from "../../../utils/outputScope";

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
    global.fetch = mockFetch as unknown as typeof fetch;
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

      await listSimulationRunsCommand({});

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

  describe("when a machine format is requested", () => {
    it("returns the raw run listing as the payload instead of printing", async () => {
      const response = { runs: [makeRun()], hasMore: false };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      const result = await listSimulationRunsCommand({});

      // The command no longer decides the format — it hands the payload to
      // the output port, which renders json/yaml/agents/--jq from this value.
      expect(result?.data).toEqual(response);
      expect(console.log).not.toHaveBeenCalled();
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

  describe("when the platform refuses the limit", () => {
    /** @scenario "A refused page size is reported as a validation error, not as a network error" */
    it("keeps validation_error at 422 instead of degrading to network_error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            error: "validation_error",
            message: "The query parameters didn't match the expected shape.",
            reasons: [
              {
                code: "schema_failure",
                meta: {
                  field: "limit",
                  message: "Number must be less than or equal to 100",
                },
              },
            ],
          }),
      });

      setOutputFormat("json");
      try {
        await expect(
          listSimulationRunsCommand({ limit: "200" }),
        ).rejects.toThrow(ProcessExitError);
      } finally {
        setOutputFormat(undefined);
      }

      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      const doc = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
      expect(doc.error.code).toBe("validation_error");
      expect(doc.error.httpStatus).toBe(422);
      expect(JSON.stringify(doc.error.reasons)).toContain("100");
      expect((doc.error.suggestions ?? []).join(" ")).not.toContain("network");
    });
  });

  describe("when a status filter finds nothing on the first page", () => {
    /** @scenario "A status filter follows the cursor instead of reporting an empty page" */
    it("follows the cursor until a page holds a match", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runs: [makeRun({ status: "SUCCESS" })],
            hasMore: true,
            nextCursor: "cursor-1",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runs: [
              makeRun({ scenarioRunId: "run_failed", status: "FAILED" }),
              makeRun({ status: "SUCCESS" }),
            ],
            hasMore: false,
          }),
        });

      const result = await listSimulationRunsCommand({ status: "FAILED" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(String(mockFetch.mock.calls[1]?.[0])).toContain("cursor=cursor-1");
      const data = result?.data as {
        runs: Array<{ scenarioRunId: string }>;
        scanned: number;
      };
      expect(data.runs).toHaveLength(1);
      expect(data.runs[0]?.scenarioRunId).toBe("run_failed");
      expect(data.scanned).toBe(3);
    });

    /** @scenario "An exhausted status filter says what it scanned" */
    it("says how many runs it scanned when nothing matched", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          runs: [makeRun({ status: "SUCCESS" })],
          hasMore: false,
        }),
      });

      const result = await listSimulationRunsCommand({ status: "FAILED" });
      result?.table?.();

      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("status FAILED");
      expect(printed).toContain("newest 1 run");
      expect(printed).not.toContain("No simulation runs found");
    });
  });
});

describe("getSimulationRunCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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

  describe("when a machine format is requested", () => {
    it("returns the run detail as the payload instead of printing", async () => {
      const run = makeRun();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => run,
      });

      const result = await getSimulationRunCommand("run_abc123");

      expect(result?.data).toEqual(run);
      expect(console.log).not.toHaveBeenCalled();
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

/**
 * The note belongs to the batch and the version is the scenario version the
 * run used. Both read as named fields: the run's raw metadata is internal and
 * never part of what the CLI shows or returns.
 *
 * Spec: specs/features/simulation-runs-cli.feature
 */
describe("the note and the scenario version", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  const printed = () => vi.mocked(console.log).mock.calls.flat().join("\n");

  describe("listSimulationRunsCommand()", () => {
    /** @scenario "List simulation runs shows the note and the scenario version" */
    it("shows the note of the batch and the version each run used", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          runs: [makeRun({ note: "after the retry fix", scenarioVersion: 3 })],
          hasMore: false,
        }),
      });

      const result = await listSimulationRunsCommand({});
      result!.table();

      expect(printed()).toContain("after the retry fix");
      expect(printed()).toContain("v3");
    });

    /** @scenario "List simulation runs where a run has no note" */
    it("leaves the note empty and keeps every other field in place", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          runs: [makeRun({ note: null, scenarioVersion: null })],
          hasMore: false,
        }),
      });

      const result = await listSimulationRunsCommand({});
      result!.table();

      const output = printed();
      // Both keep their place with a dash, so the block reads the same down
      // the whole list whether or not a run carries them.
      expect(output).toContain("Note: —");
      expect(output).toContain("Version: —");
      expect(output).toContain("run_abc123");
      expect(output).toContain("Login Flow Test");
    });

    /** @scenario "JSON output carries the note and the version as named fields" */
    it("carries note and scenarioVersion as fields, and no raw metadata", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          runs: [makeRun({ note: "after the retry fix", scenarioVersion: 3 })],
          hasMore: false,
        }),
      });

      const result = await listSimulationRunsCommand({});

      const runs = (result!.data as { runs: Record<string, unknown>[] }).runs;
      expect(runs[0]).toMatchObject({
        note: "after the retry fix",
        scenarioVersion: 3,
      });
      expect(runs[0]).not.toHaveProperty("metadata");
    });
  });

  describe("getSimulationRunCommand()", () => {
    /** @scenario "Get simulation run shows the note and the scenario version" */
    it("shows the note of the batch and the version the run used", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          makeRun({ note: "after the retry fix", scenarioVersion: 3 }),
      });

      const result = await getSimulationRunCommand("run_abc123");
      result!.table();

      expect(printed()).toContain("after the retry fix");
      expect(printed()).toContain("v3");
    });

    /** @scenario "Get a simulation run stored before versions were recorded" */
    it("shows no version for a run stored before versions were recorded", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRun({ note: null, scenarioVersion: null }),
      });

      const result = await getSimulationRunCommand("run_abc123");
      result!.table();

      const output = printed();
      expect(output).not.toContain("Version:");
      // The rest of the details are shown exactly as before.
      expect(output).toContain("run_abc123");
      expect(output).toContain("Login Flow Test");
      expect(output).toContain("Verdict:");
    });
  });
});
