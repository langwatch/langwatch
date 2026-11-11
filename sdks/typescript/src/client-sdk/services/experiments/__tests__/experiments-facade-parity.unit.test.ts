/**
 * Parity with the Python SDK: `run()` sends every input override, and printSummary fails
 * on an errored cell, or on a failed evaluation only when asked to.
 * @see sdks/typescript/specs/evaluation/experiment-run-gate.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLangWatchApiClient } from "@/internal/api/client";
import { NoOpLogger } from "@/logger";

import { ExperimentsFacade } from "../experiments.facade";
import { MISSING_TALLIES_MESSAGE } from "../run-gate";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const requestAt = (call: number): Request => mockFetch.mock.calls[call]![0] as Request;

const ENDPOINT = "https://api.langwatch.test";

const makeFacade = () =>
  new ExperimentsFacade({
    langwatchApiClient: createLangWatchApiClient("sk-lw-test", ENDPOINT),
    endpoint: ENDPOINT,
    apiKey: "sk-lw-test",
    logger: new NoOpLogger(),
  });

const completedWith = (summary: Record<string, unknown>) => ({
  runId: "run_1",
  status: "completed",
  progress: 3,
  total: 3,
  summary: { runId: "run_1", totalCells: 3, completedCells: 3, duration: 900, ...summary },
});

describe("ExperimentsFacade parity with the Python SDK", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when run() is given input overrides", () => {
    /** @scenario "run() sends every input override in the start request" */
    it("sends data, parameters and row indices in the start body, as runWithResults does", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ runId: "run_1", status: "running", total: 3 }))
        .mockResolvedValueOnce(jsonResponse(completedWith({ failedCells: 0 })));

      await makeFacade().run("my-eval", {
        data: [{ question: "2 + 2?" }],
        parameters: { temperature: 0 },
        rowIndices: [0, 2],
        concurrency: 1,
        pollInterval: 0,
      });

      expect(await requestAt(0).clone().json()).toEqual({
        data: [{ question: "2 + 2?" }],
        parameters: { temperature: 0 },
        row_indices: [0, 2],
        concurrency: 1,
      });
    });
  });

  describe("when printSummary gates a completed run", () => {
    const failingVerdict = [
      { evaluatorId: "ev_1", name: "exact_match", passed: 2, failed: 1, passRate: 66.7 },
    ];
    const exitCodeFor = async (
      summary: Record<string, unknown>,
      options?: Parameters<Awaited<ReturnType<ExperimentsFacade["run"]>>["printSummary"]>[0],
    ) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ runId: "run_1", status: "running", total: 3 }))
        .mockResolvedValueOnce(jsonResponse(completedWith(summary)));
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const result = await makeFacade().run("my-eval", { pollInterval: 0 });
      result.printSummary(options);
      return exit.mock.calls[0]?.[0];
    };

    /** @scenario "By default an errored cell fails the job" */
    it("exits 1 when a cell errored", async () => {
      expect(await exitCodeFor({ failedCells: 1 })).toBe(1);
    });

    /** @scenario "By default a failed evaluation leaves the job green" */
    it("does not exit when an evaluation failed but no cell errored", async () => {
      expect(await exitCodeFor({ failedCells: 0, evaluators: failingVerdict })).toBeUndefined();
    });

    /** @scenario "Opting in fails the job on a failed evaluation" */
    it("exits 1 on a failed evaluation with failOnEvaluatorFailures", async () => {
      const code = await exitCodeFor(
        { failedCells: 0, evaluators: failingVerdict },
        { failOnEvaluatorFailures: true },
      );
      expect(code).toBe(1);
    });

    /** @scenario "Opting in still passes a run whose evaluations all passed" */
    it("does not exit with failOnEvaluatorFailures when every verdict passed", async () => {
      const passing = [{ ...failingVerdict[0], passed: 3, failed: 0, passRate: 100 }];
      const code = await exitCodeFor(
        { failedCells: 0, evaluators: passing },
        { failOnEvaluatorFailures: true },
      );
      expect(code).toBeUndefined();
    });

    /** @scenario "Opting in against a server without evaluator results fails the job" */
    it("exits 1 and says why when the summary has no evaluator results", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const code = await exitCodeFor({ failedCells: 0 }, { failOnEvaluatorFailures: true });
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(MISSING_TALLIES_MESSAGE);
    });

    /** @scenario "By default a summary without evaluator results leaves the job green" */
    it("does not exit by default when the summary has no evaluator results", async () => {
      expect(await exitCodeFor({ failedCells: 0 })).toBeUndefined();
    });

    /** @scenario "Opting in fails the job when an evaluator crashed on every row" */
    it("exits 1 with failOnEvaluatorFailures when the evaluator only errored", async () => {
      const crashed = [
        { evaluatorId: "ev_1", name: "exact_match", passed: 0, failed: 0, errored: 3 },
      ];
      const code = await exitCodeFor(
        { failedCells: 0, evaluators: crashed },
        { failOnEvaluatorFailures: true },
      );
      expect(code).toBe(1);
    });

    /** @scenario "By default a crashed evaluator leaves the job green" */
    it("does not exit by default when the evaluator only errored", async () => {
      const crashed = [
        { evaluatorId: "ev_1", name: "exact_match", passed: 0, failed: 0, errored: 3 },
      ];
      expect(await exitCodeFor({ failedCells: 0, evaluators: crashed })).toBeUndefined();
    });

    /** @scenario "A score-only evaluator prints no verdicts, not a 0% pass rate" */
    it("prints no verdicts for an evaluator that only scored", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const scoreOnly = [
        { evaluatorId: "ev_1", name: "faithfulness", passed: 0, failed: 0, avgScore: 0.6 },
      ];
      await exitCodeFor({ failedCells: 0, evaluators: scoreOnly }, { exitOnFailure: false });
      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("faithfulness: no verdicts");
      expect(printed).not.toContain("0.0% pass rate");
    });

    /** @scenario "Turning exit off wins over the opt-in" */
    it("never exits with exitOnFailure false, even when opted in", async () => {
      const code = await exitCodeFor(
        { failedCells: 1, evaluators: failingVerdict },
        { exitOnFailure: false, failOnEvaluatorFailures: true },
      );
      expect(code).toBeUndefined();
    });

    it("still accepts the boolean form printSummary(false)", async () => {
      expect(await exitCodeFor({ failedCells: 1 }, false)).toBeUndefined();
    });
  });
});
