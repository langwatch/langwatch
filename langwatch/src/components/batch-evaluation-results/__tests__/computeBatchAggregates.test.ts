/**
 * Tests for computeBatchAggregates - aggregate statistics computation
 */
import { describe, expect, it } from "vitest";
import { computeBatchTargetAggregates } from "../computeBatchAggregates";
import type { BatchResultRow, BatchTargetColumn } from "../types";

describe("computeBatchTargetAggregates", () => {
  const createTargetColumn = (id: string): BatchTargetColumn => ({
    id,
    name: id,
    type: "custom",
    outputFields: ["output"],
  });

  describe("completedRows counting", () => {
    it("counts rows with output as completed", () => {
      const targetCol = createTargetColumn("gpt-4");
      const rows: BatchResultRow[] = [
        {
          index: 0,
          datasetEntry: { question: "Q1" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: { output: "Answer" },
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [],
            },
          },
        },
      ];

      const result = computeBatchTargetAggregates(targetCol, rows);

      expect(result.completedRows).toBe(1);
      expect(result.totalRows).toBe(1);
    });

    it("counts rows with errors as completed", () => {
      const targetCol = createTargetColumn("gpt-4");
      const rows: BatchResultRow[] = [
        {
          index: 0,
          datasetEntry: { question: "Q1" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null,
              cost: null,
              duration: null,
              error: "Some error",
              traceId: null,
              evaluatorResults: [],
            },
          },
        },
      ];

      const result = computeBatchTargetAggregates(targetCol, rows);

      expect(result.completedRows).toBe(1);
      expect(result.errorRows).toBe(1);
    });

    it("counts rows with ONLY evaluator results as completed (API evaluations)", () => {
      // This is the key case: API evaluations may have no output/error,
      // but DO have evaluator results. These should count as completed.
      const targetCol = createTargetColumn("gpt-4");
      const rows: BatchResultRow[] = [
        {
          index: 0,
          datasetEntry: { question: "Q1" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null, // No output!
              cost: null,
              duration: null,
              error: null, // No error!
              traceId: null,
              evaluatorResults: [
                {
                  evaluatorId: "quality",
                  evaluatorName: "Quality",
                  status: "processed",
                  score: 0.9,
                  passed: null,
                },
              ],
            },
          },
        },
        {
          index: 1,
          datasetEntry: { question: "Q2" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null,
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [
                {
                  evaluatorId: "quality",
                  evaluatorName: "Quality",
                  status: "processed",
                  score: 0.85,
                  passed: null,
                },
              ],
            },
          },
        },
      ];

      const result = computeBatchTargetAggregates(targetCol, rows);

      // Both rows should be counted as completed
      expect(result.completedRows).toBe(2);
      expect(result.totalRows).toBe(2);
      expect(result.errorRows).toBe(0);
    });

    it("does not count rows without output, error, OR evaluator results", () => {
      const targetCol = createTargetColumn("gpt-4");
      const rows: BatchResultRow[] = [
        {
          index: 0,
          datasetEntry: { question: "Q1" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null,
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [], // Empty!
            },
          },
        },
      ];

      const result = computeBatchTargetAggregates(targetCol, rows);

      expect(result.completedRows).toBe(0);
      expect(result.totalRows).toBe(1);
    });
  });

  describe("evaluator aggregates from API evaluations", () => {
    it("computes average score from evaluator results", () => {
      const targetCol = createTargetColumn("gpt-4");
      const rows: BatchResultRow[] = [
        {
          index: 0,
          datasetEntry: { question: "Q1" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null,
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [
                {
                  evaluatorId: "quality",
                  evaluatorName: "Quality",
                  status: "processed",
                  score: 0.9,
                  passed: null,
                },
              ],
            },
          },
        },
        {
          index: 1,
          datasetEntry: { question: "Q2" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null,
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [
                {
                  evaluatorId: "quality",
                  evaluatorName: "Quality",
                  status: "processed",
                  score: 0.8,
                  passed: null,
                },
              ],
            },
          },
        },
      ];

      const result = computeBatchTargetAggregates(targetCol, rows);

      // Average score should be (0.9 + 0.8) / 2 = 0.85
      expect(result.overallAverageScore).toBeCloseTo(0.85, 3);
      expect(result.evaluators).toHaveLength(1);
      expect(result.evaluators[0]?.averageScore).toBeCloseTo(0.85, 3);
    });

    it("computes correct scores per target (not global)", () => {
      // Create two targets with DIFFERENT scores
      const gpt4Col = createTargetColumn("gpt-4");
      const claudeCol = createTargetColumn("claude-3");

      const rows: BatchResultRow[] = [
        {
          index: 0,
          datasetEntry: { question: "Q1" },
          targets: {
            "gpt-4": {
              targetId: "gpt-4",
              output: null,
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [
                {
                  evaluatorId: "quality",
                  evaluatorName: "Quality",
                  status: "processed",
                  score: 0.95,
                  passed: null,
                },
              ],
            },
            "claude-3": {
              targetId: "claude-3",
              output: null,
              cost: null,
              duration: null,
              error: null,
              traceId: null,
              evaluatorResults: [
                {
                  evaluatorId: "quality",
                  evaluatorName: "Quality",
                  status: "processed",
                  score: 0.5,
                  passed: null,
                },
              ],
            },
          },
        },
      ];

      const gpt4Result = computeBatchTargetAggregates(gpt4Col, rows);
      const claudeResult = computeBatchTargetAggregates(claudeCol, rows);

      // GPT-4 should have high score
      expect(gpt4Result.overallAverageScore).toBeCloseTo(0.95, 3);
      // Claude should have low score
      expect(claudeResult.overallAverageScore).toBeCloseTo(0.5, 3);
      // They should be DIFFERENT
      expect(gpt4Result.overallAverageScore).not.toEqual(
        claudeResult.overallAverageScore,
      );
    });
  });
});
