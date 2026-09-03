import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExperimentsApiServiceError } from "@/client-sdk/services/experiments/experiments-api.service";
import type * as EvaluationsApiModule from "@/client-sdk/services/experiments/experiments-api.service";

const oraMocks = vi.hoisted(() => ({
  fail: vi.fn(),
}));

vi.mock(
  "@/client-sdk/services/experiments/experiments-api.service",
  async (importOriginal) => {
    const actual = await importOriginal<typeof EvaluationsApiModule>();
    return {
      ...actual,
      ExperimentsApiService: vi.fn(),
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
    {
      evaluator: "quality",
      index: 2,
      status: "processed",
      score: 0.2,
      passed: false,
      details: "low score",
    },
    { evaluator: "safety", index: 0, status: "processed", score: 1.0, passed: true },
  ],
  timestamps: { createdAt: 0, updatedAt: 0 },
};

/**
 * A run with a Comparison evaluator.
 *
 * The shape is the point: dataset entries are per (row, target), and the
 * comparison's verdict is per row only — recorded against its own id, which
 * is not one of the targets. Anything keyed that way has no dataset entry to
 * hang off, which is exactly how 60 real verdicts went missing on a live run
 * while the run summary still advertised the comparison.
 */
const comparisonResults = {
  experimentId: "exp_2",
  runId: "run_2",
  projectId: "proj_1",
  progress: 4,
  total: 4,
  dataset: [
    { index: 0, targetId: "target_a", entry: { input: "q1" } },
    { index: 0, targetId: "target_b", entry: { input: "q1" } },
    { index: 1, targetId: "target_a", entry: { input: "q2" } },
    { index: 1, targetId: "target_b", entry: { input: "q2" } },
  ],
  evaluations: [
    {
      evaluator: "quality",
      targetId: "target_a",
      index: 0,
      status: "processed",
      score: 0.9,
      passed: true,
    },
    {
      evaluator: "quality",
      targetId: "target_b",
      index: 0,
      status: "processed",
      score: 0.4,
      passed: true,
    },
    // Keyed to the comparison, not to a target — no dataset row matches this.
    {
      evaluator: "target_comparison",
      targetId: "target_comparison",
      index: 0,
      status: "processed",
      score: 1,
      label: "target_a",
      details: "A was clearer.",
    },
    {
      evaluator: "target_comparison",
      targetId: "target_comparison",
      index: 1,
      status: "processed",
      score: 1,
      label: "target_b",
      details: "B was more accurate.",
    },
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
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        startRun: vi.fn(),
        getRunStatus: vi.fn(),
        getRunResults: mockGetRunResults,
        listRuns: mockListRuns,
      } as unknown as ExperimentsApiService;
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given an experiment slug", () => {
    describe("when no run id is given", () => {
      /** @scenario "User views the latest run of an experiment as a table" */
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
      /** @scenario "User pins a specific run by id" */
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
      /** @scenario "User requests an experiment with no runs" */
      it("exits with code 1", async () => {
        mockListRuns.mockResolvedValue({ runs: [] });
        await expect(
          experimentResultsCommand({ experimentSlug: "doc-qa" }),
        ).rejects.toMatchObject({ code: 1 });
        expect(mockGetRunResults).not.toHaveBeenCalled();
      });
    });

    describe("when format is json", () => {
      /** @scenario "User pipes the full payload as JSON" */
      it("applies filters and dumps the matching payload to stdout", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { filter: "failed", limit: "1" },
        });
        const payload = result?.data as {
          dataset: { entry: { input: string } }[];
          evaluations: unknown[];
          meta: Record<string, unknown>;
        };
        // `--limit 1` shortens the printed table. Both failing rows are still
        // in the answer, and `meta` says so, so a caller doing arithmetic on
        // the payload divides by the real number of rows.
        expect(payload.dataset).toHaveLength(2);
        expect(payload.dataset[0]!.entry.input).toBe("broken row");
        expect(payload.meta).toMatchObject({
          totalMatching: 2,
          returned: 2,
          tableLimit: 1,
          tableTruncated: true,
          filter: "failed",
        });
      });
    });

    describe("when the row limit is smaller than the run", () => {
      /** @scenario "The row limit shortens the table and never the answer" */
      it("keeps every row in the answer while the table shows the limit", async () => {
        const big = {
          ...sampleResults,
          dataset: Array.from({ length: 50 }, (_, i) => ({
            index: i,
            entry: { input: `row ${i}` },
          })),
          evaluations: [],
        };
        mockGetRunResults.mockResolvedValue(big);

        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { limit: "5" },
        });
        const payload = result?.data as {
          dataset: unknown[];
          meta: Record<string, unknown>;
        };

        expect(payload.dataset).toHaveLength(50);
        expect(payload.meta).toMatchObject({
          totalMatching: 50,
          returned: 50,
          tableLimit: 5,
          tableTruncated: true,
        });

        result?.table();
        const printed = logSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .join("\n");
        expect(printed).toContain("Showing 5 of 50");
      });
    });

    describe("when filter is failed", () => {
      /** @scenario "User filters the table to only failed rows" */
      it("prints only failing rows", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { filter: "failed" },
        });
        result?.table();
        // Strip ANSI colour codes: whether chalk colours here depends on the
        // environment (vitest propagates FORCE_COLOR from a colour terminal),
        // and `\b1\b` never matches when the digit sits inside an escape code.
        const printed = logSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .join("\n")
          // eslint-disable-next-line no-control-regex
          .replace(/\[[0-9;]*m/g, "");
        expect(printed).toMatch(/\b1\b/);
        expect(printed).toMatch(/\b2\b/);
        expect(printed).not.toContain("hello world");
      });
    });

    describe("when an evaluator name is provided", () => {
      /** @scenario "User narrows the table to a specific evaluator" */
      it("narrows the column set to that evaluator", async () => {
        mockGetRunResults.mockResolvedValue(sampleResults);
        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { evaluator: "quality" },
        });
        result?.table();
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("quality");
        const headerLine =
          logSpy.mock.calls
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
        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { limit: "5" },
        });
        result?.table();
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("Showing 5 of 50");
      });
    });
  });

  describe("given a run still in progress", () => {
    describe("when invoked in table mode", () => {
      /** @scenario "User views a run that is still running" */
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
        const result = await experimentResultsCommand({ experimentSlug: "doc-qa" });
        result?.table();
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
        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
        });
        expect(JSON.stringify(result?.data)).not.toContain("Run status:");
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
        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { runId: "interrupted" },
        });
        result?.table();
        const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("interrupted");
        expect(printed).not.toContain("No rows matched the filter");
        expect(printed).not.toContain("still in progress");
      });
    });
  });

  describe("given a run with a Comparison evaluator", () => {
    describe("when the results are returned", () => {
      /** @scenario "A comparison verdict reaches the CLI even though it belongs to no single target" */
      it("keeps the verdicts that belong to no single target", async () => {
        mockGetRunResults.mockResolvedValue(comparisonResults);

        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
        });

        const evaluations = (result as any).data.evaluations;
        const verdicts = evaluations.filter(
          (e: any) => e.evaluator === "target_comparison",
        );
        expect(verdicts).toHaveLength(2);
        expect(verdicts.map((v: any) => v.label)).toEqual(["target_a", "target_b"]);
        // The judge's reasoning is the reason to reach for this at all.
        expect(verdicts[0].details).toBe("A was clearer.");
      });

      it("still reports every target-scoped evaluation", async () => {
        // The comparison must be additive — a fix that surfaced verdicts by
        // displacing the per-target scores would trade one gap for another.
        mockGetRunResults.mockResolvedValue(comparisonResults);

        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
        });

        const evaluations = (result as any).data.evaluations;
        expect(evaluations.filter((e: any) => e.evaluator === "quality")).toHaveLength(2);
      });
    });

    describe("when --filter failed drops some rows", () => {
      /** @scenario "Comparison verdicts follow the rows that survive filtering" */
      it("reports verdicts only for the rows that failed", async () => {
        // Row 1 fails, row 0 passes, so only row 1 survives the filter and
        // only its verdict should be described.
        mockGetRunResults.mockResolvedValue({
          ...comparisonResults,
          evaluations: [
            ...comparisonResults.evaluations,
            {
              evaluator: "quality",
              targetId: "target_a",
              index: 1,
              status: "processed",
              score: 0.1,
              passed: false,
            },
          ],
        });

        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { filter: "failed" },
        });

        const evaluations = (result as any).data.evaluations;
        const verdicts = evaluations.filter(
          (e: any) => e.evaluator === "target_comparison",
        );
        expect(verdicts.map((v: any) => v.index)).toEqual([1]);
      });
    });

    describe("when the row limit is smaller than the run", () => {
      /** @scenario "The row limit shortens the table and never the answer" */
      it("keeps every verdict, because the limit only shortens the table", async () => {
        mockGetRunResults.mockResolvedValue(comparisonResults);

        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { limit: "2" },
        });

        const evaluations = (result as any).data.evaluations;
        const verdicts = evaluations.filter(
          (e: any) => e.evaluator === "target_comparison",
        );
        // Both judged rows are in the answer, not only the two rows the table
        // would have printed.
        expect(verdicts.map((v: any) => v.index).sort()).toEqual([0, 1]);
      });
    });

    describe("when --evaluator names a different evaluator", () => {
      /** @scenario "Narrowing to one evaluator excludes the comparison" */
      it("excludes the comparison", async () => {
        mockGetRunResults.mockResolvedValue(comparisonResults);

        const result = await experimentResultsCommand({
          experimentSlug: "doc-qa",
          options: { evaluator: "quality" },
        });

        const evaluations = (result as any).data.evaluations;
        expect(evaluations.some((e: any) => e.evaluator === "target_comparison")).toBe(
          false,
        );
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

/**
 * A run where the ONLY failure is the comparison itself. Every target
 * produced output and every per-target evaluation passed; the comparison
 * errored. `--filter failed` has to be able to show that row.
 */
const comparisonFailedResults = {
  experimentId: "exp_3",
  runId: "run_3",
  projectId: "proj_1",
  progress: 2,
  total: 2,
  dataset: [
    { index: 0, targetId: "target_a", entry: { input: "q1" } },
    { index: 0, targetId: "target_b", entry: { input: "q1" } },
  ],
  evaluations: [
    {
      evaluator: "quality",
      targetId: "target_a",
      index: 0,
      status: "processed",
      score: 0.9,
      passed: true,
    },
    {
      evaluator: "quality",
      targetId: "target_b",
      index: 0,
      status: "processed",
      score: 0.8,
      passed: true,
    },
    // Row-independent, and the only thing that went wrong.
    {
      evaluator: "target_comparison",
      targetId: "target_comparison",
      index: 0,
      status: "error",
      details: "judge timed out",
    },
  ],
  timestamps: { createdAt: 0, updatedAt: 0 },
};

describe("experimentResultsCommand() — failures the row join cannot see", () => {
  let mockGetRunResults2: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunResults2 = vi.fn().mockResolvedValue(comparisonFailedResults);
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        startRun: vi.fn(),
        getRunStatus: vi.fn(),
        getRunResults: mockGetRunResults2,
        listRuns: vi.fn().mockResolvedValue({ runs: [{ runId: "run_3" }] }),
      } as unknown as ExperimentsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("given only the comparison failed", () => {
    /** @scenario "A row whose only failure is the comparison is still a failed row" */
    it("still surfaces the row under --filter failed", async () => {
      // The failure filter walks the dataset join, and a comparison verdict
      // has no dataset entry to hang off — so a row that failed ONLY on the
      // comparison was silently filtered out. That is the evaluator this
      // command was just taught to display.
      const result = (await experimentResultsCommand({
        experimentSlug: "exp",
        options: { filter: "failed" },
      })) as { data: { dataset: unknown[]; evaluations: { evaluator: string }[] } };

      expect(result.data.dataset.length).toBeGreaterThan(0);
      expect(
        result.data.evaluations.some((e) => e.evaluator === "target_comparison"),
      ).toBe(true);
    });
  });

  describe("given nothing failed at all", () => {
    it("shows no rows under --filter failed", async () => {
      mockGetRunResults2.mockResolvedValue({
        ...comparisonFailedResults,
        evaluations: comparisonFailedResults.evaluations.map((e) =>
          e.status === "error"
            ? { ...e, status: "processed", score: 1, label: "target_a" }
            : e,
        ),
      });

      const result = (await experimentResultsCommand({
        experimentSlug: "exp",
        options: { filter: "failed" },
      })) as { data: { dataset: unknown[] } };

      expect(result.data.dataset.length).toBe(0);
    });
  });
});
