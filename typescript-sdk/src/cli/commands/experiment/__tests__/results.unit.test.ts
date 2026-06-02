import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExperimentsApiServiceError } from "@/client-sdk/services/experiments/experiments-api.service";
import type * as EvaluationsApiModule from "@/client-sdk/services/experiments/experiments-api.service";

const oraMocks = vi.hoisted(() => ({
  fail: vi.fn(),
}));

vi.mock("@/client-sdk/services/experiments/experiments-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof EvaluationsApiModule>();
  return {
    ...actual,
    ExperimentsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: oraMocks.fail,
    warn: vi.fn(),
    text: "",
  }),
}));

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { experimentResultsCommand } from "../results";

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

describe("experimentResultsCommand()", () => {
  let mockGetRunResults: ReturnType<typeof vi.fn>;
  let mockListRuns: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunResults = vi.fn();
    // Default: one run exists, so the slug-first command resolves it as latest.
    mockListRuns = vi.fn().mockResolvedValue({
      runs: [{ runId: "run_1" }, { runId: "older_run" }],
    });
    vi.mocked(ExperimentsApiService).mockImplementation(() => ({
      startRun: vi.fn(),
      getRunStatus: vi.fn(),
      getRunResults: mockGetRunResults,
      listRuns: mockListRuns,
    }) as unknown as ExperimentsApiService);
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given an experiment slug", () => {
    describe("when no run id is given", () => {
      it("resolves the latest run and fetches its results", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await experimentResultsCommand({ experimentSlug: "doc-qa" });
        expect(mockListRuns).toHaveBeenCalledWith({
          experimentSlug: "doc-qa",
          pageSize: 1,
        });
        expect(mockGetRunResults).toHaveBeenCalledWith({
          runId: "run_1",
          experimentSlug: "doc-qa",
        });
      });
    });

    describe("when --run-id pins a specific run", () => {
      it("uses that run id and does not look up the latest", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { runId: "pinned_run" },
        });
        expect(mockListRuns).not.toHaveBeenCalled();
        expect(mockGetRunResults).toHaveBeenCalledWith({
          runId: "pinned_run",
          experimentSlug: "doc-qa",
        });
      });
    });

    describe("when no runs exist for the experiment", () => {
      it("exits with code 1", async () => {
        mockListRuns.mockResolvedValue({ runs: [] });
        await expect(
          experimentResultsCommand({ experimentSlug: "doc-qa" }),
        ).rejects.toMatchObject({ code: 1 });
        expect(mockGetRunResults).not.toHaveBeenCalled();
      });
    });

    describe("when format is json", () => {
      it("applies filters and dumps the matching payload to stdout", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { format: "json", filter: "failed", limit: "1" },
        });
        const payload = JSON.parse(String(logSpy.mock.calls[0]![0]));
        expect(payload.dataset).toHaveLength(1);
        expect(payload.dataset[0].entry.input).toBe("broken row");
        expect(payload.evaluations).toHaveLength(0);
        expect(payload.meta).toMatchObject({
          totalMatching: 2,
          truncated: true,
          limit: 1,
          filter: "failed",
        });
      });
    });

    describe("when filter is failed", () => {
      it("prints only failing rows", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { filter: "failed" },
        });
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toMatch(/\b1\b/);
        expect(printed).toMatch(/\b2\b/);
        expect(printed).not.toContain("hello world");
      });
    });

    describe("when an evaluator name is provided", () => {
      it("narrows the column set to that evaluator", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { evaluator: "quality" },
        });
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("quality");
        const headerLine = logSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .find((line: string) => line.includes("Target")) ?? "";
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
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { limit: "5" },
        });
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("Showing 5 of 50");
      });
    });
  });

  describe("given a run still in progress", () => {
    describe("when invoked in table mode", () => {
      it("prints a partial-results banner", async () => {
        mockGetRunResults.mockResolvedValue({
          ...sampleResults,
          timestamps: {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            finishedAt: null,
            stoppedAt: null,
          },
        });
        await experimentResultsCommand({ experimentSlug: "doc-qa" });
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("Run status: running");
        expect(printed).toContain("partial results");
      });
    });

    describe("when format is json", () => {
      it("omits the banner so the payload stays machine-readable", async () => {
        mockGetRunResults.mockResolvedValue({
          ...sampleResults,
          timestamps: {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            finishedAt: null,
            stoppedAt: null,
          },
        });
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { format: "json" },
        });
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).not.toContain("Run status:");
      });
    });
  });

  describe("given a non-terminal run with zero rows", () => {
    describe("when the run was interrupted", () => {
      it("does not tell the user to wait for more rows", async () => {
        mockGetRunResults.mockResolvedValue({
          ...sampleResults,
          dataset: [],
          evaluations: [],
          timestamps: {
            createdAt: Date.now() - 60 * 60 * 1000,
            updatedAt: Date.now() - 30 * 60 * 1000,
            finishedAt: null,
            stoppedAt: null,
          },
        });
        await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { runId: "interrupted" },
        });
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("interrupted");
        expect(printed).not.toContain("No rows matched the filter");
        expect(printed).not.toContain("still in progress");
      });
    });
  });

  describe("given the results fetch fails", () => {
    describe("when the run is missing", () => {
      it("exits with code 1", async () => {
        mockGetRunResults.mockRejectedValue(
          new ExperimentsApiServiceError("Run not found", "get run results"),
        );
        await expect(
          experimentResultsCommand({
            experimentSlug: "doc-qa",
            options: { runId: "missing" },
          }),
        ).rejects.toMatchObject({ code: 1 });
        expect(oraMocks.fail).toHaveBeenCalledWith(
          expect.stringContaining("Run not found"),
        );
      });
    });
  });
});
