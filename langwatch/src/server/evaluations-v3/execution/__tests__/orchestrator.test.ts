import { describe, it, expect } from "vitest";
import { generateCells } from "../orchestrator";
import type { EvaluationsV3State } from "~/evaluations-v3/types";
import type { ExecutionScope } from "../types";

describe("orchestrator", () => {
  // Helper to create test state (partial state with just what generateCells needs)
  const createTestState = (
    targetCount = 2,
    evaluatorCount = 1
  ): Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators"> => ({
    datasets: [{ id: "dataset-1", name: "Test Dataset" } as EvaluationsV3State["datasets"][0]],
    activeDatasetId: "dataset-1",
    targets: Array.from({ length: targetCount }, (_, i) => ({
      id: `target-${i + 1}`,
      type: "prompt" as const,
      name: `Target ${i + 1}`,
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
      mappings: {
        "dataset-1": {
          input: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "question" },
        },
      },
      localPromptConfig: {
        llm: { model: "openai/gpt-4o-mini", temperature: 0 },
        messages: [{ role: "user" as const, content: "{{input}}" }],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      },
    })) as EvaluationsV3State["targets"],
    evaluators: Array.from({ length: evaluatorCount }, (_, i) => ({
      id: `eval-${i + 1}`,
      evaluatorType: "langevals/exact_match" as const,
      name: `Evaluator ${i + 1}`,
      settings: {},
      inputs: [
        { identifier: "output", type: "str" as const },
        { identifier: "expected_output", type: "str" as const },
      ],
      mappings: {
        "dataset-1": {
          "target-1": {
            output: { type: "source", source: "target", sourceId: "target-1", sourceField: "output" },
            expected_output: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "expected" },
          },
          "target-2": {
            output: { type: "source", source: "target", sourceId: "target-2", sourceField: "output" },
            expected_output: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "expected" },
          },
        },
      },
    })) as EvaluationsV3State["evaluators"],
  });

  const createTestDataset = (rowCount = 3) =>
    Array.from({ length: rowCount }, (_, i) => ({
      question: `Question ${i}`,
      expected: `Answer ${i}`,
    }));

  describe("generateCells", () => {
    it("generates all cells for full execution scope", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(6); // 3 rows × 2 targets
      
      // Check each cell has correct structure
      for (const cell of cells) {
        expect(cell.rowIndex).toBeGreaterThanOrEqual(0);
        expect(cell.rowIndex).toBeLessThan(3);
        expect(cell.targetId).toMatch(/^target-[12]$/);
        expect(cell.targetConfig).toBeDefined();
        expect(cell.evaluatorConfigs).toHaveLength(1);
        expect(cell.datasetEntry).toBeDefined();
      }
    });

    it("generates cells for rows scope (single row)", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "rows", rowIndices: [1] };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(2); // 1 row × 2 targets
      expect(cells.every((c) => c.rowIndex === 1)).toBe(true);
    });

    it("generates cells for rows scope (multiple rows)", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(5);
      const scope: ExecutionScope = { type: "rows", rowIndices: [0, 2, 4] };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(6); // 3 rows × 2 targets
      const rowIndices = new Set(cells.map((c) => c.rowIndex));
      expect(rowIndices).toEqual(new Set([0, 2, 4]));
    });

    it("generates cells for single target scope", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "target", targetId: "target-1" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(3); // 3 rows × 1 target
      expect(cells.every((c) => c.targetId === "target-1")).toBe(true);
    });

    it("generates single cell for cell scope", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "cell", rowIndex: 2, targetId: "target-2" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(1);
      expect(cells[0]?.rowIndex).toBe(2);
      expect(cells[0]?.targetId).toBe("target-2");
    });

    it("returns empty array for non-existent target", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "target", targetId: "non-existent" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(0);
    });

    it("filters out-of-bounds row indices", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3); // 0, 1, 2
      const scope: ExecutionScope = { type: "rows", rowIndices: [1, 10, 20] };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(2); // Only row 1 × 2 targets
      expect(cells.every((c) => c.rowIndex === 1)).toBe(true);
    });

    it("attaches dataset entry with _datasetId", () => {
      const state = createTestState(1, 0);
      const datasetRows = [{ question: "Hello", expected: "World" }];
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells[0]?.datasetEntry).toEqual({
        _datasetId: "dataset-1",
        question: "Hello",
        expected: "World",
      });
    });

    it("attaches all evaluators to each cell", () => {
      const state = createTestState(1, 3); // 1 target, 3 evaluators
      const datasetRows = [{ question: "Test", expected: "Test" }];
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells[0]?.evaluatorConfigs).toHaveLength(3);
    });
  });

  describe("cell ordering", () => {
    it("orders cells by row first, then target", () => {
      const state = createTestState(2, 0);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      // Expected order: (0, t1), (0, t2), (1, t1), (1, t2)
      expect(cells[0]?.rowIndex).toBe(0);
      expect(cells[0]?.targetId).toBe("target-1");
      expect(cells[1]?.rowIndex).toBe(0);
      expect(cells[1]?.targetId).toBe("target-2");
      expect(cells[2]?.rowIndex).toBe(1);
      expect(cells[2]?.targetId).toBe("target-1");
      expect(cells[3]?.rowIndex).toBe(1);
      expect(cells[3]?.targetId).toBe("target-2");
    });
  });
});
