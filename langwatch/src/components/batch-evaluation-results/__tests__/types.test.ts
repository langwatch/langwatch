/**
 * Tests for batch evaluation data transformer
 */
import { describe, expect, it } from "vitest";
import type { ExperimentRunWithItems } from "~/server/evaluations-v3/services/types";
import { transformBatchEvaluationData } from "../types";

// Helper to create base timestamps
const createTimestamps = () => ({
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe("transformBatchEvaluationData", () => {
  describe("basic metadata", () => {
    it("extracts run metadata correctly", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [],
        evaluations: [],
        timestamps: {
          ...createTimestamps(),
          finishedAt: Date.now() + 1000,
        },
      };

      const result = transformBatchEvaluationData(data);

      expect(result.projectId).toBe("proj-1");
      expect(result.experimentId).toBe("exp-1");
      expect(result.runId).toBe("run-1");
      expect(result.finishedAt).toBeDefined();
    });

    it("handles progress for running evaluations", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [],
        evaluations: [],
        timestamps: createTimestamps(),
        progress: 5,
        total: 10,
      };

      const result = transformBatchEvaluationData(data);

      expect(result.progress).toBe(5);
      expect(result.total).toBe(10);
    });

    it("handles stopped evaluation with stopped_at timestamp", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [],
        evaluations: [],
        timestamps: {
          ...createTimestamps(),
          stoppedAt: Date.now() + 500,
        },
      };

      const result = transformBatchEvaluationData(data);

      expect(result.stoppedAt).toBeDefined();
    });
  });

  describe("empty states", () => {
    it("handles empty dataset", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      expect(result.datasetColumns).toEqual([]);
      expect(result.targetColumns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it("handles dataset with entries but no predictions", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          { index: 0, entry: { input: "hello" } },
          { index: 1, entry: { input: "world" } },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      expect(result.datasetColumns).toHaveLength(1);
      expect(result.datasetColumns[0]?.name).toBe("input");
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.datasetEntry).toEqual({ input: "hello" });
    });
  });

  describe("V2 format (legacy, no targets)", () => {
    it("transforms V2 data with flat predicted values", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          {
            index: 0,
            entry: { input: "What is 2+2?" },
            predicted: { output: "4" },
            cost: 0.001,
            duration: 500,
            traceId: "trace-1",
          },
        ],
        evaluations: [
          {
            evaluator: "exact_match",
            name: "Exact Match",
            status: "processed",
            index: 0,
            score: 1.0,
            passed: true,
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should create a single "end" target column
      expect(result.targetColumns).toHaveLength(1);
      expect(result.targetColumns[0]?.type).toBe("legacy");

      // Row should have the target data
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0]!;
      expect(row.datasetEntry).toEqual({ input: "What is 2+2?" });

      // Target output
      const targetId = result.targetColumns[0]!.id;
      const target = row.targets[targetId]!;
      expect(target.output).toEqual({ output: "4" });
      expect(target.cost).toBe(0.001);
      expect(target.duration).toBe(500);
      expect(target.traceId).toBe("trace-1");

      // Evaluator results
      expect(target.evaluatorResults).toHaveLength(1);
      expect(target.evaluatorResults[0]?.evaluatorId).toBe("exact_match");
      expect(target.evaluatorResults[0]?.passed).toBe(true);
      expect(target.evaluatorResults[0]?.score).toBe(1.0);
    });

    it("transforms V2 data with nested predicted values (node format)", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          {
            index: 0,
            entry: { question: "Hello" },
            predicted: {
              end: { response: "Hi there!", confidence: 0.95 },
            },
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should create an "end" target column
      expect(result.targetColumns).toHaveLength(1);
      expect(result.targetColumns[0]?.id).toBe("end");
      expect(result.targetColumns[0]?.outputFields).toContain("response");
      expect(result.targetColumns[0]?.outputFields).toContain("confidence");
    });

    it("handles V2 evaluation error status", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          { index: 0, entry: { input: "test" }, predicted: { out: "x" } },
        ],
        evaluations: [
          {
            evaluator: "llm_judge",
            status: "error",
            index: 0,
            details: "API rate limit exceeded",
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      const targetId = result.targetColumns[0]!.id;
      const evalResult =
        result.rows[0]!.targets[targetId]!.evaluatorResults[0]!;
      expect(evalResult.status).toBe("error");
      expect(evalResult.details).toBe("API rate limit exceeded");
    });

    it("handles V2 target execution error with virtual target", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          {
            index: 0,
            entry: { input: "test" },
            error: "Connection timeout",
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Now creates a virtual target to display the error
      expect(result.targetColumns).toHaveLength(1);
      expect(result.targetColumns[0]?.id).toBe("_default");
      expect(result.targetColumns[0]?.name).toBe("Output");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.datasetEntry).toEqual({ input: "test" });
      expect(result.rows[0]?.targets["_default"]?.error).toBe("Connection timeout");
    });
  });

  describe("V3 format (with explicit targets)", () => {
    it("transforms V3 data with multiple targets", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: [
          { id: "target-1", name: "GPT-4o", type: "prompt", model: "gpt-4o" },
          { id: "target-2", name: "Claude", type: "prompt", model: "claude-3" },
        ],
        dataset: [
          {
            index: 0,
            targetId: "target-1",
            entry: { input: "Hello" },
            predicted: { response: "Hi from GPT!" },
            cost: 0.001,
            duration: 500,
            traceId: "trace-gpt",
          },
          {
            index: 0,
            targetId: "target-2",
            entry: { input: "Hello" },
            predicted: { response: "Hi from Claude!" },
            cost: 0.002,
            duration: 600,
            traceId: "trace-claude",
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should have 2 target columns
      expect(result.targetColumns).toHaveLength(2);
      expect(result.targetColumns[0]?.name).toBe("GPT-4o");
      expect(result.targetColumns[0]?.type).toBe("prompt");
      expect(result.targetColumns[1]?.name).toBe("Claude");

      // Single row with both targets
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0]!;

      // Target 1 data
      expect(row.targets["target-1"]?.output).toEqual({
        response: "Hi from GPT!",
      });
      expect(row.targets["target-1"]?.cost).toBe(0.001);
      expect(row.targets["target-1"]?.traceId).toBe("trace-gpt");

      // Target 2 data
      expect(row.targets["target-2"]?.output).toEqual({
        response: "Hi from Claude!",
      });
      expect(row.targets["target-2"]?.cost).toBe(0.002);
      expect(row.targets["target-2"]?.traceId).toBe("trace-claude");
    });

    it("handles V3 evaluations per target", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: [{ id: "target-1", name: "GPT-4o", type: "prompt" }],
        dataset: [
          {
            index: 0,
            targetId: "target-1",
            entry: { input: "2+2?" },
            predicted: { answer: "4" },
          },
        ],
        evaluations: [
          {
            evaluator: "exact_match",
            name: "Exact Match",
            targetId: "target-1",
            status: "processed",
            index: 0,
            score: 1.0,
            passed: true,
          },
          {
            evaluator: "llm_judge",
            name: "LLM Judge",
            targetId: "target-1",
            status: "processed",
            index: 0,
            score: 0.9,
            passed: true,
            details: "Answer is correct and concise",
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      const target = result.rows[0]!.targets["target-1"]!;
      expect(target.evaluatorResults).toHaveLength(2);

      const exactMatch = target.evaluatorResults.find(
        (e) => e.evaluatorId === "exact_match",
      );
      expect(exactMatch?.passed).toBe(true);
      expect(exactMatch?.score).toBe(1.0);

      const llmJudge = target.evaluatorResults.find(
        (e) => e.evaluatorId === "llm_judge",
      );
      expect(llmJudge?.score).toBe(0.9);
      expect(llmJudge?.details).toBe("Answer is correct and concise");
    });

    it("handles V3 with agent target type", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: [
          {
            id: "agent-1",
            name: "Support Agent",
            type: "agent",
            agentId: "ag-123",
          },
        ],
        dataset: [
          {
            index: 0,
            targetId: "agent-1",
            entry: { query: "Help me" },
            predicted: { response: "How can I assist?" },
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      expect(result.targetColumns[0]?.type).toBe("agent");
      expect(result.targetColumns[0]?.agentId).toBe("ag-123");
    });

    it("handles V3 prompt target with version info", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: [
          {
            id: "prompt-1",
            name: "My Prompt",
            type: "prompt",
            promptId: "prompt-config-123",
            promptVersion: 5,
            model: "gpt-4o",
          },
        ],
        dataset: [
          {
            index: 0,
            targetId: "prompt-1",
            entry: { input: "test" },
            predicted: { output: "result" },
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      expect(result.targetColumns[0]?.promptId).toBe("prompt-config-123");
      expect(result.targetColumns[0]?.promptVersion).toBe(5);
      expect(result.targetColumns[0]?.model).toBe("gpt-4o");
    });
  });

  describe("dataset column detection", () => {
    it("detects multiple dataset columns", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          {
            index: 0,
            entry: { question: "Q1", context: "C1", expected: "E1" },
          },
          {
            index: 1,
            entry: { question: "Q2", context: "C2", expected: "E2" },
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      expect(result.datasetColumns).toHaveLength(3);
      const columnNames = result.datasetColumns.map((c) => c.name);
      expect(columnNames).toContain("question");
      expect(columnNames).toContain("context");
      expect(columnNames).toContain("expected");
    });

    it("detects image URLs in dataset columns", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          {
            index: 0,
            entry: {
              text: "Some text",
              image: "https://example.com/image.png",
            },
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      const textCol = result.datasetColumns.find((c) => c.name === "text");
      const imageCol = result.datasetColumns.find((c) => c.name === "image");

      expect(textCol?.hasImages).toBe(false);
      expect(imageCol?.hasImages).toBe(true);
    });

    it("detects various image URL formats", () => {
      const testCases = [
        { url: "https://example.com/photo.jpg", expected: true },
        { url: "https://example.com/photo.jpeg", expected: true },
        { url: "https://cdn.cloudinary.com/image", expected: true },
        { url: "https://i.imgur.com/abc123", expected: true },
        { url: "data:image/png;base64,abc123", expected: true },
        { url: "https://example.com/api/data", expected: false },
        { url: "not-a-url", expected: false },
      ];

      for (const { url, expected } of testCases) {
        const data: ExperimentRunWithItems = {
          experimentId: "exp-1",
          runId: "run-1",
          projectId: "proj-1",
          dataset: [{ index: 0, entry: { img: url } }],
          evaluations: [],
          timestamps: createTimestamps(),
        };

        const result = transformBatchEvaluationData(data);
        expect(result.datasetColumns[0]?.hasImages).toBe(expected);
      }
    });
  });

  describe("multiple rows", () => {
    it("handles sparse row indices correctly", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          { index: 0, entry: { input: "row0" } },
          { index: 2, entry: { input: "row2" } },
          { index: 5, entry: { input: "row5" } },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should have 6 rows (0-5)
      expect(result.rows).toHaveLength(6);
      expect(result.rows[0]?.datasetEntry).toEqual({ input: "row0" });
      expect(result.rows[1]?.datasetEntry).toEqual({}); // Missing row
      expect(result.rows[2]?.datasetEntry).toEqual({ input: "row2" });
      expect(result.rows[5]?.datasetEntry).toEqual({ input: "row5" });
    });

    it("builds evaluator names map correctly", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          { index: 0, entry: { input: "test" }, predicted: { out: "x" } },
        ],
        evaluations: [
          {
            evaluator: "eval-1",
            name: "Custom Evaluator",
            status: "processed",
            index: 0,
          },
          { evaluator: "eval-2", status: "processed", index: 0 }, // No name
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      expect(result.evaluatorNames["eval-1"]).toBe("Custom Evaluator");
      expect(result.evaluatorNames["eval-2"]).toBe("eval-2"); // Falls back to ID
    });
  });

  describe("API evaluations (derived target)", () => {
    it("derives a virtual target when no targets and no predicted values exist", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          { index: 0, entry: { question: "What is 2+2?" } },
          { index: 1, entry: { question: "What is 3+3?" } },
        ],
        evaluations: [
          {
            evaluator: "sample_metric",
            name: "Sample Metric",
            status: "processed",
            index: 0,
            score: 0.95,
            inputs: { output: "The answer is 4" },
          },
          {
            evaluator: "sample_metric",
            name: "Sample Metric",
            status: "processed",
            index: 1,
            score: 0.85,
            inputs: { output: "The answer is 6" },
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should have one virtual target per evaluator
      expect(result.targetColumns).toHaveLength(1);
      expect(result.targetColumns[0]?.id).toBe("_eval_sample_metric");
      expect(result.targetColumns[0]?.name).toBe("Sample Metric");
      expect(result.targetColumns[0]?.type).toBe("legacy");

      // Should have rows with output from evaluator inputs
      expect(result.rows).toHaveLength(2);
      const targetId = "_eval_sample_metric";
      expect(result.rows[0]?.targets[targetId]?.output).toEqual({
        output: "The answer is 4",
      });
      expect(result.rows[1]?.targets[targetId]?.output).toEqual({
        output: "The answer is 6",
      });

      // Evaluator results should be attached
      expect(result.rows[0]?.targets[targetId]?.evaluatorResults).toHaveLength(
        1,
      );
      expect(result.rows[0]?.targets[targetId]?.evaluatorResults[0]?.score).toBe(
        0.95,
      );
    });

    it("extracts output from various evaluator input field names", () => {
      const testCases = [
        { inputField: "output", value: "output value" },
        { inputField: "response", value: "response value" },
        { inputField: "generated", value: "generated value" },
        { inputField: "answer", value: "answer value" },
        { inputField: "prediction", value: "prediction value" },
      ];

      for (const { inputField, value } of testCases) {
        const data: ExperimentRunWithItems = {
          experimentId: "exp-1",
          runId: "run-1",
          projectId: "proj-1",
          dataset: [{ index: 0, entry: { input: "test" } }],
          evaluations: [
            {
              evaluator: "eval-1",
              status: "processed",
              index: 0,
              inputs: { [inputField]: value },
            },
          ],
          timestamps: createTimestamps(),
        };

        const result = transformBatchEvaluationData(data);

        // Virtual target is created per evaluator
        const targetId = "_eval_eval-1";
        expect(result.targetColumns[0]?.id).toBe(targetId);
        expect(result.rows[0]?.targets[targetId]?.output).toEqual({
          output: value,
        });
      }
    });

    it("creates multiple virtual targets when multiple evaluators exist", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [{ index: 0, entry: { question: "What is 2+2?" } }],
        evaluations: [
          {
            evaluator: "sample_metric",
            name: "Sample Metric",
            status: "processed",
            index: 0,
            score: 0.95,
            inputs: { response: "The answer is 4" },
          },
          {
            evaluator: "sample_metric2",
            name: "Sample Metric 2",
            status: "processed",
            index: 0,
            passed: true,
            inputs: { response: "Another response" },
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should have two virtual targets, one per evaluator
      expect(result.targetColumns).toHaveLength(2);
      expect(result.targetColumns[0]?.id).toBe("_eval_sample_metric");
      expect(result.targetColumns[0]?.name).toBe("Sample Metric");
      expect(result.targetColumns[1]?.id).toBe("_eval_sample_metric2");
      expect(result.targetColumns[1]?.name).toBe("Sample Metric 2");

      // Each target should have its own output from evaluator inputs
      expect(
        result.rows[0]?.targets["_eval_sample_metric"]?.output,
      ).toEqual({ output: "The answer is 4" });
      expect(
        result.rows[0]?.targets["_eval_sample_metric2"]?.output,
      ).toEqual({ output: "Another response" });

      // Each target should have only its own evaluator result
      expect(
        result.rows[0]?.targets["_eval_sample_metric"]?.evaluatorResults,
      ).toHaveLength(1);
      expect(
        result.rows[0]?.targets["_eval_sample_metric"]?.evaluatorResults[0]
          ?.score,
      ).toBe(0.95);
      expect(
        result.rows[0]?.targets["_eval_sample_metric2"]?.evaluatorResults,
      ).toHaveLength(1);
      expect(
        result.rows[0]?.targets["_eval_sample_metric2"]?.evaluatorResults[0]
          ?.passed,
      ).toBe(true);
    });

    it("displays arbitrary data as JSON when no common output field exists", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [{ index: 0, entry: { question: "What is 2+2?" } }],
        evaluations: [
          {
            evaluator: "sample_metric",
            name: "Sample Metric",
            status: "processed",
            index: 0,
            score: 0.76,
            inputs: { foo: "bar", bar: "baz" },
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should have virtual target for the evaluator
      expect(result.targetColumns[0]?.id).toBe("_eval_sample_metric");

      // Output should be the full inputs object (not wrapped in {output: ...})
      // This will be displayed as JSON in the UI
      expect(
        result.rows[0]?.targets["_eval_sample_metric"]?.output,
      ).toEqual({ foo: "bar", bar: "baz" });
    });

    it("does not derive target when dataset already has predicted values", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        dataset: [
          {
            index: 0,
            entry: { input: "test" },
            predicted: { result: "predicted value" },
          },
        ],
        evaluations: [
          {
            evaluator: "eval-1",
            status: "processed",
            index: 0,
            inputs: { output: "from evaluator" },
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should NOT have derived target - should use the predicted columns
      expect(result.targetColumns[0]?.id).not.toBe("_derived");
      expect(result.targetColumns[0]?.id).toBe("end");
    });

    it("creates a virtual Output target for row-level errors without any targets or evaluators", () => {
      // This is the case from SDK's evaluation.run() when the callback throws an error
      // No targets registered, no evaluations, just dataset rows with errors
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: null,
        dataset: [
          {
            index: 0,
            entry: { question: "What is 2+2?", expected: "4" },
            cost: null,
            duration: 4,
            error: "Not implemented",
            traceId: "trace-1",
          },
          {
            index: 1,
            entry: { question: "What is the capital of France?", expected: "Paris" },
            cost: null,
            duration: 3,
            error: "Not implemented",
            traceId: "trace-2",
          },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should create a virtual "Output" target to display the errors
      expect(result.targetColumns).toHaveLength(1);
      expect(result.targetColumns[0]?.id).toBe("_default");
      expect(result.targetColumns[0]?.name).toBe("Output");
      expect(result.targetColumns[0]?.type).toBe("custom");

      // Rows should have the error information attached to the virtual target
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.targets["_default"]?.error).toBe("Not implemented");
      expect(result.rows[0]?.targets["_default"]?.duration).toBe(4);
      expect(result.rows[0]?.targets["_default"]?.traceId).toBe("trace-1");

      expect(result.rows[1]?.targets["_default"]?.error).toBe("Not implemented");
      expect(result.rows[1]?.targets["_default"]?.duration).toBe(3);
      expect(result.rows[1]?.targets["_default"]?.traceId).toBe("trace-2");

      // Output should be null since there's no predicted value
      expect(result.rows[0]?.targets["_default"]?.output).toBeNull();
    });

    it("creates virtual target only when there are errors, not for empty dataset", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: null,
        dataset: [
          { index: 0, entry: { question: "What is 2+2?" } },
          { index: 1, entry: { question: "What is 3+3?" } },
        ],
        evaluations: [],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // No errors and no evaluators - should NOT create a virtual target
      expect(result.targetColumns).toHaveLength(0);
    });
  });

  describe("API evaluations with explicit targets (multi-target comparison)", () => {
    it("associates evaluator results with correct targets when targets are defined", () => {
      // This is the exact structure from the Python SDK when comparing multiple targets
      // Dataset entries are SHARED (no target_id on dataset)
      // Evaluations have target_id to associate with specific targets
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
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
            id: "claude-3",
            name: "Claude-3",
            type: "custom",
            metadata: { model: "anthropic/claude-3" },
          },
        ],
        dataset: [
          // Dataset entries are shared - no target_id
          { index: 0, entry: { question: "What is AI?" } },
          { index: 1, entry: { question: "Explain ML" } },
        ],
        evaluations: [
          // Each evaluation has a target_id
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-4",
            status: "processed",
            index: 0,
            score: 0.95,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-3.5",
            status: "processed",
            index: 0,
            score: 0.7,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "claude-3",
            status: "processed",
            index: 0,
            score: 0.5,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-4",
            status: "processed",
            index: 1,
            score: 0.9,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-3.5",
            status: "processed",
            index: 1,
            score: 0.6,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "claude-3",
            status: "processed",
            index: 1,
            score: 0.4,
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // Should have 3 target columns
      expect(result.targetColumns).toHaveLength(3);
      expect(result.targetColumns.map((t) => t.id)).toEqual([
        "gpt-4",
        "gpt-3.5",
        "claude-3",
      ]);

      // Should have 2 rows
      expect(result.rows).toHaveLength(2);

      // Row 0: Each target should have its OWN evaluator results
      const row0 = result.rows[0]!;

      // GPT-4 should have score 0.95
      expect(row0.targets["gpt-4"]?.evaluatorResults).toHaveLength(1);
      expect(row0.targets["gpt-4"]?.evaluatorResults[0]?.score).toBe(0.95);

      // GPT-3.5 should have score 0.70
      expect(row0.targets["gpt-3.5"]?.evaluatorResults).toHaveLength(1);
      expect(row0.targets["gpt-3.5"]?.evaluatorResults[0]?.score).toBe(0.7);

      // Claude-3 should have score 0.50
      expect(row0.targets["claude-3"]?.evaluatorResults).toHaveLength(1);
      expect(row0.targets["claude-3"]?.evaluatorResults[0]?.score).toBe(0.5);

      // Row 1: Same structure, different scores
      const row1 = result.rows[1]!;

      expect(row1.targets["gpt-4"]?.evaluatorResults[0]?.score).toBe(0.9);
      expect(row1.targets["gpt-3.5"]?.evaluatorResults[0]?.score).toBe(0.6);
      expect(row1.targets["claude-3"]?.evaluatorResults[0]?.score).toBe(0.4);
    });

    it("handles multiple evaluators per target", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: [
          { id: "gpt-4", name: "GPT-4", type: "custom" },
          { id: "claude-3", name: "Claude-3", type: "custom" },
        ],
        dataset: [{ index: 0, entry: { question: "Test" } }],
        evaluations: [
          // GPT-4 has two evaluators
          {
            evaluator: "latency",
            name: "Latency",
            targetId: "gpt-4",
            status: "processed",
            index: 0,
            score: 100,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "gpt-4",
            status: "processed",
            index: 0,
            score: 0.9,
          },
          // Claude-3 has two evaluators
          {
            evaluator: "latency",
            name: "Latency",
            targetId: "claude-3",
            status: "processed",
            index: 0,
            score: 200,
          },
          {
            evaluator: "quality",
            name: "Quality",
            targetId: "claude-3",
            status: "processed",
            index: 0,
            score: 0.8,
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      const row0 = result.rows[0]!;

      // GPT-4 should have 2 evaluator results
      expect(row0.targets["gpt-4"]?.evaluatorResults).toHaveLength(2);
      expect(
        row0.targets["gpt-4"]?.evaluatorResults.find(
          (e) => e.evaluatorId === "latency",
        )?.score,
      ).toBe(100);
      expect(
        row0.targets["gpt-4"]?.evaluatorResults.find(
          (e) => e.evaluatorId === "quality",
        )?.score,
      ).toBe(0.9);

      // Claude-3 should have 2 evaluator results
      expect(row0.targets["claude-3"]?.evaluatorResults).toHaveLength(2);
      expect(
        row0.targets["claude-3"]?.evaluatorResults.find(
          (e) => e.evaluatorId === "latency",
        )?.score,
      ).toBe(200);
      expect(
        row0.targets["claude-3"]?.evaluatorResults.find(
          (e) => e.evaluatorId === "quality",
        )?.score,
      ).toBe(0.8);
    });

    it("correctly builds evaluatorNames map for targets with target_id", () => {
      const data: ExperimentRunWithItems = {
        experimentId: "exp-1",
        runId: "run-1",
        projectId: "proj-1",
        targets: [{ id: "gpt-4", name: "GPT-4", type: "custom" }],
        dataset: [{ index: 0, entry: { question: "Test" } }],
        evaluations: [
          {
            evaluator: "quality",
            name: "Response Quality",
            targetId: "gpt-4",
            status: "processed",
            index: 0,
            score: 0.9,
          },
        ],
        timestamps: createTimestamps(),
      };

      const result = transformBatchEvaluationData(data);

      // The evaluatorNames map should include the human-readable name
      // Key format when target_id exists: "targetId:evaluatorId"
      expect(result.evaluatorNames).toBeDefined();
      // Should have at least one entry
      expect(Object.keys(result.evaluatorNames).length).toBeGreaterThan(0);
    });
  });
});
