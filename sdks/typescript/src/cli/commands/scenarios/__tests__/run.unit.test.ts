/**
 * `scenario run` has no suite of its own: it creates an ephemeral one, runs
 * that, and deletes it. The parameter values a caller supplies therefore have
 * to travel on the RUN, not on the suite it invented, which is what these
 * assertions pin.
 *
 * Spec: specs/scenarios/scenario-run-parameters.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/suites", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/suites")>();
  return {
    ...actual,
    SuitesApiService: vi.fn(),
  };
});

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
    warn: vi.fn(),
    text: "",
  }),
}));

import { SuitesApiService } from "@/client-sdk/services/suites";
import { runScenarioCommand } from "../run";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

describe("runScenarioCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn().mockResolvedValue({ id: "suite_ephemeral" });
    mockRun = vi.fn().mockResolvedValue({
      scheduled: true,
      batchRunId: "batch_1",
      jobCount: 1,
      skippedArchived: { scenarios: [], targets: [] },
      items: [],
    });
    vi.mocked(SuitesApiService).mockImplementation(function () {
      return {
        create: mockCreate,
        run: mockRun,
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as SuitesApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  describe("when --param pairs are given", () => {
    it("supplies them to the run rather than to the ephemeral suite", async () => {
      await runScenarioCommand("scenario_1", {
        target: "http:agent_abc123",
        param: ["account_tier=gold", "seats=12", "beta=true"],
      });

      expect(mockRun).toHaveBeenCalledWith("suite_ephemeral", {
        parameters: { account_tier: "gold", seats: 12, beta: true },
        note: undefined,
      });
      expect(mockCreate.mock.calls[0]![0]).not.toHaveProperty("parameters");
    });
  });

  describe("when no --param pairs are given", () => {
    it("supplies no values, leaving every scenario on its own defaults", async () => {
      await runScenarioCommand("scenario_1", { target: "http:agent_abc123" });

      expect(mockRun).toHaveBeenCalledWith("suite_ephemeral", {
        parameters: undefined,
        note: undefined,
      });
    });
  });

  describe("when a --param pair has no equals sign", () => {
    it("refuses before creating the ephemeral suite", async () => {
      await expect(
        runScenarioCommand("scenario_1", {
          target: "http:agent_abc123",
          param: ["account_tier"],
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // The note rides the same run body a suite run uses: the ephemeral suite is
  // the vehicle, and the note belongs to the batch it starts.
  describe("when --note is given", () => {
    /** @scenario "Run a scenario with a note" */
    it("schedules the run with that note", async () => {
      await runScenarioCommand("scenario_1", {
        target: "http:agent_abc123",
        note: "after the timeout fix",
      });

      expect(mockRun).toHaveBeenCalledWith("suite_ephemeral", {
        parameters: undefined,
        note: "after the timeout fix",
      });
    });

    /** @scenario "Run a scenario with a note" */
    it("shows the note in the confirmation", async () => {
      await runScenarioCommand("scenario_1", {
        target: "http:agent_abc123",
        note: "after the timeout fix",
      });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("after the timeout fix");
    });
  });

  describe("when --note is longer than the limit", () => {
    /** @scenario "Run a scenario with a note over two hundred characters" */
    it("refuses before anything is scheduled", async () => {
      await expect(
        runScenarioCommand("scenario_1", {
          target: "http:agent_abc123",
          note: "x".repeat(201),
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  describe("when --note holds only spaces", () => {
    /** @scenario "Run a scenario with a note of only spaces" */
    it("schedules the run with no note", async () => {
      await runScenarioCommand("scenario_1", {
        target: "http:agent_abc123",
        note: "   ",
      });

      expect(mockRun).toHaveBeenCalledWith("suite_ephemeral", {
        parameters: undefined,
        note: undefined,
      });
    });
  });
});
