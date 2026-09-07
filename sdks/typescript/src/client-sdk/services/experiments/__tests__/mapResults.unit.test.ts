import { describe, it, expect } from "vitest";
import { mapRunResultsToRows } from "../mapResults";
import type { ExperimentRunResultsResponse } from "../experiments-api.service";

const baseResponse = (
  overrides: Partial<ExperimentRunResultsResponse>,
): ExperimentRunResultsResponse => ({
  experimentId: "exp_1",
  runId: "run_1",
  projectId: "proj_1",
  dataset: [],
  evaluations: [],
  timestamps: { createdAt: 0, updatedAt: 0 },
  ...overrides,
});

describe("mapRunResultsToRows", () => {
  describe("given dataset entries with a single target", () => {
    describe("when evaluations are joined on index", () => {
      it("flattens entry fields into input and reads output from predicted.output", () => {
        const response = baseResponse({
          dataset: [
            {
              index: 0,
              entry: { question: "What is 2 + 2?", expected: "4" },
              predicted: { output: "4" },
              traceId: "trace_0",
              cost: 0.01,
              duration: 1200,
            },
          ],
          evaluations: [
            {
              evaluator: "exact_match",
              name: "exact_match",
              status: "processed",
              index: 0,
              score: 1,
              passed: true,
            },
          ],
        });

        const rows = mapRunResultsToRows(response);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          index: 0,
          input: { question: "What is 2 + 2?", expected: "4" },
          output: "4",
          traceId: "trace_0",
          cost: 0.01,
          duration: 1200,
          evaluations: { exact_match: { score: 1, passed: true } },
        });
        expect(rows[0]!.target).toBeUndefined();
        expect(rows[0]!.error).toBeUndefined();
      });
    });

    describe("when predicted has no output key", () => {
      it("uses the whole predicted value as output", () => {
        const response = baseResponse({
          dataset: [
            {
              index: 0,
              entry: { question: "hi" },
              predicted: { answer: "hello" },
              traceId: "trace_0",
            },
          ],
        });

        const rows = mapRunResultsToRows(response);

        expect(rows[0]!.output).toEqual({ answer: "hello" });
      });
    });

    describe("when a row has an error", () => {
      it("carries the error message and falls back to empty traceId", () => {
        const response = baseResponse({
          dataset: [
            {
              index: 0,
              entry: { question: "hi" },
              error: "boom",
            },
          ],
        });

        const rows = mapRunResultsToRows(response);

        expect(rows[0]!.error).toBe("boom");
        expect(rows[0]!.traceId).toBe("");
        expect(rows[0]!.cost).toBeUndefined();
        expect(rows[0]!.duration).toBeUndefined();
      });
    });

    describe("when an evaluation has no explicit name", () => {
      it("falls back to the evaluator id as the metric key", () => {
        const response = baseResponse({
          dataset: [{ index: 0, entry: {}, traceId: "t" }],
          evaluations: [
            {
              evaluator: "ragas/faithfulness",
              status: "processed",
              index: 0,
              score: 0.8,
            },
          ],
        });

        const rows = mapRunResultsToRows(response);

        expect(rows[0]!.evaluations).toEqual({
          "ragas/faithfulness": { score: 0.8 },
        });
      });
    });
  });

  describe("given dataset entries with multiple targets", () => {
    describe("when evaluations carry a targetId", () => {
      it("joins each evaluation onto the matching (index, targetId) row only", () => {
        const response = baseResponse({
          dataset: [
            {
              index: 0,
              targetId: "target_a",
              entry: { question: "q0" },
              predicted: { output: "a0" },
              traceId: "trace_a0",
            },
            {
              index: 0,
              targetId: "target_b",
              entry: { question: "q0" },
              predicted: { output: "b0" },
              traceId: "trace_b0",
            },
          ],
          evaluations: [
            {
              evaluator: "quality",
              name: "quality",
              targetId: "target_a",
              status: "processed",
              index: 0,
              score: 0.9,
              passed: true,
            },
            {
              evaluator: "quality",
              name: "quality",
              targetId: "target_b",
              status: "processed",
              index: 0,
              score: 0.3,
              passed: false,
            },
          ],
        });

        const rows = mapRunResultsToRows(response);

        expect(rows).toHaveLength(2);

        const rowA = rows.find((r) => r.target === "target_a")!;
        const rowB = rows.find((r) => r.target === "target_b")!;

        expect(rowA.output).toBe("a0");
        expect(rowA.evaluations).toEqual({
          quality: { score: 0.9, passed: true },
        });

        expect(rowB.output).toBe("b0");
        expect(rowB.evaluations).toEqual({
          quality: { score: 0.3, passed: false },
        });
      });
    });
  });

  describe("given an empty dataset", () => {
    it("returns no rows", () => {
      expect(mapRunResultsToRows(baseResponse({}))).toEqual([]);
    });
  });
});
