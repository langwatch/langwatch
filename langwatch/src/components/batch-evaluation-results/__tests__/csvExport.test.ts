import { describe, expect, it } from "vitest";
import type { ESBatchEvaluation } from "~/server/experiments/types";
import {
  buildCsvData,
  buildCsvHeaders,
  generateCsvContent,
} from "../csvExport";
import type { BatchEvaluationData, BatchTargetOutput } from "../types";
import { transformBatchEvaluationData } from "../types";

const createMinimalData = (
  overrides: Partial<BatchEvaluationData> = {},
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
  overrides: Partial<BatchTargetOutput> = {},
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
    it("returns index header for empty data", () => {
      const data = createMinimalData();
      const headers = buildCsvHeaders(data);
      expect(headers).toEqual(["index"]);
    });

    it("includes dataset column headers after index", () => {
      const data = createMinimalData({
        datasetColumns: [
          { name: "input", hasImages: false },
          { name: "expected_output", hasImages: false },
        ],
      });
      const headers = buildCsvHeaders(data);
      expect(headers[0]).toBe("index");
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
      expect(headers).toContain("gpt-4_duration_ms");
      expect(headers).toContain("gpt-4_error");
      expect(headers).toContain("gpt-4_trace_id");
    });

    it("includes target metadata headers when present", () => {
      const data = createMinimalData({
        targetColumns: [
          {
            id: "target-1",
            name: "GPT-4",
            type: "prompt",
            model: "openai/gpt-4",
            promptId: "prompt-123",
            promptVersion: 2,
            metadata: { temperature: 0.7 },
            outputFields: ["response"],
          },
        ],
        rows: [],
      });
      const headers = buildCsvHeaders(data);
      expect(headers).toContain("gpt-4_model");
      expect(headers).toContain("gpt-4_prompt_id");
      expect(headers).toContain("gpt-4_prompt_version");
      expect(headers).toContain("gpt-4_temperature");
    });
  });

  describe("buildCsvData", () => {
    it("handles empty data with just index header", () => {
      const data = createMinimalData();
      const { headers, rows } = buildCsvData(data);
      expect(headers).toEqual(["index"]);
      expect(rows).toEqual([]);
    });

    it("exports row index and dataset values", () => {
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
      expect(rows[0]?.[0]).toBe("0"); // index
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
      // Should not throw and should have empty strings for null values (after index)
      expect(rows.length).toBe(1);
      expect(rows[0]?.[0]).toBe("0"); // index
      expect(rows[0]?.[1]).toBe(""); // null input value
    });

    it("exports evaluator results with score, passed, cost and duration", () => {
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
                    cost: 0.002,
                    duration: 150,
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
      expect(headers).toContain("model_accuracy_cost");
      expect(headers).toContain("model_accuracy_duration_ms");
      expect(rows[0]).toContain("0.95");
      expect(rows[0]).toContain("true");
      expect(rows[0]).toContain("correct");
      expect(rows[0]).toContain("Good match");
      expect(rows[0]).toContain("0.002");
      expect(rows[0]).toContain("150");
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
              t1: createTargetOutput({
                targetId: "t1",
                output: { response: "gpt response" },
              }),
              t2: createTargetOutput({
                targetId: "t2",
                output: { response: "claude response" },
              }),
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

    it("exports multiple targets with specific output fields", () => {
      const data = createMinimalData({
        targetColumns: [
          {
            id: "gpt-4",
            name: "GPT-4",
            type: "prompt",
            outputFields: ["output"],
          },
          {
            id: "gpt-3.5",
            name: "GPT-3.5",
            type: "prompt",
            outputFields: ["output"],
          },
          {
            id: "claude",
            name: "Claude",
            type: "prompt",
            outputFields: ["output"],
          },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: { question: "What is 2+2?" },
            targets: {
              "gpt-4": createTargetOutput({
                targetId: "gpt-4",
                output: { output: "GPT-4 says 4" },
                cost: 0.001,
                duration: 500,
              }),
              "gpt-3.5": createTargetOutput({
                targetId: "gpt-3.5",
                output: { output: "GPT-3.5 says 4" },
                cost: 0.0005,
                duration: 200,
              }),
              claude: createTargetOutput({
                targetId: "claude",
                output: { output: "Claude says 4" },
                cost: 0.0008,
                duration: 300,
              }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);

      // Should have output column for each target
      expect(headers).toContain("gpt-4_output");
      expect(headers).toContain("gpt-3.5_output");
      expect(headers).toContain("claude_output");

      // Each target's output should be in the row
      expect(rows[0]).toContain("GPT-4 says 4");
      expect(rows[0]).toContain("GPT-3.5 says 4");
      expect(rows[0]).toContain("Claude says 4");

      // Cost and duration should be present for each target
      expect(headers).toContain("gpt-4_cost");
      expect(headers).toContain("gpt-3.5_cost");
      expect(headers).toContain("claude_cost");
      expect(rows[0]).toContain("0.001");
      expect(rows[0]).toContain("0.0005");
      expect(rows[0]).toContain("0.0008");
    });

    it("exports multiple targets with evaluator results per target", () => {
      const data = createMinimalData({
        targetColumns: [
          {
            id: "gpt-4",
            name: "GPT-4",
            type: "prompt",
            outputFields: ["output"],
          },
          {
            id: "claude",
            name: "Claude",
            type: "prompt",
            outputFields: ["output"],
          },
        ],
        evaluatorNames: { quality: "Quality Check" },
        rows: [
          {
            index: 0,
            datasetEntry: { question: "Q1" },
            targets: {
              "gpt-4": createTargetOutput({
                targetId: "gpt-4",
                output: { output: "GPT-4 answer" },
                evaluatorResults: [
                  {
                    evaluatorId: "quality",
                    evaluatorName: "Quality Check",
                    status: "processed",
                    score: 0.9,
                    passed: true,
                  },
                ],
              }),
              claude: createTargetOutput({
                targetId: "claude",
                output: { output: "Claude answer" },
                evaluatorResults: [
                  {
                    evaluatorId: "quality",
                    evaluatorName: "Quality Check",
                    status: "processed",
                    score: 0.85,
                    passed: true,
                  },
                ],
              }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);

      // Should have evaluator columns for each target
      expect(headers).toContain("gpt-4_quality_check_score");
      expect(headers).toContain("claude_quality_check_score");

      // Each target's evaluator results should be in the row
      expect(rows[0]).toContain("0.9");
      expect(rows[0]).toContain("0.85");
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
      expect(rows[0]?.[0]).toBe("0"); // index
      expect(rows[0]?.[1]).toBe('{"key":"value","nested":{"a":1}}'); // config
    });

    it("exports target metadata (model, prompt, custom metadata)", () => {
      const data = createMinimalData({
        targetColumns: [
          {
            id: "target-1",
            name: "GPT-4",
            type: "prompt",
            model: "openai/gpt-4",
            promptId: "prompt-123",
            promptVersion: 2,
            metadata: { temperature: 0.7, max_tokens: 1000 },
            outputFields: ["answer"],
          },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              "target-1": createTargetOutput({
                output: { answer: "test response" },
              }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);

      // Metadata headers
      expect(headers).toContain("gpt-4_model");
      expect(headers).toContain("gpt-4_prompt_id");
      expect(headers).toContain("gpt-4_prompt_version");
      expect(headers).toContain("gpt-4_temperature");
      expect(headers).toContain("gpt-4_max_tokens");

      // Values
      expect(rows[0]).toContain("openai/gpt-4");
      expect(rows[0]).toContain("prompt-123");
      expect(rows[0]).toContain("2");
      expect(rows[0]).toContain("0.7");
      expect(rows[0]).toContain("1000");
    });

    it("exports target error when present", () => {
      const data = createMinimalData({
        targetColumns: [
          { id: "target-1", name: "Model", type: "prompt", outputFields: [] },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: {},
            targets: {
              "target-1": createTargetOutput({
                output: null,
                error: "Rate limit exceeded",
              }),
            },
          },
        ],
      });
      const { headers, rows } = buildCsvData(data);
      expect(headers).toContain("model_error");
      expect(rows[0]).toContain("Rate limit exceeded");
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

  describe("multi-target CSV export from ES data", () => {
    const createESData = (
      overrides: Partial<ESBatchEvaluation> = {},
    ): ESBatchEvaluation => ({
      project_id: "project-1",
      experiment_id: "exp-1",
      run_id: "run-1",
      timestamps: {
        created_at: 1705320000000,
        inserted_at: 1705320000000,
        updated_at: 1705320000000,
      },
      targets: [],
      dataset: [],
      evaluations: [],
      ...overrides,
    });

    it("exports multiple targets with same index correctly from ES data", () => {
      // Simulate ES data with multiple targets at the same index (as stored by log_results)
      const esData = createESData({
        targets: [
          {
            id: "gpt-4",
            name: "GPT-4",
            type: "custom",
            metadata: { model: "openai/gpt-4" },
          },
          {
            id: "gpt-3.5",
            name: "GPT-3.5",
            type: "custom",
            metadata: { model: "openai/gpt-3.5-turbo" },
          },
          {
            id: "claude",
            name: "Claude",
            type: "custom",
            metadata: { model: "anthropic/claude-3" },
          },
        ],
        dataset: [
          // All targets at index 0 with their own predictions
          {
            index: 0,
            target_id: "gpt-4",
            entry: { question: "Q1" },
            predicted: { output: "GPT-4 answer" },
            duration: 500,
          },
          {
            index: 0,
            target_id: "gpt-3.5",
            entry: { question: "Q1" },
            predicted: { output: "GPT-3.5 answer" },
            duration: 200,
          },
          {
            index: 0,
            target_id: "claude",
            entry: { question: "Q1" },
            predicted: { output: "Claude answer" },
            duration: 300,
          },
        ],
        evaluations: [
          {
            evaluator: "quality",
            name: "Quality",
            target_id: "gpt-4",
            index: 0,
            status: "processed",
            score: 0.9,
          },
          {
            evaluator: "quality",
            name: "Quality",
            target_id: "gpt-3.5",
            index: 0,
            status: "processed",
            score: 0.8,
          },
          {
            evaluator: "quality",
            name: "Quality",
            target_id: "claude",
            index: 0,
            status: "processed",
            score: 0.85,
          },
        ],
      });

      // Transform ES data to BatchEvaluationData
      const transformed = transformBatchEvaluationData(esData);

      // Verify transformation captured all targets
      expect(transformed.targetColumns).toHaveLength(3);
      expect(transformed.targetColumns.map((t) => t.name)).toEqual([
        "GPT-4",
        "GPT-3.5",
        "Claude",
      ]);

      // Verify each target has its output field detected
      expect(transformed.targetColumns[0]?.outputFields).toContain("output");
      expect(transformed.targetColumns[1]?.outputFields).toContain("output");
      expect(transformed.targetColumns[2]?.outputFields).toContain("output");

      // Verify single row with all targets populated
      expect(transformed.rows).toHaveLength(1);
      const row = transformed.rows[0]!;
      expect(row.targets["gpt-4"]?.output).toEqual({ output: "GPT-4 answer" });
      expect(row.targets["gpt-3.5"]?.output).toEqual({
        output: "GPT-3.5 answer",
      });
      expect(row.targets.claude?.output).toEqual({
        output: "Claude answer",
      });

      // Verify CSV export includes all target outputs
      const { headers, rows } = buildCsvData(transformed);

      // Headers should include output for each target
      expect(headers).toContain("gpt-4_output");
      expect(headers).toContain("gpt-3.5_output");
      expect(headers).toContain("claude_output");

      // Row should contain all target outputs
      expect(rows[0]).toContain("GPT-4 answer");
      expect(rows[0]).toContain("GPT-3.5 answer");
      expect(rows[0]).toContain("Claude answer");

      // Evaluator scores should be per-target
      expect(headers).toContain("gpt-4_quality_score");
      expect(headers).toContain("gpt-3.5_quality_score");
      expect(headers).toContain("claude_quality_score");
      expect(rows[0]).toContain("0.9");
      expect(rows[0]).toContain("0.8");
      expect(rows[0]).toContain("0.85");
    });

    it("exports multiple rows with multiple targets each", () => {
      const esData = createESData({
        targets: [
          { id: "gpt-4", name: "GPT-4", type: "custom" },
          { id: "claude", name: "Claude", type: "custom" },
        ],
        dataset: [
          // Row 0
          {
            index: 0,
            target_id: "gpt-4",
            entry: { question: "Q1" },
            predicted: { answer: "GPT-4 answer 1" },
          },
          {
            index: 0,
            target_id: "claude",
            entry: { question: "Q1" },
            predicted: { answer: "Claude answer 1" },
          },
          // Row 1
          {
            index: 1,
            target_id: "gpt-4",
            entry: { question: "Q2" },
            predicted: { answer: "GPT-4 answer 2" },
          },
          {
            index: 1,
            target_id: "claude",
            entry: { question: "Q2" },
            predicted: { answer: "Claude answer 2" },
          },
        ],
        evaluations: [],
      });

      const transformed = transformBatchEvaluationData(esData);
      const { rows } = buildCsvData(transformed);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("GPT-4 answer 1");
      expect(rows[0]).toContain("Claude answer 1");
      expect(rows[1]).toContain("GPT-4 answer 2");
      expect(rows[1]).toContain("Claude answer 2");
    });

    it("handles target with missing prediction at some index", () => {
      const esData = createESData({
        targets: [
          { id: "gpt-4", name: "GPT-4", type: "custom" },
          { id: "claude", name: "Claude", type: "custom" },
        ],
        dataset: [
          // Row 0 - both targets have predictions
          {
            index: 0,
            target_id: "gpt-4",
            entry: { question: "Q1" },
            predicted: { answer: "GPT-4 answer" },
          },
          {
            index: 0,
            target_id: "claude",
            entry: { question: "Q1" },
            predicted: { answer: "Claude answer" },
          },
          // Row 1 - only GPT-4 has prediction (Claude is still processing or errored)
          {
            index: 1,
            target_id: "gpt-4",
            entry: { question: "Q2" },
            predicted: { answer: "GPT-4 answer 2" },
          },
        ],
        evaluations: [],
      });

      const transformed = transformBatchEvaluationData(esData);
      const { rows } = buildCsvData(transformed);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("GPT-4 answer");
      expect(rows[0]).toContain("Claude answer");
      expect(rows[1]).toContain("GPT-4 answer 2");
      // Claude's column should be empty for row 1
    });
  });
});
