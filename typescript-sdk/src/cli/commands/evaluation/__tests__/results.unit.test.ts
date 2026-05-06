import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvaluationsApiError } from "@/client-sdk/services/evaluations/evaluations-api.service";

vi.mock("@/client-sdk/services/evaluations/evaluations-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/evaluations/evaluations-api.service")>();
  return {
    ...actual,
    EvaluationsApiService: vi.fn(),
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

import { EvaluationsApiService } from "@/client-sdk/services/evaluations/evaluations-api.service";
import { evaluationResultsCommand } from "../results";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppress
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

const sampleResults = {
  experimentId: "exp_1",
  runId: "run_1",
  projectId: "proj_1",
  progress: 3,
  total: 3,
  dataset: [
    { index: 0, entry: { input: "hello world" } },
    { index: 1, entry: { input: "broken row" }, error: "boom" },
    { index: 2, entry: { input: "passed but low score" } },
  ],
  evaluations: [
    { evaluator: "quality", index: 0, status: "processed", score: 0.9, passed: true },
    { evaluator: "quality", index: 2, status: "processed", score: 0.2, passed: false, details: "low score" },
    { evaluator: "safety", index: 0, status: "processed", score: 1.0, passed: true },
  ],
  timestamps: { createdAt: 0, updatedAt: 0 },
};

describe("evaluationResultsCommand()", () => {
  let mockGetRunResults: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunResults = vi.fn();
    vi.mocked(EvaluationsApiService).mockImplementation(() => ({
      startRun: vi.fn(),
      getRunStatus: vi.fn(),
      getRunResults: mockGetRunResults,
    }) as unknown as EvaluationsApiService);
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("given a completed run", () => {
    describe("when invoked without filters", () => {
      it("calls the service with the run id", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await evaluationResultsCommand("run_1");
        expect(mockGetRunResults).toHaveBeenCalledWith({ runId: "run_1" });
      });
    });

    describe("when format is json", () => {
      it("dumps the full payload to stdout", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await evaluationResultsCommand("run_1", { format: "json" });
        expect(logSpy).toHaveBeenCalledWith(
          JSON.stringify(sampleResults, null, 2),
        );
      });
    });

    describe("when filter is failed", () => {
      it("prints only failing rows", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await evaluationResultsCommand("run_1", { filter: "failed" });
        const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
        // Row 1 (errored) and row 2 (failed quality) should appear
        expect(printed).toMatch(/\b1\b/);
        expect(printed).toMatch(/\b2\b/);
        // Row 0 (all-pass) should NOT appear in the data area
        // Heuristic: "hello world" was the entry summary for row 0
        expect(printed).not.toContain("hello world");
      });
    });

    describe("when an evaluator name is provided", () => {
      it("narrows the column set to that evaluator", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await evaluationResultsCommand("run_1", { evaluator: "quality" });
        const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(printed).toContain("quality");
        // safety column should not appear in the header
        const headerLine = logSpy.mock.calls
          .map((c) => String(c[0]))
          .find((line) => line.includes("Target")) ?? "";
        expect(headerLine).not.toContain("safety");
      });
    });

    describe("when the row count exceeds the limit", () => {
      it("truncates output and prints a hint", async () => {
        const big = {
          ...sampleResults,
          dataset: Array.from({ length: 50 }, (_, i) => ({
            index: i,
            entry: { input: `row ${i}` },
          })),
          evaluations: [],
        };
        mockGetRunResults.mockResolvedValue(big);
        await evaluationResultsCommand("run_1", { limit: "5" });
        const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(printed).toContain("Showing 5 of 50");
      });
    });
  });

  describe("given the API call fails", () => {
    describe("when the run is missing", () => {
      it("exits with code 1", async () => {
        mockGetRunResults.mockRejectedValue(
          new EvaluationsApiError("Not found", "get run results"),
        );
        await expect(
          evaluationResultsCommand("missing"),
        ).rejects.toThrow(ProcessExitError);
      });
    });
  });
});
