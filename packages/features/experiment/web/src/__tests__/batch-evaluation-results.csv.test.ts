import { describe, expect, it } from "vitest";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import {
  buildCsvData,
  buildCsvHeaders,
  generateCsvContent,
} from "@langwatch/experiment-web";
import type {
  BatchComparisonColumn,
  BatchEvaluationData,
  BatchTargetOutput,
} from "@langwatch/experiment-web";
import { transformBatchEvaluationData } from "@langwatch/experiment-web";

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
  comparisonColumns: [],
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
    /** @scenario Export results to CSV */
    /** @scenario CSV contains all columns */
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

    /** @scenario CSV handles special characters */
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
      overrides: Partial<ExperimentRunWithItems> = {},
    ): ExperimentRunWithItems => ({
      experimentId: "exp-1",
      runId: "run-1",
      projectId: "project-1",
      timestamps: {
        createdAt: 1705320000000,
        updatedAt: 1705320000000,
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
            targetId: "gpt-4",
            entry: { question: "Q1" },
            predicted: { output: "GPT-4 answer" },
            duration: 500,
          },
          {
            index: 0,
            targetId: "gpt-3.5",
            entry: { question: "Q1" },
            predicted: { output: "GPT-3.5 answer" },
            duration: 200,
          },
          {
            index: 0,
            targetId: "claude",
            entry: { question: "Q1" },
            predicted: { output: "Claude answer" },
            duration: 300,
          },
        ],
        evaluations: [
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-4",
            index: 0,
            status: "processed",
            score: 0.9,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-3.5",
            index: 0,
            status: "processed",
            score: 0.8,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "claude",
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
            targetId: "gpt-4",
            entry: { question: "Q1" },
            predicted: { answer: "GPT-4 answer 1" },
          },
          {
            index: 0,
            targetId: "claude",
            entry: { question: "Q1" },
            predicted: { answer: "Claude answer 1" },
          },
          // Row 1
          {
            index: 1,
            targetId: "gpt-4",
            entry: { question: "Q2" },
            predicted: { answer: "GPT-4 answer 2" },
          },
          {
            index: 1,
            targetId: "claude",
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
            targetId: "gpt-4",
            entry: { question: "Q1" },
            predicted: { answer: "GPT-4 answer" },
          },
          {
            index: 0,
            targetId: "claude",
            entry: { question: "Q1" },
            predicted: { answer: "Claude answer" },
          },
          // Row 1 - only GPT-4 has prediction (Claude is still processing or errored)
          {
            index: 1,
            targetId: "gpt-4",
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

  /**
   * A comparison grades the whole row rather than any one target, so it has no
   * target block to hang under. Without a block of its own, a customer who runs
   * an n-way comparison, reads the Winner column on the results page and then
   * exports gets a file with no trace of the comparison at all.
   */
  describe("given a run that recorded comparison verdicts", () => {
    const VARIANTS = [
      { id: "gpt-5-mini", name: "gpt-5-mini" },
      { id: "claude-sonnet-5", name: "claude-sonnet-5" },
      { id: "gemini-flash", name: "gemini-flash" },
    ];

    const ALL_CANDIDATES = VARIANTS.map((variant) => variant.id);

    const ROW_0_REASONING =
      "gpt-5-mini gives the exact reset link; the others bury it in preamble.";
    const ROW_1_REASONING = "Both answers state the same policy with the same caveats.";
    const ROW_3_REASONING =
      "gemini-flash produced nothing for this row, so it was not judged.";

    const createComparisonColumn = (
      overrides: Partial<BatchComparisonColumn> = {},
    ): BatchComparisonColumn => ({
      evaluatorId: "langevals/select_best_compare",
      name: "Comparison",
      variants: VARIANTS,
      verdictsByRow: {},
      ...overrides,
    });

    /**
     * The exported row as a header-to-value record, so an assertion names the
     * column it is about instead of counting positions.
     */
    const exportedRow = (
      data: BatchEvaluationData,
      rowIndex: number,
    ): Record<string, string> => {
      const { headers, rows } = buildCsvData(data);
      const values = rows[rowIndex] ?? [];
      return Object.fromEntries(
        headers.map((header, position) => [header, values[position] ?? ""]),
      );
    };

    /** One target, one dataset column, one comparison over three candidates. */
    const createComparisonData = (column: BatchComparisonColumn): BatchEvaluationData =>
      createMinimalData({
        datasetColumns: [{ name: "input", hasImages: false }],
        targetColumns: [
          {
            id: "gpt-5-mini",
            name: "gpt-5-mini",
            type: "custom",
            outputFields: ["output"],
          },
        ],
        comparisonColumns: [column],
        rows: [0, 1, 2, 3].map((index) => ({
          index,
          datasetEntry: { input: `question ${index}` },
          targets: {
            "gpt-5-mini": createTargetOutput({
              targetId: "gpt-5-mini",
              output: { output: `gpt-5-mini answer ${index}` },
            }),
          },
        })),
      });

    const FULL_RUN_COLUMN = createComparisonColumn({
      verdictsByRow: {
        0: {
          rowIndex: 0,
          winnerId: "gpt-5-mini",
          reasoning: ROW_0_REASONING,
          candidateIds: ALL_CANDIDATES,
          isUnresolved: false,
        },
        1: {
          rowIndex: 1,
          winnerId: null,
          reasoning: ROW_1_REASONING,
          candidateIds: ALL_CANDIDATES,
          isUnresolved: false,
        },
        // Row 2 has no verdict at all.
        3: {
          rowIndex: 3,
          winnerId: "claude-sonnet-5",
          reasoning: ROW_3_REASONING,
          candidateIds: ["gpt-5-mini", "claude-sonnet-5"],
          isUnresolved: false,
        },
      },
    });

    describe("given a run with one comparison over three candidates", () => {
      describe("when the headers are built", () => {
        /** @scenario "CSV contains the comparison verdict" */
        it("adds the winner, candidates and reasoning columns after the target block", () => {
          const headers = buildCsvHeaders(createComparisonData(FULL_RUN_COLUMN));

          expect(headers).toEqual([
            "index",
            "input",
            "gpt-5-mini_output",
            "gpt-5-mini_cost",
            "gpt-5-mini_duration_ms",
            "gpt-5-mini_error",
            "gpt-5-mini_trace_id",
            "comparison_winner",
            "comparison_candidates",
            "comparison_reasoning",
          ]);
        });

        // The results page deliberately hides the verdict's numeric score: on
        // its own, 1.0 or 0.5 reads as noise next to the name of the winner.
        it("adds no score column for the verdict", () => {
          const headers = buildCsvHeaders(createComparisonData(FULL_RUN_COLUMN));

          expect(headers).not.toContain("comparison_score");
          expect(headers.filter((header) => header.endsWith("_score"))).toEqual([]);
        });
      });

      describe("when a row was decided", () => {
        it("names the winning target and lines the values up with the headers", () => {
          const { rows } = buildCsvData(createComparisonData(FULL_RUN_COLUMN));

          expect(rows[0]).toEqual([
            "0",
            "question 0",
            "gpt-5-mini answer 0",
            "",
            "",
            "",
            "",
            "gpt-5-mini",
            "gpt-5-mini, claude-sonnet-5, gemini-flash",
            ROW_0_REASONING,
          ]);
        });
      });

      describe("when a row was called a tie", () => {
        it("writes tie in place of a winner and keeps the reasoning", () => {
          const row = exportedRow(createComparisonData(FULL_RUN_COLUMN), 1);

          expect(row.comparison_winner).toBe("tie");
          expect(row.comparison_candidates).toBe(
            "gpt-5-mini, claude-sonnet-5, gemini-flash",
          );
          expect(row.comparison_reasoning).toBe(ROW_1_REASONING);
        });
      });

      describe("when a row carries no verdict", () => {
        it("leaves the whole comparison block empty rather than claiming a tie", () => {
          const row = exportedRow(createComparisonData(FULL_RUN_COLUMN), 2);

          expect(row.comparison_winner).toBe("");
          expect(row.comparison_candidates).toBe("");
          expect(row.comparison_reasoning).toBe("");
        });
      });

      describe("when a row judged fewer candidates than the comparison has variants", () => {
        // A target with no output for the row is dropped from that row's
        // matchup, and a win over one opponent is not a win over two.
        it("names only the candidates that row actually compared", () => {
          const row = exportedRow(createComparisonData(FULL_RUN_COLUMN), 3);

          expect(row.comparison_winner).toBe("claude-sonnet-5");
          expect(row.comparison_candidates).toBe("gpt-5-mini, claude-sonnet-5");
          expect(row.comparison_reasoning).toBe(ROW_3_REASONING);
        });
      });

      describe("when a verdict names a candidate the run no longer knows", () => {
        it("falls back to the raw identifier instead of blanking the winner", () => {
          const column = createComparisonColumn({
            verdictsByRow: {
              0: {
                rowIndex: 0,
                winnerId: "retired-target",
                reasoning: "It answered first.",
                candidateIds: ["gpt-5-mini", "retired-target"],
                isUnresolved: false,
              },
            },
          });
          const row = exportedRow(createComparisonData(column), 0);

          expect(row.comparison_winner).toBe("retired-target");
          expect(row.comparison_candidates).toBe("gpt-5-mini, retired-target");
        });
      });

      describe("when the judge answered with a label nothing could be matched to", () => {
        // A tie is evidence shared between the candidates; an unplaceable
        // answer is no evidence at all. Exporting it as a tie would hand the
        // reader a result nobody produced.
        it("marks the row unresolved rather than as a tie", () => {
          const column = createComparisonColumn({
            verdictsByRow: {
              0: {
                rowIndex: 0,
                winnerId: null,
                reasoning: "Candidate B is clearer.",
                candidateIds: ALL_CANDIDATES,
                isUnresolved: true,
              },
            },
          });
          const row = exportedRow(createComparisonData(column), 0);

          expect(row.comparison_winner).toBe("unresolved");
          expect(row.comparison_reasoning).toBe("Candidate B is clearer.");
        });
      });

      describe("when a verdict carries no candidate list", () => {
        // Old runs recorded no candidates. Naming the column-wide variant list
        // instead would assert a matchup that may never have happened.
        it("leaves the candidates empty rather than assuming every variant", () => {
          const column = createComparisonColumn({
            verdictsByRow: {
              0: {
                rowIndex: 0,
                winnerId: "gemini-flash",
                reasoning: null,
              },
            },
          });
          const row = exportedRow(createComparisonData(column), 0);

          expect(row.comparison_winner).toBe("gemini-flash");
          expect(row.comparison_candidates).toBe("");
          expect(row.comparison_reasoning).toBe("");
        });
      });
    });

    describe("given a run with two distinct comparisons", () => {
      const helpfulness = createComparisonColumn({
        evaluatorId: "comparison-helpfulness",
        name: "Helpfulness",
        verdictsByRow: {
          0: {
            rowIndex: 0,
            winnerId: "gpt-5-mini",
            reasoning: "Answers the question asked.",
            candidateIds: ALL_CANDIDATES,
            isUnresolved: false,
          },
        },
      });
      const brandVoice = createComparisonColumn({
        evaluatorId: "comparison-brand-voice",
        name: "Brand voice",
        verdictsByRow: {
          0: {
            rowIndex: 0,
            winnerId: "claude-sonnet-5",
            reasoning: "Keeps the support tone.",
            candidateIds: ALL_CANDIDATES,
            isUnresolved: false,
          },
        },
      });

      const twoComparisonData = createMinimalData({
        targetColumns: [],
        comparisonColumns: [helpfulness, brandVoice],
        rows: [{ index: 0, datasetEntry: {}, targets: {} }],
      });

      describe("when the export is built", () => {
        it("keeps one block per comparison, each named after its own judge", () => {
          const { headers, rows } = buildCsvData(twoComparisonData);

          expect(headers).toEqual([
            "index",
            "helpfulness_winner",
            "helpfulness_candidates",
            "helpfulness_reasoning",
            "brand_voice_winner",
            "brand_voice_candidates",
            "brand_voice_reasoning",
          ]);
          expect(rows[0]).toEqual([
            "0",
            "gpt-5-mini",
            "gpt-5-mini, claude-sonnet-5, gemini-flash",
            "Answers the question asked.",
            "claude-sonnet-5",
            "gpt-5-mini, claude-sonnet-5, gemini-flash",
            "Keeps the support tone.",
          ]);
        });
      });
    });

    describe("given rows whose indexes are not their positions in the table", () => {
      // Verdicts are keyed by the dataset row index, which stops matching the
      // array position as soon as a row is missing from the run.
      it("matches each verdict to its own row index", () => {
        const data = createMinimalData({
          comparisonColumns: [
            createComparisonColumn({
              verdictsByRow: {
                5: {
                  rowIndex: 5,
                  winnerId: "gpt-5-mini",
                  reasoning: "Row five.",
                  candidateIds: ALL_CANDIDATES,
                  isUnresolved: false,
                },
                9: {
                  rowIndex: 9,
                  winnerId: "gemini-flash",
                  reasoning: "Row nine.",
                  candidateIds: ALL_CANDIDATES,
                  isUnresolved: false,
                },
              },
            }),
          ],
          rows: [
            { index: 5, datasetEntry: {}, targets: {} },
            { index: 9, datasetEntry: {}, targets: {} },
          ],
        });

        const { rows } = buildCsvData(data);

        expect(rows[0]?.[1]).toBe("gpt-5-mini");
        expect(rows[1]?.[1]).toBe("gemini-flash");
      });
    });

    describe("given a run with no comparison at all", () => {
      it("emits no comparison columns", () => {
        const withoutKey = createMinimalData({ comparisonColumns: void 0 });
        const withEmptyList = createMinimalData({ comparisonColumns: [] });

        expect(buildCsvHeaders(withoutKey)).toEqual(["index"]);
        expect(buildCsvHeaders(withEmptyList)).toEqual(["index"]);
      });
    });

    describe("given a comparison whose reasoning contains commas and quotes", () => {
      it("escapes the reasoning in the generated CSV", () => {
        const reasoning = 'It is "clearer", and shorter';
        const data = createMinimalData({
          comparisonColumns: [
            createComparisonColumn({
              verdictsByRow: {
                0: {
                  rowIndex: 0,
                  winnerId: "gpt-5-mini",
                  reasoning,
                  candidateIds: ALL_CANDIDATES,
                  isUnresolved: false,
                },
              },
            }),
          ],
          rows: [{ index: 0, datasetEntry: {}, targets: {} }],
        });

        const csv = generateCsvContent(data);

        expect(csv).toContain("comparison_winner");
        expect(csv).toContain('"It is ""clearer"", and shorter"');
        expect(csv).toContain('"gpt-5-mini, claude-sonnet-5, gemini-flash"');
      });
    });

    describe("given a stored run whose verdicts belong to the row rather than to a target", () => {
      // What the code-first SDK writes: no target id on the verdict, the winner
      // named by target name, and every candidate it judged in the inputs.
      const sdkRun: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "project-1",
        timestamps: { createdAt: 1705320000000, updatedAt: 1705320000000 },
        targets: [
          { id: "gpt-5-mini", name: "gpt-5-mini", type: "custom" },
          { id: "claude-sonnet-5", name: "claude-sonnet-5", type: "custom" },
        ],
        dataset: [0, 1].flatMap((index) =>
          ["gpt-5-mini", "claude-sonnet-5"].map((targetId) => ({
            index,
            targetId,
            entry: { input: `question ${index}` },
            predicted: { output: `${targetId} answer ${index}` },
          })),
        ),
        evaluations: [
          {
            evaluator: "langevals/select_best_compare",
            name: "Comparison",
            status: "processed",
            index: 0,
            label: "gpt-5-mini",
            details: "It answers the question asked.",
            inputs: {
              candidates: [{ id: "gpt-5-mini" }, { id: "claude-sonnet-5" }],
            },
          },
          {
            evaluator: "langevals/select_best_compare",
            name: "Comparison",
            status: "processed",
            index: 1,
            label: "tie",
            details: "Nothing separates them.",
            inputs: {
              candidates: [{ id: "gpt-5-mini" }, { id: "claude-sonnet-5" }],
            },
          },
        ],
      };

      describe("when the transformed run is exported", () => {
        it("carries the verdict through to the CSV under the judge's own name", () => {
          const data = transformBatchEvaluationData(sdkRun);
          const { headers } = buildCsvData(data);

          expect(headers.slice(-3)).toEqual([
            "comparison_winner",
            "comparison_candidates",
            "comparison_reasoning",
          ]);
          expect(exportedRow(data, 0)).toMatchObject({
            comparison_winner: "gpt-5-mini",
            comparison_candidates: "gpt-5-mini, claude-sonnet-5",
            comparison_reasoning: "It answers the question asked.",
          });
          expect(exportedRow(data, 1)).toMatchObject({
            comparison_winner: "tie",
            comparison_candidates: "gpt-5-mini, claude-sonnet-5",
            comparison_reasoning: "Nothing separates them.",
          });
        });
      });
    });
  });
});

describe("given two targets stored under the same name", () => {
  describe("when the results are exported to CSV", () => {
    /** @scenario "The CSV export keeps a column block per same-named target" */
    it("numbers each target's headers so no header repeats", () => {
      const run: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "project-1",
        targets: [
          { id: "target-1", name: "classifier", type: "prompt" },
          { id: "target-2", name: "classifier", type: "prompt" },
        ],
        dataset: [
          {
            index: 0,
            targetId: "target-1",
            entry: { input: "a question" },
            predicted: { output: "first answer" },
          },
          {
            index: 0,
            targetId: "target-2",
            entry: { input: "a question" },
            predicted: { output: "second answer" },
          },
        ],
        evaluations: [],
        timestamps: { createdAt: 1, updatedAt: 1, finishedAt: 2 },
      };

      const headers = buildCsvHeaders(transformBatchEvaluationData(run));

      expect(headers).toContain("classifier_(1)_output");
      expect(headers).toContain("classifier_(2)_output");
      expect(new Set(headers).size).toBe(headers.length);
    });
  });
});
