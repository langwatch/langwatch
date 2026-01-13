import { describe, it, expect } from "vitest";
import {
  buildCsvHeaders,
  buildCsvData,
  generateCsvContent,
} from "../csvExport";
import type { BatchEvaluationData, BatchTargetOutput } from "../types";

const createMinimalData = (
  overrides: Partial<BatchEvaluationData> = {}
): BatchEvaluationData => ({
  runId: "run-1",
  experimentId: "exp-1",
  projectId: "project-1",
  createdAt: 1705320000000, // 2024-01-15T10:00:00Z as timestamp
  datasetColumns: [],
  targetColumns: [],
  evaluatorIds: [],
  evaluatorNames: {},
  rows: [],
  ...overrides,
});

const createTargetOutput = (
  overrides: Partial<BatchTargetOutput> = {}
): BatchTargetOutput => ({
  targetId: "target-1",
  output: null,
  cost: null,
  duration: null,
  error: null,
  traceId: null,
  evaluatorResults: [],
  ...overrides,
});

describe("csvExport", () => {
  describe("buildCsvHeaders", () => {
    it("returns empty array for empty data", () => {
      const data = createMinimalData();
      const headers = buildCsvHeaders(data);
      expect(headers).toEqual([]);
    });

    it("includes dataset column headers", () => {
      const data = createMinimalData({
        datasetColumns: [
          { name: "input", hasImages: false },
          { name: "expected_output", hasImages: false },
        ],
      });
      const headers = buildCsvHeaders(data);
      expect(headers).toContain("input");
      expect(headers).toContain("expected_output");
    });

    it("includes target output headers", () => {
      const data = createMinimalData({
        targetColumns: [
          {
            id: "target-1",
            name: "GPT-4",
            type: "prompt",
            outputFields: ["response"],
          },
        ],
        rows: [],
      });
      const headers = buildCsvHeaders(data);
      expect(headers).toContain("gpt-4_response");
      expect(headers).toContain("gpt-4_cost");
      expect(headers).toContain("gpt-4_duration");
      expect(headers).toContain("gpt-4_trace_id");
    });
  });

  describe("buildCsvData", () => {
    it("handles empty data", () => {
      const data = createMinimalData();
      const { headers, rows } = buildCsvData(data);
      expect(headers).toEqual([]);
      expect(rows).toEqual([]);
    });

    it("exports dataset values", () => {
      const data = createMinimalData({
        datasetColumns: [
          { name: "question", hasImages: false },
          { name: "answer", hasImages: false },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: { question: "What is 2+2?", answer: "4" },
            targets: {},
          },
        ],
      });
      const { rows } = buildCsvData(data);
      expect(rows[0]).toContain("What is 2+2?");
      expect(rows[0]).toContain("4");
    });

    it("exports target output values", () => {
      const data = createMinimalData({
        targetColumns: [
          { id: "target-1", name: "GPT-4", type: "prompt", outputFields: [] },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              "target-1": createTargetOutput({
                output: { response: "The answer is 4" },
                cost: 0.001,
                duration: 500,
                traceId: "trace-123",
              }),
            },
          },
        ],
      });
      const { rows } = buildCsvData(data);
      expect(rows[0]).toContain('{"response":"The answer is 4"}');
      expect(rows[0]).toContain("0.001");
      expect(rows[0]).toContain("500");
      expect(rows[0]).toContain("trace-123");
    });

    it("handles null/undefined values gracefully", () => {
      const data = createMinimalData({
        datasetColumns: [{ name: "input", hasImages: false }],
        targetColumns: [
          { id: "target-1", name: "Model", type: "prompt", outputFields: [] },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: { input: null },
            targets: {
              "target-1": createTargetOutput({
                output: null,
                cost: null,
                duration: null,
                traceId: null,
              }),
            },
          },
        ],
      });
      const { rows } = buildCsvData(data);
      // Should not throw and should have empty strings for null values
      expect(rows.length).toBe(1);
      expect(rows[0]?.[0]).toBe("");
    });

    it("exports evaluator results with score and passed", () => {
      const data = createMinimalData({
        targetColumns: [
          { id: "target-1", name: "Model", type: "prompt", outputFields: [] },
        ],
        evaluatorNames: { "eval-1": "Accuracy" },
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              "target-1": createTargetOutput({
                output: { response: "test" },
                evaluatorResults: [
                  {
                    evaluatorId: "eval-1",
                    evaluatorName: "Accuracy",
                    status: "processed",
                    score: 0.95,
                    passed: true,
                    label: "correct",
                    details: "Good match",
                  },
                ],
              }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);
      expect(headers).toContain("model_accuracy_score");
      expect(headers).toContain("model_accuracy_passed");
      expect(headers).toContain("model_accuracy_label");
      expect(headers).toContain("model_accuracy_details");
      expect(rows[0]).toContain("0.95");
      expect(rows[0]).toContain("true");
      expect(rows[0]).toContain("correct");
      expect(rows[0]).toContain("Good match");
    });

    it("exports error status for failed evaluators", () => {
      const data = createMinimalData({
        targetColumns: [
          { id: "target-1", name: "Model", type: "prompt", outputFields: [] },
        ],
        evaluatorNames: { "eval-1": "Check" },
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              "target-1": createTargetOutput({
                output: { response: "test" },
                evaluatorResults: [
                  {
                    evaluatorId: "eval-1",
                    evaluatorName: "Check",
                    status: "error",
                    details: "API timeout",
                  },
                ],
              }),
            },
          },
        ],
      });
      const { rows } = buildCsvData(data);
      expect(rows[0]).toContain("Error");
      expect(rows[0]).toContain("API timeout");
    });

    it("exports skipped status for skipped evaluators", () => {
      const data = createMinimalData({
        targetColumns: [
          { id: "target-1", name: "Model", type: "prompt", outputFields: [] },
        ],
        evaluatorNames: { "eval-1": "Check" },
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              "target-1": createTargetOutput({
                output: { response: "test" },
                evaluatorResults: [
                  {
                    evaluatorId: "eval-1",
                    evaluatorName: "Check",
                    status: "skipped",
                    details: "No input",
                  },
                ],
              }),
            },
          },
        ],
      });
      const { rows } = buildCsvData(data);
      expect(rows[0]).toContain("Skipped");
    });

    it("exports multiple rows correctly", () => {
      const data = createMinimalData({
        datasetColumns: [{ name: "input", hasImages: false }],
        rows: [
          { index: 0, datasetEntry: { input: "row1" }, targets: {} },
          { index: 1, datasetEntry: { input: "row2" }, targets: {} },
          { index: 2, datasetEntry: { input: "row3" }, targets: {} },
        ],
      });
      const { rows } = buildCsvData(data);
      expect(rows.length).toBe(3);
      expect(rows[0]).toContain("row1");
      expect(rows[1]).toContain("row2");
      expect(rows[2]).toContain("row3");
    });

    it("exports multiple targets correctly", () => {
      const data = createMinimalData({
        targetColumns: [
          { id: "t1", name: "GPT-4", type: "prompt", outputFields: [] },
          { id: "t2", name: "Claude", type: "prompt", outputFields: [] },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              t1: createTargetOutput({ targetId: "t1", output: { response: "gpt response" } }),
              t2: createTargetOutput({ targetId: "t2", output: { response: "claude response" } }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);
      expect(headers).toContain("gpt-4_output");
      expect(headers).toContain("claude_output");
      expect(rows[0]).toContain('{"response":"gpt response"}');
      expect(rows[0]).toContain('{"response":"claude response"}');
    });

    it("stringifies object values as JSON", () => {
      const data = createMinimalData({
        datasetColumns: [{ name: "config", hasImages: false }],
        rows: [
          {
            index: 0,
            datasetEntry: { config: { key: "value", nested: { a: 1 } } },
            targets: {},
          },
        ],
      });
      const { rows } = buildCsvData(data);
      expect(rows[0]?.[0]).toBe('{"key":"value","nested":{"a":1}}');
    });

    it("exports target with multiple output fields", () => {
      const data = createMinimalData({
        targetColumns: [
          {
            id: "t1",
            name: "Agent",
            type: "agent",
            outputFields: ["response", "reasoning"],
          },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              t1: createTargetOutput({
                targetId: "t1",
                output: { response: "answer", reasoning: "because..." },
              }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);
      expect(headers).toContain("agent_response");
      expect(headers).toContain("agent_reasoning");
      expect(rows[0]).toContain("answer");
      expect(rows[0]).toContain("because...");
    });
  });

  describe("generateCsvContent", () => {
    it("generates valid CSV string", () => {
      const data = createMinimalData({
        datasetColumns: [{ name: "input", hasImages: false }],
        rows: [{ index: 0, datasetEntry: { input: "hello" }, targets: {} }],
      });
      const csv = generateCsvContent(data);
      expect(csv).toContain("input");
      expect(csv).toContain("hello");
    });

    it("escapes special characters in CSV", () => {
      const data = createMinimalData({
        datasetColumns: [{ name: "text", hasImages: false }],
        rows: [
          {
            index: 0,
            datasetEntry: { text: 'has "quotes" and, commas' },
            targets: {},
          },
        ],
      });
      const csv = generateCsvContent(data);
      // papaparse should properly escape quotes and commas
      expect(csv).toContain('"has ""quotes"" and, commas"');
    });
  });
});
